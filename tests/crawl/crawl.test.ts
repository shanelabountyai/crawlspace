import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crawlSite, type CrawlResult } from "@/lib/crawl";
import { fixtureAgents } from "@/lib/fixtures";
import { scanSnapshot } from "@/lib/scan";
import { loadSnapshotFromDir, writeSnapshotToDir } from "@/lib/snapshot";
import { fixtureRoutes, SiteServer, testGuard } from "../helpers/site-server";

describe("crawler end to end against a local test server", () => {
  let srv: SiteServer;
  let shop: CrawlResult;
  let jsShop: CrawlResult;

  beforeAll(async () => {
    srv = await new SiteServer().start();
    const shopBase = srv.site("shop.test", fixtureRoutes("good-shop", `http://shop.test:${srv.port}`));
    const appJs = `
const root = document.getElementById("root");
root.innerHTML = '<h1>Glow Lamp</h1><p class="price">$48.00</p><button type="button">Add to cart</button>';
const s = document.createElement("script"); s.type = "application/ld+json";
s.textContent = JSON.stringify({"@context":"https://schema.org","@type":"Product","name":"Glow Lamp","offers":{"@type":"Offer","price":"48.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}});
document.head.appendChild(s);`;
    const shell = '<!doctype html><html><head><title>Lamps</title><script src="/static/app.js"></script></head><body><div id="root"></div></body></html>';
    const jsBase = srv.site("jsshop.test", {
      "/": { body: shell.replace("</body>", '<a href="/products/glow-lamp">x</a></body>') },
      "/products/glow-lamp": { body: shell },
      "/static/app.js": { type: "text/javascript", body: `document.addEventListener("DOMContentLoaded", () => {${appJs}});` },
    });
    [shop, jsShop] = await Promise.all([crawlSite(`${shopBase}/`, { guard: testGuard }), crawlSite(`${jsBase}/`, { guard: testGuard })]);
  }, 120_000);

  afterAll(async () => {
    await srv.stop();
  });

  it("finds the home page, both product pages and the cart, plus robots/sitemap/llms", () => {
    const s = shop.snapshot;
    expect(s.pages.map((p) => [p.kind, new URL(p.url).pathname])).toEqual([
      ["home", "/"],
      ["product", "/products/trail-kettle"],
      ["product", "/products/enamel-mug"],
      ["cart", "/cart"],
    ]);
    expect([s.robots?.status, s.sitemap?.status, s.llms?.status]).toEqual([200, 200, 200]);
    expect(s.pages.every((p) => p.ttfbMs >= 0 && p.status === 200)).toBe(true);
  });

  it("the crawled shop scores like its fixture on content checks", () => {
    const card = scanSnapshot(shop.snapshot, { agents: fixtureAgents() });
    const st = Object.fromEntries(card.checks.map((c) => [c.id, c.status]));
    expect(card.siteType).toBe("ecommerce");
    for (const id of ["A1", "A2", "A4", "B1", "B2", "C1", "C2", "C4", "D1", "D2", "E1", "E2", "E3", "E4"]) expect(st[id], id).toBe("pass");
  });

  it("renders JavaScript-only pages: content appears only in the rendered view", () => {
    const product = jsShop.snapshot.pages.find((p) => p.kind === "product")!;
    expect(product).toBeDefined();
    expect(product.rawHtml).not.toContain("Glow Lamp");
    expect(product.renderedHtml).toContain("Glow Lamp");
    const card = scanSnapshot(jsShop.snapshot, { agents: fixtureAgents() });
    const st = Object.fromEntries(card.checks.map((c) => [c.id, c.status]));
    expect(card.siteType).toBe("ecommerce");
    expect(st.B1).toBe("fail");
    expect(st.C2).toBe("partial");
    expect(jsShop.report.requests.filter((r) => r.kind === "asset").map((r) => new URL(r.url).pathname)).toContain("/static/app.js");
  });

  it("snapshots round-trip through the on-disk fixture format", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-crawl-"));
    writeSnapshotToDir(shop.snapshot, dir);
    expect(loadSnapshotFromDir(dir)).toEqual(shop.snapshot);
  });
});
