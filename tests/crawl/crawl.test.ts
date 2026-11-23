import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrawlRefused, crawlSite, type CrawlResult } from "@/lib/crawl";
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

// PRD-02 requirements 1 and 2 (review 2026-11-20, CQ-2 and CQ-9; D-24 extended; Decision 10a).
describe("robots.txt on a network error and after a cross-origin home redirect", () => {
  let srv: SiteServer;
  const opts = { guard: testGuard, render: false } as const;
  const paths = (host: string) => srv.hits.filter((h) => h.host === host).map((h) => h.path);
  const refusal = async (url: string): Promise<CrawlRefused> => {
    const e = await crawlSite(url, opts).then(
      () => null,
      (err: unknown) => err,
    );
    expect(e, url).toBeInstanceOf(CrawlRefused);
    return e as CrawlRefused;
  };
  const closedRobots = { type: "text/plain", body: "User-agent: *\nDisallow: /\n" };
  const openHome = { body: "<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>" };

  beforeAll(async () => {
    srv = await new SiteServer().start();
  });
  afterAll(async () => {
    await srv.stop();
  });

  it("a robots.txt that cannot be read (connection closed) stops the scan: nothing else is requested", async () => {
    const base = srv.site("robots-dead.test", { "/robots.txt": { destroy: true }, "/": openHome });
    const e = await refusal(`${base}/`);
    expect(e.message).toMatch(/^robots\.txt could not be read \(.+\); treating as disallow-all and not scanning$/);
    expect(paths("robots-dead.test")).toEqual(["/robots.txt"]);
  }, 30_000);

  it("a robots.txt on a host that refuses connections stops the scan", async () => {
    // Port 1 on loopback: nothing listens there, so the connect itself fails.
    const e = await refusal("http://robots-unreachable.test:1/");
    expect(e.message).toMatch(/^robots\.txt could not be read \(.+\); treating as disallow-all and not scanning$/);
  }, 30_000);

  it("a → b, b disallows /: refused, naming b; b gets no request other than /robots.txt", async () => {
    const b = srv.site("b-closed.test", { "/robots.txt": closedRobots, "/": openHome });
    const a = srv.site("a-moved.test", { "/": { status: 301, headers: { location: `${b}/` } } });
    const e = await refusal(`${a}/`);
    expect(e.message).toContain(`b-closed.test:${srv.port}`);
    expect(e.message).toMatch(/robots\.txt .*disallows CrawlspaceBot from \/; not scanning$/);
    expect(paths("b-closed.test")).toEqual(["/robots.txt"]);
    expect(paths("a-moved.test")).toEqual(["/robots.txt", "/"]);
  }, 30_000);

  it("d → c, c's robots.txt answers 503: refused, naming c; c gets no request other than /robots.txt", async () => {
    const c = srv.site("c-down.test", { "/robots.txt": { status: 503, type: "text/plain", body: "busy" }, "/": openHome });
    const d = srv.site("d-moved.test", { "/": { status: 302, headers: { location: `${c}/` } } });
    const e = await refusal(`${d}/`);
    expect(e.message).toContain(`c-down.test:${srv.port}`);
    expect(e.message).toMatch(/robots\.txt .*returned 503; treating as disallow-all and not scanning$/);
    expect(paths("c-down.test")).toEqual(["/robots.txt"]);
  }, 30_000);

  it("e → f, f's robots.txt cannot be read: refused, naming f; f gets no request other than /robots.txt", async () => {
    const f = srv.site("f-dead.test", { "/robots.txt": { destroy: true }, "/": openHome });
    const eBase = srv.site("e-moved.test", { "/": { status: 307, headers: { location: `${f}/` } } });
    const e = await refusal(`${eBase}/`);
    expect(e.message).toContain(`f-dead.test:${srv.port}`);
    expect(e.message).toMatch(/robots\.txt .*could not be read \(.+\); treating as disallow-all and not scanning$/);
    expect(paths("f-dead.test")).toEqual(["/robots.txt"]);
  }, 30_000);

  it("a redirect on the same origin into a disallowed path is refused before that path is requested", async () => {
    const base = srv.site("inward.test", {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /members/\n" },
      "/": { status: 302, headers: { location: "/members/home" } },
      "/members/home": openHome,
    });
    const e = await refusal(`${base}/`);
    expect(e.message).toBe("robots.txt disallows CrawlspaceBot from /members/home; not scanning");
    expect(paths("inward.test")).toEqual(["/robots.txt", "/"]);
  }, 30_000);

  it("g → h, h allows it: h's robots.txt is read before anything else on h, and the scan uses h's rules", async () => {
    const h = srv.site("h-open.test", {
      "/robots.txt": { type: "text/plain", body: "User-agent: CrawlspaceBot\nDisallow: /products/secret\n" },
      "/": { body: '<h1>Home</h1><a href="/products/secret">S</a><a href="/products/open">O</a>' },
      "/products/open": { body: "<h1>Open</h1><p>$1.00</p>" },
      "/products/secret": { body: "<h1>Secret</h1>" },
    });
    const g = srv.site("g-moved.test", { "/": { status: 301, headers: { location: `${h}/` } } });
    const { snapshot, report } = await crawlSite(`${g}/`, opts);
    expect(paths("h-open.test")[0]).toBe("/robots.txt");
    expect(paths("h-open.test")).toContain("/products/open");
    expect(paths("h-open.test")).not.toContain("/products/secret");
    expect(paths("h-open.test").filter((p) => p === "/robots.txt")).toHaveLength(1);
    expect(snapshot.url).toBe(`${h}/`);
    expect(snapshot.robots?.url).toBe(`${h}/robots.txt`);
    expect(report.notes).toContain(`home redirected to ${h}; using its robots.txt`);
    expect(report.skipped.some((s) => s.url.endsWith("/products/secret"))).toBe(true);
  }, 60_000);
});

// PRD-02 requirement 4 (review 2026-11-20, UX-1; Decision 3b): the crawl's home is the origin root, whatever was pasted.
describe("the crawl starts at the origin root", () => {
  let srv: SiteServer;
  let base: string;
  const paths = () => srv.hits.filter((h) => h.host === "walledshop.test").map((h) => h.path);
  /** Everything on a scorecard except the clock: per-check status and weight, category scores, overall, site type. */
  const comparable = (r: CrawlResult) => {
    const card = scanSnapshot(r.snapshot, { agents: fixtureAgents() });
    return {
      url: card.url,
      siteType: card.siteType,
      overall: card.overall,
      categories: card.categories,
      checks: card.checks.map((c) => ({ id: c.id, status: c.status, weight: c.weight })),
      pages: r.snapshot.pages.map((p) => ({ id: p.id, kind: p.kind, url: p.url, status: p.status, rawHtml: p.rawHtml })),
    };
  };

  beforeAll(async () => {
    srv = await new SiteServer().start();
    base = srv.site("walledshop.test", fixtureRoutes("walled-shop", `http://walledshop.test:${srv.port}`));
  });
  afterAll(async () => {
    await srv.stop();
  });

  it("pasting /nope-404-page on walledshop gives the same scorecard as /, and the 404 path is never requested", async () => {
    const root = await crawlSite(`${base}/`, { guard: testGuard });
    const deep = await crawlSite(`${base}/nope-404-page`, { guard: testGuard });
    expect(paths()).not.toContain("/nope-404-page");
    expect(deep.snapshot.url).toBe(`${base}/`);
    expect(deep.snapshot.pages.find((p) => p.kind === "home")?.url).toBe(`${base}/`);
    expect(comparable(deep)).toEqual(comparable(root));
    expect(comparable(root).overall).not.toBeNull();
  }, 180_000);

  it("a pasted product link with a query and a fragment also starts at /", async () => {
    const before = srv.hits.length;
    const { snapshot, report } = await crawlSite(`${base}/products/trail-kettle?utm_source=x#reviews`, { guard: testGuard, render: false });
    const mine = srv.hits.slice(before).map((h) => h.path);
    expect(mine.slice(0, 2)).toEqual(["/robots.txt", "/"]);
    expect(mine.some((p) => p.includes("utm_source"))).toBe(false);
    expect(snapshot.url).toBe(`${base}/`);
    expect(report.requests[1]?.url).toBe(`${base}/`);
  }, 60_000);

  it("robots.txt is judged for the home page, not for the pasted path", async () => {
    const b = srv.site("partly-closed.test", {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /account/\n" },
      "/": { body: "<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>" },
    });
    const { snapshot } = await crawlSite(`${b}/account/orders`, { guard: testGuard, render: false });
    expect(snapshot.url).toBe(`${b}/`);
    expect(srv.hits.filter((h) => h.host === "partly-closed.test").map((h) => h.path)).not.toContain("/account/orders");
  }, 60_000);
});
