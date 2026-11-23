import { isAllowed, robotsAccess, sitemapsFromRobots, type RobotsFetch, type RobotsGroup } from "../robots";
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
 * only if it contains "://" or starts with http: / https:, so the "host:" of host:port is not read as one (PRD-02
 * requirement 7; review 2026-11-20, UX-5). Anything else gets https:// and is then vetted by `parseTarget`.
 */
export function normaliseStartUrl(input: string): string {
  const trimmed = input.trim();
  const hasScheme = trimmed.includes("://") || /^https?:/i.test(trimmed);
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
  const renderer = opts.renderer ? opts.renderer(fetcher) : opts.render === false ? new NoRenderer() : new PlaywrightRenderer(fetcher);
  const report: CrawlReport = { requests: fetcher.log, renderEvents: renderer.events, skipped: [], notes: [] };
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
    const robotsFor = async (origin: string): Promise<OriginRobots> => {
      const known = robotsByOrigin.get(origin);
      if (known) return known;
      const url = `${origin}/robots.txt`;
      const label = origin === origin0 ? "robots.txt" : `robots.txt on ${new URL(origin).host} (the home page redirects there)`;
      let res: FetchResult | null = null;
      let fetched: RobotsFetch;
      try {
        res = await fetcher.get(url, "page");
        fetched = { status: res.status, body: res.body };
      } catch (e) {
        fetched = { error: errText(e) };
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
    for (const { res, kind } of fetched) {
      let rendered = res.body;
      try {
        rendered = await renderer.render(res);
      } catch (e) {
        report.notes.push(`render of ${res.url} failed, using raw HTML: ${errText(e)}`);
      }
      const n = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, n);
      pages.push({ id: kind === "home" ? "home" : `${kind}-${n}`, url: res.url, kind, status: res.status, ttfbMs: res.ttfbMs, rawHtml: res.body, renderedHtml: rendered });
    }

    const snapshot = SnapshotSchema.parse({ url: home, fetchedAt, siteTypeOverride: null, robots, sitemap, llms, pages });
    return { snapshot, report };
  } finally {
    await renderer.close();
    await fetcher.close();
  }
}
