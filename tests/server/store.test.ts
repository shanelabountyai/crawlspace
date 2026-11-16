import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureAgents, fixtureSnapshot } from "@/lib/fixtures";
import { generateFixList } from "@/lib/fixlist";
import { scanSnapshot } from "@/lib/scan";
import { migrate, openDb, type Db } from "@/server/db";
import { ScanStore, SCAN_ID_RE } from "@/server/store";

const dir = mkdtempSync(join(tmpdir(), "cs-db-"));
const opened: Db[] = [];
const open = (name: string) => {
  const db = openDb(join(dir, name));
  opened.push(db);
  return db;
};
afterAll(async () => {
  for (const db of opened) await db.$disconnect();
});

describe("SQLite storage via Prisma", () => {
  it("applies the committed migration once", () => {
    const file = join(dir, "m.db");
    expect(migrate(file)).toEqual(["20261116000000_init"]);
    expect(migrate(file)).toEqual([]);
  });

  it("stores a scan through its lifecycle and reads the report back intact", async () => {
    const store = new ScanStore(open("a.db"));
    const id = await store.create("https://broken-jsonld-shop.example/");
    expect(id).toMatch(SCAN_ID_RE);
    expect((await store.get(id))!.status).toBe("queued");
    await store.markRunning(id);
    const running = (await store.get(id))!;
    expect(running.status).toBe("running");
    expect(running.startedAt).not.toBeNull();

    const card = scanSnapshot(fixtureSnapshot("broken-jsonld-shop"), { agents: fixtureAgents() });
    const fixList = await generateFixList(card);
    const crawl = { pageRequests: 7, assetRequests: 0, blockedBrowserRequests: 2, skipped: [], notes: ["n"] };
    await store.markDone(id, card, fixList, crawl);
    const done = (await store.get(id))!;
    expect(done.status).toBe("done");
    expect(done.report!.scorecard).toEqual(card);
    expect(done.report!.fixList).toEqual(fixList);
    expect(done.report!.crawl).toEqual(crawl);
    expect(done.report!.overall).toBe(card.overall);
    expect(done.report!.siteType).toBe("ecommerce");
  });

  it("records failures and fails scans interrupted by a restart", async () => {
    const file = "b.db";
    const store = new ScanStore(open(file));
    const a = await store.create("https://a.example/");
    const b = await store.create("https://b.example/");
    const c = await store.create("https://c.example/");
    await store.markRunning(b);
    await store.markFailed(c, "refused: robots.txt disallows CrawlspaceBot");
    const after = new ScanStore(open(file)); // a second process on the same file
    expect(await after.failInterrupted()).toBe(2);
    for (const id of [a, b]) expect((await after.get(id))!.error).toMatch(/interrupted/);
    expect((await after.get(c))!.error).toMatch(/robots/);
  });

  it("unknown or malformed ids read as null", async () => {
    const store = new ScanStore(open("c.db"));
    expect(await store.get("nope")).toBeNull();
    expect(await store.get("AAAAAAAAAAAAAAAA")).toBeNull();
  });
});
