import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicy } from "@/lib/crawl";
import { fixtureExpected } from "@/lib/fixtures";
import { RecordedModel } from "@/lib/fixlist";
import { AnthropicModel } from "@/server/anthropic-model";
import { INJECT_KEY } from "@/server/crawl-options";
import { openDb, type Db } from "@/server/db";
import { resolveDeps, ScanService } from "@/server/scan-service";
import { ScanStore } from "@/server/store";
import { fixtureRoutes, SiteServer, testGuard, testResolver } from "../helpers/site-server";

const dir = mkdtempSync(join(tmpdir(), "cs-svc-"));
let n = 0;
const dbs: Db[] = [];
function store(): ScanStore {
  const db = openDb(join(dir, `s${n++}.db`));
  dbs.push(db);
  return new ScanStore(db);
}

describe("web scan service (same scanner, guard and scoring as the CLI)", () => {
  let srv: SiteServer;
  let shop: string;
  let closed: string;

  beforeAll(async () => {
    srv = await new SiteServer().start();
    shop = srv.site("walledshop.test", fixtureRoutes("walled-shop", `http://walledshop.test:${srv.port}`));
    closed = srv.site("closed.test", { "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }, "/": { body: "<h1>x</h1>" } });
  });
  afterAll(async () => {
    await srv.stop();
    for (const db of dbs) await db.$disconnect();
  });

  it("crawls a fixture site end to end, scores it like the engine and stores report + validated fix list", async () => {
    const svc = new ScanService(store(), { crawl: { guard: testGuard }, model: RecordedModel.fromFixture("walled-shop.invented.json", { origin: shop }) });
    const r = await svc.submit(`${shop}/`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await svc.idle();
    const view = (await svc.store.get(r.id))!;
    expect(view.status, view.error ?? "").toBe("done");
    const rep = view.report!;
    expect(rep.siteType).toBe("ecommerce");
    const expected = fixtureExpected("walled-shop").checks;
    for (const c of rep.scorecard.checks) {
      if (c.id === "A2") expect(c.status).toBe("not-applicable"); // real agent list is empty until verified (D-10)
      else if (c.id !== "F1") expect(c.status, c.id).toBe(expected[c.id]); // F1 measures the live local server
    }
    // CS-04 through the web path: invented check G1, invented URL, and a passing check (B2) named in prose are dropped
    expect(rep.fixList.dropped.byReason).toMatchObject({ "unknown-check": 1, "unknown-url": 1, "unknown-check-in-text": 1 });
    expect(rep.fixList.dropped.total).toBe(3);
    expect(rep.fixList.source).toBe("mixed");
    const failing = rep.scorecard.checks.filter((c) => c.status === "fail" || c.status === "partial").map((c) => c.id);
    expect(rep.fixList.items.slice(0, 3).map((i) => [i.checkId, i.source])).toEqual([["E3", "llm"], ["A4", "llm"], ["B1", "llm"]]);
    expect(rep.fixList.items.map((i) => i.checkId).sort()).toEqual([...failing].sort());
    expect(rep.crawl.pageRequests).toBeLessThanOrEqual(15);
    expect(srv.hits.filter((h) => h.host === "walledshop.test").every((h) => h.method === "GET")).toBe(true);
  }, 120_000);

  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://0x7f000001/",
    "http://2130706433/",
    "file:///etc/passwd",
    "ftp://example.com/",
    "http://user:pw@example.com/",
    `http://127.0.0.1:${0}/`,
  ])("CS-03 via the web path: %s is refused before a row or a connection", async (target) => {
    const s = store();
    const svc = new ScanService(s); // production default guard
    const before = srv.hits.length;
    const r = await svc.submit(target.replace(":0/", `:${srv.port}/`));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(srv.hits.length).toBe(before);
  });

  it("CS-03 via the web path: a hostname resolving to loopback is refused", async () => {
    const svc = new ScanService(store(), { crawl: { guard: { resolver: testResolver, policy: defaultPolicy } } });
    const before = srv.hits.length;
    const r = await svc.submit(`http://walledshop.test:${srv.port}/`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/refused: .*127\.0\.0\.1/);
    expect(srv.hits.length).toBe(before);
  });

  it("a robots-closed site ends as a failed scan that says why", async () => {
    const svc = new ScanService(store(), { crawl: { guard: testGuard, render: false } });
    const r = await svc.submit(`${closed}/`);
    if (!r.ok) throw new Error(r.error);
    await svc.idle();
    const v = (await svc.store.get(r.id))!;
    expect(v.status).toBe("failed");
    expect(v.error).toMatch(/^refused: robots\.txt disallows CrawlspaceBot/);
    expect(v.report).toBeNull();
  }, 30_000);

  it("rejects empty, non-string and over-long input, and caps the queue", async () => {
    const svc = new ScanService(store(), { crawl: { guard: testGuard, render: false }, queueLimit: 1 });
    expect(await svc.submit("")).toMatchObject({ ok: false, status: 400 });
    expect(await svc.submit(42)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.submit(`https://example.com/${"a".repeat(3000)}`)).toMatchObject({ ok: false, status: 400 });
    const first = await svc.submit(`${closed}/`);
    expect(first.ok).toBe(true);
    expect(await svc.submit(`${closed}/`)).toMatchObject({ ok: false, status: 429 });
    await svc.idle();
    expect((await svc.submit(`${closed}/`)).ok).toBe(true);
    await svc.idle();
  }, 30_000);
});

describe("production wiring", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[INJECT_KEY];
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("uses the real SSRF guard and templates when nothing is injected and no key is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const d = resolveDeps();
    expect(d.crawl?.guard).toBeUndefined(); // → defaultResolver + defaultPolicy (public addresses only)
    expect(d.model).toBeNull();
  });

  it("uses the live adapter only when a key is set (never called here)", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    expect(resolveDeps().model).toBeInstanceOf(AnthropicModel);
  });

  it("environment variables cannot widen the guard; only the in-process e2e hook can (D-27)", () => {
    process.env.CRAWLSPACE_TEST_GUARD = "1";
    expect(resolveDeps().crawl?.guard).toBeUndefined();
    delete process.env.CRAWLSPACE_TEST_GUARD;
    (globalThis as Record<symbol, unknown>)[INJECT_KEY] = { crawl: { guard: testGuard }, model: null };
    expect(resolveDeps().crawl?.guard).toBe(testGuard);
  });
});
