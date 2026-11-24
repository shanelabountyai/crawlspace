import { isAllowed, robotsAccess, sitemapsFromRobots, type RobotsFetch, type RobotsGroup } from "../robots";
import { WALL_STATUSES } from "../checks/a4-no-bot-wall";
import { pathOf } from "../html";
import { SnapshotSchema, type Page, type PageKind, type Resource, type Snapshot } from "../snapshot";
import { MAX_KEY_PAGES, ROBOTS_TOKEN } from "./config";
import { extractLinks, findActionLink, guessSiteType, pageKind, parseSitemap, pickKeyPages, sameSite } from "./discover";
import { BudgetExceeded, Fetcher, type FetchResult, type FetcherOptions, type GetOptions } from "./fetcher";
import { NoRenderer, PlaywrightRenderer, type RenderEvent, type Renderer } from "./render";
import { assertAllowed, parseTarget, SsrfError } from "./ssrf";

export interface CrawlOptions extends FetcherOptions {
  /** Render pages in headless Chromium (default true). */
  render?: boolean;
  /** Inject a renderer (tests). */
  renderer?: (fetcher: Fetcher) => Renderer;
}

export interface CrawlReport {
  requests: Fetcher["log"];
  renderEvents: RenderEvent[];
  skipped: { url: string; reason: string }[];
  notes: string[];
  /** False when any page could not be rendered or rendering was switched off; same value as `snapshot.rendered`. */
  rendered: boolean;
}

export interface CrawlResult {
  snapshot: Snapshot;
  report: CrawlReport;
}

export class CrawlRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlRefused";
  }
}

/**
 * Accept "example.com" and "example.com:8443" as well as full URLs; only http(s). The input counts as having a scheme
 * only if it starts with one followed by "://" or starts with http: / https:, so the "host:" of host:port is not read
 * as one (PRD-02 requirement 7; review 2026-11-20, UX-5). A "://" further in, as in "shop.example/go?to=https://x", is
 * part of the address, not a scheme (D-125). Anything else gets https:// and is then vetted by `parseTarget`.
 */
export function normaliseStartUrl(input: string): string {
  const trimmed = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^https?:/i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
  const url = parseTarget(withScheme);
  url.hash = "";
  return url.href;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Crawl one site politely, starting at its home page, and return a snapshot the Phase 1 engine can score. */
export async function crawlSite(input: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const enteredUrl = normaliseStartUrl(input);
  await assertAllowed(enteredUrl, opts.guard); // CS-03: refused before anything is sent
  // A site is scored from its home page: the crawl starts at the origin root whatever path, query or fragment was
  // entered (PRD-02 requirement 4; review 2026-11-20, UX-1; Decision 3b). The address as entered stays on the scan row.
  const startUrl = `${new URL(enteredUrl).origin}/`;

  const fetcher = new Fetcher(opts);
  const renderOff = !opts.renderer && opts.render === false;
  const renderer = opts.renderer ? opts.renderer(fetcher) : renderOff ? new NoRenderer() : new PlaywrightRenderer(fetcher);
  const report: CrawlReport = { requests: fetcher.log, renderEvents: renderer.events, skipped: [], notes: [], rendered: !renderOff };
  const fetchedAt = new Date().toISOString();

  const tryGet = async (url: string, why: string, options?: GetOptions): Promise<FetchResult | null> => {
    try {
      return await fetcher.get(url, "page", options);
    } catch (e) {
      if (e instanceof CrawlRefused) throw e; // a robots.txt stop raised from a redirect hop
      if (e instanceof BudgetExceeded) report.skipped.push({ url, reason: `page budget used up (${why})` });
      else if (e instanceof SsrfError) report.skipped.push({ url, reason: `refused: ${e.message}` });
      else report.notes.push(`${why} ${url} failed: ${errText(e)}`);
      return null;
    }
  };
  const resource = (url: string, r: FetchResult | null): Resource => ({ url, status: r?.status ?? 0, body: r && r.status === 200 ? r.body : null });

  try {
    // 1. robots.txt for our own user agent. Each origin's file is read once, before anything else is fetched there.
    const origin0 = new URL(startUrl).origin;
    interface OriginRobots {
      resource: Resource;
      groups: RobotsGroup[];
      /** How messages name this file: "robots.txt" for the origin that was entered. */
      label: string;
    }
    const robotsByOrigin = new Map<string, OriginRobots>();
    const reading = new Set<string>();
    const robotsFor = async (origin: string): Promise<OriginRobots> => {
      const known = robotsByOrigin.get(origin);
      if (known) return known;
      const url = `${origin}/robots.txt`;
      const label = origin === origin0 ? "robots.txt" : `robots.txt on ${new URL(origin).host} (the home page redirects there)`;
      // Two robots.txt files that redirect into each other's sites: neither can be read.
      if (reading.has(origin)) throw new CrawlRefused(`${label} could not be read (redirect loop between robots.txt files); treating as disallow-all and not scanning`);
      let res: FetchResult | null = null;
      let fetched: RobotsFetch;
      reading.add(origin);
      try {
        // A robots.txt may itself redirect. A hop on the same origin, or to another origin's /robots.txt, is followed;
        // a hop to any other path on another origin (a moved site sending every path to its new home page) is a
        // request to that origin like any other, so that origin's robots.txt is read and applied first (D-125).
        const beforeRedirect = async (hop: string): Promise<void> => {
          const h = new URL(hop);
          if (h.origin !== origin && h.pathname !== "/robots.txt") await assertRobotsAllow(hop);
        };
        res = await fetcher.get(url, "page", { beforeRedirect });
        fetched = { status: res.status, body: res.body };
      } catch (e) {
        if (e instanceof CrawlRefused) throw e;
        fetched = { error: errText(e) };
      } finally {
        reading.delete(origin);
      }
      // RFC 9309: 4xx = no rules; 5xx or unreachable = treat as "disallow all", so we do not scan (D-24, Decision 10a).
      const access = robotsAccess(fetched);
      if (!access.ok) throw new CrawlRefused(`${label} ${access.why}; treating as disallow-all and not scanning`);
      const entry: OriginRobots = { resource: resource(url, res), groups: access.groups, label };
      robotsByOrigin.set(origin, entry);
      return entry;
    };
    /** Throws CrawlRefused unless the URL's origin has a readable robots.txt that lets CrawlspaceBot fetch it. */
    const assertRobotsAllow = async (url: string): Promise<void> => {
      const { groups, label } = await robotsFor(new URL(url).origin);
      if (!isAllowed(groups, ROBOTS_TOKEN, pathOf(url)).allowed) throw new CrawlRefused(`${label} disallows ${ROBOTS_TOKEN} from ${pathOf(url)}; not scanning`);
    };
    await assertRobotsAllow(startUrl);

    // 2. home page (follows redirects; the final URL defines the site). Before each redirect hop is requested, the
    //    robots.txt of the hop's origin is read and applied, so a site that says no gets no request but that file.
    const homeRes = await tryGet(startUrl, "home page", { beforeRedirect: assertRobotsAllow });
    if (!homeRes) throw new CrawlRefused(`could not fetch the home page: ${report.notes.at(-1) ?? report.skipped.at(-1)?.reason ?? "unknown error"}`);
    const home = homeRes.url;
    const origin = new URL(home).origin;
    // A home page that answers 4xx/5xx is an error page, not the site: stop instead of scoring it (PRD-02 requirement 5;
    // Decision 3c). The exception is the statuses A4 reports as a bot wall (401, 403, 429, 503): that is what an agent
    // meets too, so it stays a finding on a finished report (D-15). Only the status decides: an ordinary 404 or 500
    // page that happens to carry a challenge script is still an error page (D-121).
    if (homeRes.status >= 400 && !WALL_STATUSES.has(homeRes.status)) {
      throw new CrawlRefused(`the home page ${home} answered HTTP ${homeRes.status}; not scanning`);
    }
    if (origin !== origin0) report.notes.push(`home redirected to ${origin}; using its robots.txt`);
    const { resource: robots, groups } = await robotsFor(origin);
    const allowed = (url: string) => isAllowed(groups, ROBOTS_TOKEN, pathOf(url)).allowed;

    // 3. sitemap (robots.txt pointer first, then /sitemap.xml; one level of sitemap index)
    const pointed = robots.body ? sitemapsFromRobots(robots.body).find((u) => sameSite(u, home)) : undefined;
    const sitemapUrl = pointed ?? `${origin}/sitemap.xml`;
    const smRes = await tryGet(sitemapUrl, "sitemap");
    const sitemap = resource(sitemapUrl, smRes);
    let sitemapUrls: string[] = [];
    if (sitemap.body) {
      const parsed = parseSitemap(sitemap.body);
      sitemapUrls = parsed.urls;
      const child = parsed.childSitemaps.find((u) => sameSite(u, home));
      if (child) {
        const c = await tryGet(child, "child sitemap");
        if (c && c.status === 200) {
          sitemapUrls = parseSitemap(c.body).urls;
          sitemap.body = `${sitemap.body}\n<!-- child sitemap ${child} -->\n${c.body}`;
        }
      }
    }

    // 4. llms.txt
    const llmsRes = await tryGet(`${origin}/llms.txt`, "llms.txt");
    const llms = resource(`${origin}/llms.txt`, llmsRes);

    // 5. key pages
    const homeLinks = extractLinks(homeRes.body, home);
    const hint = guessSiteType(homeRes.body, [...homeLinks.map((l) => l.url), ...sitemapUrls]);
    const { picked, skipped } = pickKeyPages(hint, home, homeLinks, sitemapUrls, MAX_KEY_PAGES, allowed);
    for (const u of skipped) report.skipped.push({ url: u, reason: `robots.txt disallows ${ROBOTS_TOKEN}` });
    const fetched: { res: FetchResult; kind: PageKind }[] = [{ res: homeRes, kind: "home" }];
    for (const u of picked) {
      const r = await tryGet(u, "key page");
      if (r) fetched.push({ res: r, kind: pageKind(r.url, r.body) === "other" ? (hint === "event" ? "event" : "product") : pageKind(r.url, r.body) });
    }

    // 6. cart / registration entry (GET only, never submitted)
    const action = findActionLink(hint, fetched.map((f) => ({ url: f.res.url, html: f.res.body })));
    if (action && !fetched.some((f) => f.res.url === action.url)) {
      if (!allowed(action.url)) report.skipped.push({ url: action.url, reason: `robots.txt disallows ${ROBOTS_TOKEN}` });
      else {
        const r = await tryGet(action.url, "action page");
        if (r) fetched.push({ res: r, kind: action.kind });
      }
    }

    // 7. render every fetched page (document served from the bytes already downloaded)
    const pages: Page[] = [];
    const counts = new Map<string, number>();
    let renderFailures = 0;
    for (const { res, kind } of fetched) {
      let rendered = res.body;
      try {
        rendered = await renderer.render(res);
      } catch (e) {
        renderFailures++;
        report.notes.push(`render of ${res.url} failed, using raw HTML: ${errText(e)}`);
      }
      const n = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, n);
      pages.push({ id: kind === "home" ? "home" : `${kind}-${n}`, url: res.url, kind, status: res.status, ttfbMs: res.ttfbMs, rawHtml: res.body, renderedHtml: rendered });
    }

    // A page whose "rendered" HTML is only its raw HTML must not be scored as if it had been rendered (PRD-02
    // requirement 6; review 2026-11-20, CQ-3): the flag makes the rendered-view checks N/A, and the note says why.
    const naNote = "the checks that need the rendered page (categories B and E) are marked not applicable";
    if (renderOff) report.notes.push(`rendering was switched off; ${naNote}`);
    else if (renderFailures > 0) {
      report.rendered = false;
      report.notes.push(`rendering failed for ${renderFailures} of ${fetched.length} pages; ${naNote}`);
    }

    const snapshot = SnapshotSchema.parse({ url: home, fetchedAt, siteTypeOverride: null, robots, sitemap, llms, pages, rendered: report.rendered });
    return { snapshot, report };
  } finally {
    await renderer.close();
    await fetcher.close();
  }
}
