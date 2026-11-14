/** Crawl rules (PRD §4). Constants, not knobs: tests assert against these exact values (CS-02). */
export const USER_AGENT = "CrawlspaceBot/0.1 (+https://github.com/shanelabountyai/crawlspace)";
export const ROBOTS_TOKEN = "CrawlspaceBot";

/** Max page-level requests per scan: robots.txt, sitemap(s), llms.txt and HTML pages, redirect hops included. */
export const MAX_PAGES = 15;
/** Product/event pages taken from the sitemap or links. */
export const MAX_KEY_PAGES = 5;
/** Minimum gap between request starts to the same host. */
export const MIN_INTERVAL_MS = 1000;

/** Scripts/XHR a rendered page may load (fetched through the same guarded GET-only client). */
export const MAX_ASSETS_PER_PAGE = 10;
export const MAX_ASSETS_TOTAL = 40;

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const RENDER_TIMEOUT_MS = 15_000;
export const RENDER_IDLE_MS = 2_000;
