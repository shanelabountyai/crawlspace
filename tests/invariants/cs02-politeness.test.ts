import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BudgetExceeded, crawlSite, Fetcher, MAX_PAGES, MIN_INTERVAL_MS, USER_AGENT } from "@/lib/crawl";
import { fixtureRoutes, SiteServer, testGuard, type Hit } from "../helpers/site-server";

// CS-02: the crawler never sends a non-GET request and never exceeds 15 pages or 1 req/s per host.
function gaps(hits: Hit[]): number[] {
  const byHost = new Map<string, number[]>();
  for (const h of hits) byHost.set(h.host, [...(byHost.get(h.host) ?? []), h.at]);
  return [...byHost.values()].flatMap((ts) => ts.slice(1).map((t, i) => t - ts[i]!));
}

describe("CS-02 politeness", () => {
  let srv: SiteServer;
  beforeAll(async () => {
    srv = await new SiteServer().start();
  });
  afterAll(async () => {
    await srv.stop();
  });

  it("crawling a fixture shop: GET only, own user agent, ≤ 15 pages, ≥ 1 s between requests to the host", async () => {
    const base = srv.site("politeshop.test", fixtureRoutes("good-shop", `http://politeshop.test:${srv.port}`));
    const { snapshot, report } = await crawlSite(`${base}/`, { guard: testGuard });
    const hits = srv.hits.filter((h) => h.host === "politeshop.test");
    expect(hits.length).toBeGreaterThan(3);
    expect(new Set(hits.map((h) => h.method))).toEqual(new Set(["GET"]));
    expect(report.requests.every((r) => r.method === "GET")).toBe(true);
    expect(report.requests.filter((r) => r.kind === "page").length).toBeLessThanOrEqual(MAX_PAGES);
    expect(snapshot.pages.length).toBeLessThanOrEqual(MAX_PAGES);
    // client-side: request starts are spaced by the limiter; server-side: allow a little socket jitter
    const starts = report.requests.map((r) => r.startedAt);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    for (const g of gaps(hits)) expect(g).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 50);
  }, 60_000);

  it("a huge site with forms and POSTing scripts: still GET only and capped at 15 pages", async () => {
    const products = Array.from({ length: 80 }, (_, i) => `/products/p${i}`);
    const productPage = `<!doctype html><html><head><title>P</title></head><body><h1>Thing</h1><p>$5.00</p>
<form id="f" method="post" action="/cart"><label for="q">Qty</label><input id="q" name="q"><button>Add to cart</button></form>
<script>
fetch("/api/track", { method: "POST", body: "x" }).catch(()=>{});
navigator.sendBeacon && navigator.sendBeacon("/beacon", "x");
document.getElementById("f").submit();
</script></body></html>`;
    const routes: Record<string, { body: string; type?: string }> = {
      "/": { body: `<!doctype html><html><head><title>Big</title></head><body><h1>Big shop</h1>${products.map((p) => `<a href="${p}">${p}</a>`).join("")}<a href="/cart">Cart</a></body></html>` },
      "/sitemap.xml": { type: "application/xml", body: `<urlset>${Array.from({ length: 500 }, (_, i) => `<url><loc>http://bigshop.test:${srv.port}/products/s${i}</loc></url>`).join("")}</urlset>` },
      "/cart": { body: "<!doctype html><html><body><h1>Cart</h1></body></html>" },
    };
    for (const p of products) routes[p] = { body: productPage };
    const base = srv.site("bigshop.test", routes);
    const { snapshot, report } = await crawlSite(`${base}/`, { guard: testGuard });
    const hits = srv.hits.filter((h) => h.host === "bigshop.test");
    expect(hits.filter((h) => h.method !== "GET")).toEqual([]);
    expect(hits.filter((h) => ["/api/track", "/beacon"].includes(h.path))).toEqual([]);
    expect(report.requests.filter((r) => r.kind === "page").length).toBeLessThanOrEqual(MAX_PAGES);
    expect(snapshot.pages.filter((p) => p.kind === "product").length).toBe(5);
    expect(report.renderEvents.some((e) => e.method === "POST" && e.action === "blocked")).toBe(true);
    for (const g of gaps(hits)) expect(g).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 50);
  }, 90_000);

  it("the fetcher refuses the 16th page request without sending it", async () => {
    const base = srv.site("budget.test", { "/": { body: "ok" } });
    const f = new Fetcher({ guard: testGuard });
    // Use a fast fake clock so this test does not take 15 s; spacing itself is covered above.
    (f as unknown as { limiter: { acquire: () => Promise<void> } }).limiter = { acquire: async () => undefined };
    for (let i = 0; i < MAX_PAGES; i++) await f.get(`${base}/?i=${i}`, "page");
    await expect(f.get(`${base}/?i=16`, "page")).rejects.toBeInstanceOf(BudgetExceeded);
    await f.close();
    expect(srv.hits.filter((h) => h.host === "budget.test").length).toBe(MAX_PAGES);
  });

  it("obeys robots.txt for CrawlspaceBot and identifies itself", async () => {
    let ua = "";
    const base = srv.site("robots.test", {
      "/robots.txt": { type: "text/plain", body: "User-agent: CrawlspaceBot\nDisallow: /products/secret\n" },
      "/": (req) => {
        ua = String(req.headers["user-agent"]);
        return { body: '<h1>Home</h1><a href="/products/secret">S</a><a href="/products/open">O</a>' };
      },
      "/products/open": { body: "<h1>Open</h1><p>$1.00</p>" },
      "/products/secret": { body: "<h1>Secret</h1>" },
    });
    const { report } = await crawlSite(`${base}/`, { guard: testGuard, render: false });
    expect(ua).toBe(USER_AGENT);
    expect(srv.hits.filter((h) => h.path === "/products/secret")).toEqual([]);
    expect(srv.hits.some((h) => h.host === "robots.test" && h.path === "/products/open")).toBe(true);
    expect(report.skipped.some((s) => s.url.endsWith("/products/secret"))).toBe(true);
  }, 30_000);

  it("refuses to scan a site whose robots.txt disallows CrawlspaceBot from /", async () => {
    const base = srv.site("closed.test", { "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }, "/": { body: "home" } });
    await expect(crawlSite(`${base}/`, { guard: testGuard, render: false })).rejects.toThrow(/disallows CrawlspaceBot/);
    expect(srv.hits.filter((h) => h.host === "closed.test").map((h) => h.path)).toEqual(["/robots.txt"]);
  });

  it("treats a 5xx robots.txt as disallow-all (RFC 9309) and stops", async () => {
    const base = srv.site("down.test", { "/robots.txt": { status: 503, type: "text/plain", body: "busy" }, "/": { body: "home" } });
    await expect(crawlSite(`${base}/`, { guard: testGuard, render: false })).rejects.toThrow(/disallow-all/);
    expect(srv.hits.filter((h) => h.host === "down.test").map((h) => h.path)).toEqual(["/robots.txt"]);
  });
});
