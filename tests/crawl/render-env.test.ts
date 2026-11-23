import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { LaunchOptions } from "playwright";
import type { Fetcher, FetchResult } from "@/lib/crawl/fetcher";
import { CHROMIUM_ENV_ALLOWLIST, PlaywrightRenderer, chromiumLaunchEnv } from "@/lib/crawl/render";

// PRD-01 Phase A, requirement 1 / acceptance 1 (review 2026-11-20 rank 14, SEC-2): the headless browser renders pages
// chosen by anonymous visitors, so it is launched with an explicit, minimal environment. No app secret is passed to it,
// even when the secret is set in the server's own process.env.

/** Dummy values only. Each one must never reach the browser's environment. */
const SECRETS: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-dummy-render-env-test-0001",
  CRAWLSPACE_OPERATOR_PASSWORD: "dummy-operator-password-0002",
  CRAWLSPACE_TRUSTED_PROXY_HOPS: "1",
  CRAWLSPACE_HUBSPOT_ENABLED: "1",
  CRAWLSPACE_SOMETHING_NEW: "dummy-crawlspace-prefixed-0003",
  HUBSPOT_PORTAL_ID: "dummy-portal-0004",
  HUBSPOT_FORM_GUID: "dummy-form-guid-0005",
  DATABASE_FILE: "/tmp/dummy-render-env-test.db",
  // Not named in the PRD, but anything outside the allowlist is dropped too
  SOME_OTHER_TOKEN: "dummy-other-token-0006",
};
const SECRET_NAME = /^(ANTHROPIC_API_KEY|CRAWLSPACE_OPERATOR_PASSWORD|CRAWLSPACE_.*|HUBSPOT_.*|DATABASE_FILE)$/;

const noFetch = {
  get: async () => {
    throw new Error("no asset fetches in this test");
  },
} as unknown as Fetcher;

function page(body: string): FetchResult {
  return { requestedUrl: "http://render-env.test/", url: "http://render-env.test/", status: 200, contentType: "text/html; charset=utf-8", body, ttfbMs: 0, redirects: [] };
}

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const [k, v] of Object.entries(SECRETS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const k of Object.keys(SECRETS)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function expectNoSecret(env: Record<string, string | undefined>) {
  for (const name of Object.keys(env)) expect(name, `secret name ${name} passed to Chromium`).not.toMatch(SECRET_NAME);
  const values = Object.values(env).join("\n");
  for (const [name, value] of Object.entries(SECRETS)) {
    if (value.length < 4) continue; // "1" would match by accident; the name check above covers it
    expect(values, `value of ${name} passed to Chromium`).not.toContain(value);
  }
}

describe("PRD-01 acceptance 1: the env passed to chromium.launch holds no app secret", () => {
  it("passes an explicit env (never undefined, which would make Playwright inherit process.env)", async () => {
    let captured: LaunchOptions | undefined;
    const renderer = new PlaywrightRenderer(noFetch, {
      launch: async (options) => {
        captured = options;
        throw new Error("captured");
      },
    });
    await expect(renderer.render(page("<p>x</p>"))).rejects.toThrow("captured");
    expect(captured).toBeDefined();
    expect(captured!.env).toBeDefined();
    expect(typeof captured!.env).toBe("object");
    expectNoSecret(captured!.env as Record<string, string>);
    for (const name of Object.keys(captured!.env!)) expect(CHROMIUM_ENV_ALLOWLIST).toContain(name);
  });

  it("keeps the launch guards (D-20, D-100) alongside the env", async () => {
    let captured: LaunchOptions | undefined;
    const renderer = new PlaywrightRenderer(noFetch, {
      launch: async (options) => {
        captured = options;
        throw new Error("captured");
      },
    });
    await expect(renderer.render(page("<p>x</p>"))).rejects.toThrow("captured");
    expect(captured!.args).toContain("--host-resolver-rules=MAP * ~NOTFOUND");
    expect(captured!.args).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
    expect(captured!.proxy).toEqual({ server: "http://127.0.0.1:9" });
  });

  it("carries only allowlisted names, and the ones the browser needs when they are set", () => {
    const env = chromiumLaunchEnv({ ...SECRETS, HOME: "/home/node", PATH: "/usr/bin:/bin", TZ: "UTC", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright", NODE_OPTIONS: "--inspect" });
    expect(env).toMatchObject({ HOME: "/home/node", PATH: "/usr/bin:/bin", TZ: "UTC", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" });
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    expectNoSecret(env);
    for (const name of Object.keys(env)) expect(CHROMIUM_ENV_ALLOWLIST).toContain(name);
  });

  it("never allowlists a secret name", () => {
    for (const name of CHROMIUM_ENV_ALLOWLIST) expect(name).not.toMatch(SECRET_NAME);
  });

  it("leaves out unset names instead of passing empty values", () => {
    expect(chromiumLaunchEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });
});

/** Every live descendant process of this test process whose command line mentions Chromium (Linux /proc). */
function chromiumDescendants(): number[] {
  const parent = new Map<number, number>();
  const cmd = new Map<number, string>();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      parent.set(Number(d), ppid);
      cmd.set(Number(d), readFileSync(`/proc/${d}/cmdline`, "utf8"));
    } catch {
      // the process ended while we looked
    }
  }
  const isDescendant = (pid: number) => {
    for (let p = parent.get(pid), n = 0; p !== undefined && n < 64; p = parent.get(p), n++) if (p === process.pid) return true;
    return false;
  };
  return [...cmd.entries()].filter(([pid, c]) => /chrom/i.test(c) && isDescendant(pid)).map(([pid]) => pid);
}

describe.runIf(process.platform === "linux" && existsSync("/proc/self/environ"))("PRD-01: a real Chromium launched by the renderer holds no app secret", () => {
  const renderer = new PlaywrightRenderer(noFetch);
  afterAll(async () => {
    await renderer.close();
  });

  it("no Chromium process environment contains a secret, and page JS cannot read /proc/self/environ", async () => {
    const body = `<!doctype html><html><head><title>t</title></head><body><pre id="out">start</pre>
      <iframe src="file:///proc/self/environ"></iframe><script>
      const out = document.getElementById("out");
      const add = (s) => { out.textContent += "\\n" + s; };
      fetch("file:///proc/self/environ").then((r) => r.text()).then((t) => add("fetch:" + t), (e) => add("fetch failed"));
      try { const x = new XMLHttpRequest(); x.open("GET", "file:///proc/self/environ", false); x.send(); add("xhr:" + x.responseText); } catch (e) { add("xhr failed"); }
    </script></body></html>`;
    const html = await renderer.render(page(body));
    for (const value of Object.values(SECRETS)) if (value.length >= 4) expect(html).not.toContain(value);

    const pids = chromiumDescendants();
    expect(pids.length, "no Chromium process found under this test process").toBeGreaterThan(0);
    for (const pid of pids) {
      let raw: string;
      try {
        raw = readFileSync(`/proc/${pid}/environ`, "utf8");
      } catch {
        continue; // ended, or a sandboxed helper we may not read; the browser process itself is readable
      }
      const env = Object.fromEntries(raw.split("\0").filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
      expectNoSecret(env);
    }
  }, 60_000);
});
