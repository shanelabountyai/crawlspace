import { describe, expect, it } from "vitest";
import { isPublicAddress, normaliseStartUrl } from "@/lib/crawl";
import { extractLinks, findActionLink, guessSiteType, parseSitemap, pickKeyPages, sameSite } from "@/lib/crawl/discover";
import { Fetcher } from "@/lib/crawl";
import { HostRateLimiter, LIMITER_SWEEP_AT, sharedHostRateLimiter, type Clock } from "@/lib/crawl/ratelimit";
import { sitemapsFromRobots } from "@/lib/robots";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.10", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe", "2001:db8::1", "[::1]", "fe80::1%eth0", "not-an-ip", "",
  ])("%s is not public", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) => expect(isPublicAddress(ip)).toBe(true));
  // PRD-02 requirement 8 (review 2026-11-20, SEC-8; D-22 extended): the IPv4-translated range ::ffff:0:0:0/96 (RFC 2765)
  // and the local-use NAT64 range 64:ff9b:1::/48 (RFC 8215) are refused whole, whatever IPv4 address they carry.
  it.each([
    "::ffff:0:127.0.0.1", "::ffff:0:7f00:1", "::ffff:0:10.0.0.1", "::ffff:0:8.8.8.8", "::ffff:0:808:808", "[::ffff:0:a9fe:a9fe]",
    "64:ff9b:1::7f00:1", "64:ff9b:1::8.8.8.8", "64:ff9b:1:ffff:ffff:ffff:808:808", "64:ff9b:1::", "[64:ff9b:1::a9fe:a9fe]",
  ])("%s (IPv4-translated or local-use NAT64) is not public", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["64:ff9b:2::1", "::fffe:0:808:808"])("%s is outside the two refused ranges", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("normaliseStartUrl", () => {
  it("adds https:// to bare domains and drops the fragment", () => {
    expect(normaliseStartUrl(" shop.example/#top ")).toBe("https://shop.example/");
  });
  it.each(["file:///etc/passwd", "ftp://shop.example/", "javascript:alert(1)", "gopher://x.example", "http://user:pw@shop.example/"])("refuses %s", (u) => {
    expect(() => normaliseStartUrl(u)).toThrow();
  });
  // PRD-02 requirement 7 (review 2026-11-20, UX-5): only "://" or a leading http:/https: counts as a scheme.
  it("treats host:port without a scheme as a host, not as a scheme", () => {
    expect(normaliseStartUrl("goodshop.test:7911")).toBe("https://goodshop.test:7911/");
    expect(normaliseStartUrl("goodshop.test:7911/products/x?y=1")).toBe("https://goodshop.test:7911/products/x?y=1");
    expect(normaliseStartUrl(" Shop.Example:8443 ")).toBe("https://shop.example:8443/");
  });
  it("a :// inside the path or query of a scheme-less address is not a scheme (D-125)", () => {
    expect(normaliseStartUrl("shop.example/login?next=https://shop.example/")).toBe("https://shop.example/login?next=https://shop.example/");
    expect(normaliseStartUrl("shop.example:8443/go?to=http://other.example/x")).toBe("https://shop.example:8443/go?to=http://other.example/x");
  });
  it("keeps an explicit http or https scheme, in any letter case", () => {
    expect(normaliseStartUrl("http://goodshop.test:7911/")).toBe("http://goodshop.test:7911/");
    expect(normaliseStartUrl("HTTP://shop.example")).toBe("http://shop.example/");
    expect(normaliseStartUrl("https:shop.example")).toBe("https://shop.example/");
  });
  it.each(["mailto:someone@shop.example", "data:text/html,<h1>x</h1>", "FILE:///etc/passwd", "user:pw@shop.example"])("still refuses %s", (u) => {
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
  // PRD-02 requirement 3: one limiter for the whole process.
  it("every fetcher shares the process-wide limiter unless a test gives it a clock or a limiter of its own", async () => {
    const limiterOf = (f: Fetcher) => (f as unknown as { limiter: HostRateLimiter }).limiter;
    const a = new Fetcher();
    const b = new Fetcher({ maxPages: 3 });
    const own = new HostRateLimiter(1000, fakeClock());
    const c = new Fetcher({ limiter: own });
    const d = new Fetcher({ clock: fakeClock() });
    expect(limiterOf(a)).toBe(sharedHostRateLimiter());
    expect(limiterOf(b)).toBe(limiterOf(a));
    expect(limiterOf(c)).toBe(own);
    expect(limiterOf(d)).not.toBe(sharedHostRateLimiter());
    await Promise.all([a, b, c, d].map((f) => f.close()));
  });
  it("two callers on one limiter are spaced even when they ask at the same moment for the same host in different letter case", async () => {
    const clock = fakeClock();
    const rl = new HostRateLimiter(1000, clock);
    const [x, y] = await Promise.all([rl.acquire("Shop.example:8443"), rl.acquire("shop.example:8443")]);
    expect(Math.abs(y - x)).toBe(1000);
  });
  it("forgets idle hosts once many are remembered, and never one with a slot still ahead or a queue", async () => {
    const clock = fakeClock();
    const rl = new HostRateLimiter(1000, clock);
    for (let i = 0; i < LIMITER_SWEEP_AT; i++) await rl.acquire(`h${i}.example`);
    expect(rl.size).toBe(LIMITER_SWEEP_AT);
    await clock.sleep(5000); // every slot above has passed
    const busy = await rl.acquire("busy.example"); // sweeps the idle hosts, then takes a slot
    expect(rl.size).toBe(1);
    // fill up again while busy.example's next slot is still ahead: it must survive the sweep and still space its next request
    for (let i = 0; i < LIMITER_SWEEP_AT; i++) await rl.acquire(`g${i}.example`);
    const again = await rl.acquire("busy.example"); // sweeps again: nothing is idle, so nothing is forgotten
    expect(again - busy).toBe(1000);
    expect(rl.size).toBe(LIMITER_SWEEP_AT + 1);
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
