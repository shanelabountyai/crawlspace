// Regression tests for the must-fix findings of the 2026-11-20 five-lens review (docs/REVIEW-2026-11-20.md, D-88..).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "@/server/db";
import { getScanService, ScanService } from "@/server/scan-service";
import { ScanStore } from "@/server/store";
import { SiteServer, testGuard } from "../helpers/site-server";

const dir = mkdtempSync(join(tmpdir(), "cs-review-"));
const dbs: Db[] = [];

describe("review 2026-11-20: scan queue limit holds under concurrent submits (CQ-1)", () => {
  let srv: SiteServer;
  let closed: string;
  beforeAll(async () => {
    srv = await new SiteServer().start();
    // robots.txt disallows everything, so each accepted scan is refused quickly without crawling
    closed = srv.site("closed.test", { "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }, "/": { body: "<h1>x</h1>" } });
  });
  afterAll(async () => {
    await srv.stop();
    for (const db of dbs) await db.$disconnect();
  });

  it("accepts exactly queueLimit of 20 simultaneous submits and answers 429 to the rest", async () => {
    const db = openDb(join(dir, "queue.db"));
    dbs.push(db);
    const svc = new ScanService(new ScanStore(db), { crawl: { guard: testGuard, render: false }, model: null, queueLimit: 5 });
    const results = await Promise.all(Array.from({ length: 20 }, () => svc.submit(`${closed}/`)));
    await svc.idle();
    expect(results.filter((r) => r.ok).length).toBe(5);
    expect(results.filter((r) => !r.ok && r.status === 429).length).toBe(15);
  });

  it("gives the slot back when creating the row fails", async () => {
    const db = openDb(join(dir, "queue2.db"));
    dbs.push(db);
    const store = new ScanStore(db);
    let fail = true;
    const realCreate = store.create.bind(store);
    store.create = async (url: string) => {
      if (fail) throw new Error("disk full");
      return realCreate(url);
    };
    const svc = new ScanService(store, { crawl: { guard: testGuard, render: false }, model: null, queueLimit: 1 });
    await expect(svc.submit(`${closed}/`)).rejects.toThrow("disk full");
    fail = false;
    const r = await svc.submit(`${closed}/`);
    expect(r.ok).toBe(true);
    await svc.idle();
  });
});

describe("review 2026-11-20: a failed start-up is retried, not cached for the life of the process (CQ-6)", () => {
  it("getScanService recovers once the database can be opened", async () => {
    const before = process.env.DATABASE_FILE;
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "x"); // a file where the database's parent directory should be
    try {
      process.env.DATABASE_FILE = join(blocker, "crawlspace.db");
      await expect(getScanService()).rejects.toThrow();
      process.env.DATABASE_FILE = join(dir, "recovered", "crawlspace.db");
      const svc = await getScanService();
      expect(svc).toBeInstanceOf(ScanService);
    } finally {
      if (before === undefined) delete process.env.DATABASE_FILE;
      else process.env.DATABASE_FILE = before;
    }
  });
});

describe("review 2026-11-20: public POST routes refuse oversized bodies before parsing them (SEC-5)", () => {
  const before = process.env.DATABASE_FILE;
  beforeAll(() => {
    process.env.DATABASE_FILE = join(dir, "routes", "crawlspace.db");
  });
  afterAll(() => {
    if (before === undefined) delete process.env.DATABASE_FILE;
    else process.env.DATABASE_FILE = before;
  });
  const post = (path: string, body: string, type = "application/json") =>
    new Request(`http://app.local${path}`, { method: "POST", headers: { host: "app.local", "content-type": type }, body });

  it("POST /api/scans: a 30 KB body is refused as unreadable, a normal one is still read", async () => {
    const { POST } = await import("@/app/api/scans/route");
    const big = await POST(post("/api/scans", JSON.stringify({ url: "https://example.test/" + "a".repeat(30_000) })));
    expect(big.status).toBe(400);
    expect(await big.json()).toEqual({ error: "could not read the request" });
    const small = await POST(post("/api/scans", JSON.stringify({ url: "" })));
    expect(small.status).toBe(400);
    expect(await small.json()).toEqual({ error: "enter a website address" });
  });

  it("POST /api/scans/[id]/pdf: a 30 KB body is refused as unreadable, a normal one is still read", async () => {
    const { POST } = await import("@/app/api/scans/[id]/pdf/route");
    const params = Promise.resolve({ id: "nosuchscan0000000" });
    const big = await POST(post("/api/scans/nosuchscan0000000/pdf", JSON.stringify({ email: "a".repeat(30_000) + "@example.com" })), { params });
    expect(big.status).toBe(400);
    expect(await big.json()).toEqual({ error: "could not read the request" });
    const small = await POST(post("/api/scans/nosuchscan0000000/pdf", JSON.stringify({ email: "a@example.com" })), { params: Promise.resolve({ id: "nosuchscan0000000" }) });
    expect(small.status).toBe(404);
  });
});
