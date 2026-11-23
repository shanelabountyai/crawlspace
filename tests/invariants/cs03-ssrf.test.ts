import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite, Fetcher, SsrfError } from "@/lib/crawl";
import { SiteServer, testGuard, testPolicy } from "../helpers/site-server";

// CS-03: private, loopback and link-local addresses are refused before any connection.
describe("CS-03 SSRF guard", () => {
  let srv: SiteServer;
  beforeAll(async () => {
    srv = await new SiteServer().start();
  });
  afterAll(async () => {
    await srv.stop();
  });

  const targets = (port: number) => [
    `http://127.0.0.1:${port}/`,
    `http://localhost:${port}/`,
    `http://[::1]:${port}/`,
    `http://[::ffff:127.0.0.1]:${port}/`,
    `http://0.0.0.0:${port}/`,
    `http://2130706433:${port}/`, // 127.0.0.1 as a decimal integer
    `http://0x7f000001:${port}/`,
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://[fe80::1]/",
    "file:///etc/passwd",
    "ftp://127.0.0.1/",
    `http://user:pass@127.0.0.1:${port}/`,
  ];

  it("refuses every private/loopback/link-local/odd-scheme target with the default guard, and the server sees nothing", async () => {
    for (const t of targets(srv.port)) {
      await expect(crawlSite(t, { render: false }), t).rejects.toBeInstanceOf(SsrfError);
    }
    expect(srv.hits).toEqual([]);
  });

  // PRD-02 requirement 8 (SEC-8): IPv4-translated (::ffff:0:0:0/96) and local-use NAT64 (64:ff9b:1::/48) addresses.
  it("refuses the IPv4-translated and local-use NAT64 ranges before any connection, as a literal and as a DNS answer", async () => {
    const before = srv.hits.length;
    const literals = [
      `http://[::ffff:0:127.0.0.1]:${srv.port}/`,
      `http://[::ffff:0:8.8.8.8]:${srv.port}/`,
      `http://[64:ff9b:1::7f00:1]:${srv.port}/`,
      `http://[64:ff9b:1::8.8.8.8]:${srv.port}/`,
    ];
    for (const t of literals) await expect(crawlSite(t, { render: false }), t).rejects.toBeInstanceOf(SsrfError);
    for (const address of ["::ffff:0:7f00:1", "::ffff:0:808:808", "64:ff9b:1::7f00:1", "64:ff9b:1::808:808"]) {
      let connects = 0;
      const guard = {
        resolver: async () => {
          connects++;
          return [address];
        },
      };
      await expect(crawlSite(`http://translated.example:${srv.port}/`, { render: false, guard }), address).rejects.toBeInstanceOf(SsrfError);
      expect(connects, address).toBe(1); // resolved once for the pre-check, never again for a connection
    }
    expect(srv.hits.length).toBe(before);
  });

  it("refuses a public-looking hostname that resolves to loopback", async () => {
    const before = srv.hits.length;
    const guard = { resolver: async () => ["93.184.216.34", "127.0.0.1"], policy: testGuard.policy };
    await expect(crawlSite(`http://innocent.example:${srv.port}/`, { render: false, guard })).rejects.toBeInstanceOf(SsrfError);
    expect(srv.hits.length).toBe(before);
  });

  it("re-checks at connect time (DNS rebinding: public at pre-check, loopback at connect)", async () => {
    const before = srv.hits.length;
    let calls = 0;
    const guard = { resolver: async () => (calls++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]), policy: testPolicy };
    const f = new Fetcher({ guard });
    await expect(f.get(`http://rebind.example:${srv.port}/`, "page")).rejects.toThrow(/refused at connect/);
    await f.close();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(srv.hits.length).toBe(before);
  });

  it("refuses a redirect into a private address without following it", async () => {
    const base = srv.site("redir.test", {
      "/": { status: 302, headers: { location: `http://127.0.0.1:${srv.port}/secret` } },
    });
    srv.site("127.0.0.1", { "/secret": { body: "internal" } });
    const f = new Fetcher({ guard: testGuard });
    await expect(f.get(`${base}/`, "page")).rejects.toBeInstanceOf(SsrfError);
    await f.close();
    expect(srv.hits.filter((h) => h.path === "/secret")).toEqual([]);
  });

  it("the rendering browser cannot reach private addresses either (fetch, img, iframe, websocket)", async () => {
    const p = srv.port;
    const page = `<!doctype html><html><head><title>t</title></head><body><h1>Hello</h1>
<img src="http://127.0.0.1:${p}/pixel.png"><iframe src="http://127.0.0.1:${p}/frame"></iframe>
<script>
fetch("http://127.0.0.1:${p}/xhr").catch(()=>{});
fetch("http://localhost:${p}/xhr2").catch(()=>{});
try { new WebSocket("ws://127.0.0.1:${p}/ws"); } catch (e) {}
document.body.insertAdjacentHTML("beforeend", "<p id=ran>js ran</p>");
</script></body></html>`;
    const base = srv.site("leaky.test", { "/": { body: page } });
    const internal = ["/pixel.png", "/frame", "/xhr", "/xhr2", "/ws"];
    const { snapshot, report } = await crawlSite(`${base}/`, { guard: testGuard });
    expect(snapshot.pages[0]!.renderedHtml).toContain("js ran");
    expect(srv.hits.filter((h) => internal.includes(h.path))).toEqual([]);
    expect(report.renderEvents.some((e) => e.url.includes("/xhr") && e.action !== "fulfilled")).toBe(true);
  }, 60_000);
});
