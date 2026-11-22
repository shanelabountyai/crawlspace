/**
 * PRD-01 Phase A, acceptance 3 and 4 (review 2026-11-20 rank 14, SEC-2). Run inside the Docker image as the app user by
 * `scripts/docker-smoke.sh`, with DUMMY secrets set in the environment (never real ones):
 *
 *   npx tsx scripts/render-isolation-smoke.ts [server-pid]
 *
 * Without a pid it looks for the running `next start` server itself.
 *
 * 1. Renders a page through the app's own renderer whose JavaScript tries to read `/proc/self/environ` and the server's
 *    `/proc/<pid>/environ` (fetch, XHR, iframe). The rendered HTML must hold no secret value.
 * 2. Reads the environment of every Chromium process the renderer started: no secret name or value.
 * 3. Prints whether Chromium ran inside its own sandbox or what the host said when it was refused (D-108).
 *
 * Makes no network request: the page is served from memory and every asset fetch is refused.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { Fetcher, FetchResult } from "../src/lib/crawl/fetcher";
import { PlaywrightRenderer } from "../src/lib/crawl/render";

const SECRET_NAME = /^(ANTHROPIC_API_KEY|CRAWLSPACE_OPERATOR_PASSWORD|CRAWLSPACE_.*|HUBSPOT_.*|DATABASE_FILE)$/;

function fail(message: string): never {
  console.error(`render isolation: FAIL: ${message}`);
  process.exit(1);
}

/** The dummy secrets this run must not leak: every secret-named variable set to a value long enough to search for. */
const secrets = Object.entries(process.env).filter(([k, v]) => SECRET_NAME.test(k) && typeof v === "string" && v.length >= 8) as [string, string][];
if (!secrets.some(([k]) => k === "ANTHROPIC_API_KEY")) fail("set a dummy ANTHROPIC_API_KEY (8+ characters) before running this check");

function procTable(): { parent: Map<number, number>; cmd: Map<number, string> } {
  const parent = new Map<number, number>();
  const cmd = new Map<number, string>();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      parent.set(Number(d), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
      cmd.set(Number(d), readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " "));
    } catch {
      // ended while we looked
    }
  }
  return { parent, cmd };
}

function chromiumDescendants(): number[] {
  const { parent, cmd } = procTable();
  const under = (pid: number) => {
    for (let p = parent.get(pid), n = 0; p !== undefined && n < 64; p = parent.get(p), n++) if (p === process.pid) return true;
    return false;
  };
  return [...cmd.entries()].filter(([pid, c]) => /chrom/i.test(c) && under(pid)).map(([pid]) => pid);
}

function leaks(text: string): string[] {
  return secrets.filter(([, v]) => text.includes(v)).map(([k]) => k);
}

/** The Next server started by the entrypoint, if one is running in this container. */
function findServerPid(): number | null {
  const { cmd } = procTable();
  for (const [pid, c] of cmd) if (pid !== process.pid && /next(\/dist\/bin\/next)? start/.test(c)) return pid;
  return null;
}

async function main() {
  const serverPid = Number(process.argv[2] ?? 0) || findServerPid();
  if (serverPid) console.log(`   server pid ${serverPid}: page JS will also try its /proc environ`);
  const targets = ["file:///proc/self/environ", ...(serverPid ? [`file:///proc/${serverPid}/environ`] : [])];
  const noFetch = { get: async () => Promise.reject(new Error("no asset fetches in the smoke check")) } as unknown as Fetcher;
  const body = `<!doctype html><html><head><title>isolation</title></head><body><pre id="out">start</pre>
    ${targets.map((t) => `<iframe src="${t}"></iframe>`).join("")}
    <script>
      const out = document.getElementById("out");
      const add = (s) => { out.textContent += "\\n" + s; };
      for (const t of ${JSON.stringify(targets)}) {
        fetch(t).then((r) => r.text()).then((x) => add("fetch " + t + ": " + x), () => add("fetch " + t + ": refused"));
        try { const x = new XMLHttpRequest(); x.open("GET", t, false); x.send(); add("xhr " + t + ": " + x.responseText); } catch { add("xhr " + t + ": refused"); }
      }
    </script></body></html>`;
  const main: FetchResult = { requestedUrl: "http://isolation.test/", url: "http://isolation.test/", status: 200, contentType: "text/html; charset=utf-8", body, ttfbMs: 0, redirects: [] };

  const renderer = new PlaywrightRenderer(noFetch);
  try {
    const html = await renderer.render(main);
    const inPage = leaks(html);
    if (inPage.length) fail(`page JavaScript read ${inPage.join(", ")} (${targets.join(", ")})`);
    if (!html.includes("isolation") && !html.includes("start")) fail("the page did not render");
    console.log(`   page JS reading ${targets.join(" and ")}: no secret in the rendered page`);

    const pids = chromiumDescendants();
    if (pids.length === 0) fail("no Chromium process found under this process");
    let read = 0;
    for (const pid of pids) {
      let raw: string;
      try {
        raw = readFileSync(`/proc/${pid}/environ`, "utf8");
      } catch {
        continue; // a sandboxed helper in its own namespace may not be readable; the browser process is
      }
      read++;
      const names = raw.split("\0").filter(Boolean).map((kv) => kv.slice(0, kv.indexOf("=")));
      const badNames = names.filter((n) => SECRET_NAME.test(n));
      const badValues = leaks(raw);
      if (badNames.length || badValues.length) fail(`Chromium pid ${pid} environment holds ${[...new Set([...badNames, ...badValues])].join(", ")}`);
    }
    if (read === 0) fail("could not read any Chromium process environment");
    console.log(`   ${pids.length} Chromium processes, ${read} environments read: no secret name or value (checked ${secrets.map(([k]) => k).join(", ")})`);

    if (serverPid) {
      // Not a pass/fail item: what native code running as this user could read without Chromium's sandbox (Phase B).
      let readable = false;
      try {
        readable = readFileSync(`/proc/${serverPid}/environ`, "utf8").length > 0;
      } catch {
        readable = false;
      }
      console.log(`   for the record: the server's /proc/${serverPid}/environ is ${readable ? "READABLE" : "not readable"} by this user outside Chromium (PRD-01 Phase B scope)`);
    }

    const s = renderer.sandbox;
    if (!s) fail("the renderer did not report how Chromium was launched");
    if (s.enabled) console.log("   chromium sandbox: ON (launched with chromiumSandbox: true, no --no-sandbox)");
    else console.log(`   chromium sandbox: REFUSED, running with --no-sandbox. Host said: ${s.refusal}`);
  } finally {
    await renderer.close();
  }
  console.log("render isolation: ok");
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
