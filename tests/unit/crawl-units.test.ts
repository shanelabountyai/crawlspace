import { describe, expect, it } from "vitest";
import { isPublicAddress, normaliseStartUrl } from "@/lib/crawl";
import { extractLinks, findActionLink, guessSiteType, parseSitemap, pickKeyPages, sameSite } from "@/lib/crawl/discover";
import { HostRateLimiter, type Clock } from "@/lib/crawl/ratelimit";
import { sitemapsFromRobots } from "@/lib/robots";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.10", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe", "2001:db8::1", "[::1]", "fe80::1%eth0", "not-an-ip", "",
  ])("%s is not public", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("normaliseStartUrl", () => {
  it("adds https:// to bare domains and drops the fragment", () => {
    expect(normaliseStartUrl(" shop.example/#top ")).toBe("https://shop.example/");
  });
  it.each(["file:///etc/passwd", "ftp://shop.example/", "javascript:alert(1)", "gopher://x.example", "http://user:pw@shop.example/"])("refuses %s", (u) => {
    expect(() => normaliseStartUrl(u)).toThrow();
  });
});

describe("HostRateLimiter", () => {
  function fakeClock() {
    let t = 0;
    const clock: Clock = { now: () => t, sleep: async (ms) => void (t += ms) };
    return clock;
  }
  it("spaces request starts to the same host by at least the interval, in order", async () => {
    const clock = fakeClock();
    const rl = new HostRateLimiter(1000, clock);
    const starts: number[] = [];
    await Promise.all([1, 2, 3, 4].map(() => rl.acquire("a.example").then(() => starts.push(clock.now()))));
    expect(starts).toEqual([0, 1000, 2000, 3000]);
  });
  it("resolves with the granted start, and the next grant is a full interval after it (D-47)", async () => {
    // A tick lands between a grant and any later clock read; the fetcher logs the grant, not a fresh read.
    let t = 0;
    let tickAfterGrant = true;
    const clock: Clock = {
      now: () => {
        const v = t;
        if (tickAfterGrant) t += 1;
        return v;
      },
      sleep: async (ms) => void (t += ms),
    };
    const rl = new HostRateLimiter(1000, clock);
    const first = await rl.acquire("a.example");
    const freshRead = clock.now(); // 1 ms after the grant
    tickAfterGrant = false;
    const second = await rl.acquire("a.example");
    expect(second - first).toBeGreaterThanOrEqual(1000);
    expect(second - freshRead).toBeLessThan(1000); // logging a fresh read would have shown this short gap (CI: 999 ms)
  });
  it("does not make different hosts wait for each other", async () => {
    const clock = fakeClock();
    const rl = new HostRateLimiter(1000, clock);
    await rl.acquire("a.example");
    const t = clock.now();
    await rl.acquire("b.example");
    expect(clock.now()).toBe(t);
  });
});

describe("discovery", () => {
  const home = "https://shop.example/";
  const html = `<a href="/products/a">A</a><a href="https://www.shop.example/products/b#x">B</a><a href="https://other.example/products/c">C</a>
<a href="/img/x.png">img</a><a href="mailto:a@b.c">m</a><a href="/basket">Basket</a>`;
  it("keeps same-site http(s) links only (www. counts as same site)", () => {
    expect(extractLinks(html, home).map((l) => l.url)).toEqual(["https://shop.example/products/a", "https://www.shop.example/products/b", "https://shop.example/basket"]);
    expect(sameSite("https://www.shop.example/", home)).toBe(true);
    expect(sameSite("https://cdn.shop.example/", home)).toBe(false);
  });
  it("picks at most N key pages, home links first, respecting robots", () => {
    const sitemap = Array.from({ length: 50 }, (_, i) => `https://shop.example/products/p${i}`);
    const { picked, skipped } = pickKeyPages("ecommerce", home, extractLinks(html, home), sitemap, 5, (u) => !u.endsWith("/p1"));
    expect(picked).toEqual(["https://shop.example/products/a", "https://www.shop.example/products/b", "https://shop.example/products/p0", "https://shop.example/products/p2", "https://shop.example/products/p3"]);
    expect(skipped).toEqual(["https://shop.example/products/p1"]);
  });
  it("guesses site type and finds the action page", () => {
    expect(guessSiteType("<p>hi</p>", ["https://x.example/events/a", "https://x.example/events/b"])).toBe("event");
    expect(guessSiteType("<p>hi</p>", ["https://x.example/about"])).toBe("other");
    expect(findActionLink("ecommerce", [{ url: home, html }])).toEqual({ url: "https://shop.example/basket", kind: "cart" });
    expect(findActionLink("event", [{ url: home, html: '<a href="https://tix.example/buy">Get tickets</a><a href="/rsvp">RSVP</a>' }])).toEqual({ url: "https://shop.example/rsvp", kind: "registration" });
  });
  it("parses sitemaps, sitemap indexes and robots Sitemap lines", () => {
    expect(parseSitemap("<urlset><url><loc>https://a.example/x?a=1&amp;b=2</loc></url></urlset>").urls).toEqual(["https://a.example/x?a=1&b=2"]);
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>").childSitemaps).toEqual(["https://a.example/s1.xml"]);
    expect(sitemapsFromRobots("User-agent: *\nSitemap: https://a.example/s.xml\nsitemap:https://a.example/t.xml")).toEqual(["https://a.example/s.xml", "https://a.example/t.xml"]);
  });
});

describe("HostRateLimiter with an early-firing timer", () => {
  it("keeps waiting until the full interval has passed", async () => {
    let t = 0;
    // sleep() wakes 1 ms early, like real timers sometimes do
    const clock: Clock = { now: () => t, sleep: async (ms) => void (t += Math.max(1, ms - 1)) };
    const rl = new HostRateLimiter(1000, clock);
    const starts: number[] = [];
    for (let i = 0; i < 3; i++) {
      await rl.acquire("a.example");
      starts.push(t);
    }
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(1000);
  });
});
