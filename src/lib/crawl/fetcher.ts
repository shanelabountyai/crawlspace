import { Agent, request } from "undici";
import { MAX_ASSETS_TOTAL, MAX_BODY_BYTES, MAX_PAGES, MAX_REDIRECTS, MIN_INTERVAL_MS, REQUEST_TIMEOUT_MS, USER_AGENT } from "./config";
import { HostRateLimiter, realClock, sharedHostRateLimiter, type Clock } from "./ratelimit";
import { assertAllowed, guardedLookup, parseTarget, type GuardOptions } from "./ssrf";

export type RequestKind = "page" | "asset";

export interface RequestLogEntry {
  method: "GET";
  url: string;
  kind: RequestKind;
  startedAt: number;
  status?: number;
  error?: string;
}

export interface FetchResult {
  requestedUrl: string;
  url: string;
  status: number;
  contentType: string | null;
  body: string;
  ttfbMs: number;
  redirects: string[];
}

export class BudgetExceeded extends Error {
  constructor(readonly kind: RequestKind, readonly limit: number) {
    super(`${kind} budget of ${limit} requests used up`);
    this.name = "BudgetExceeded";
  }
}

export interface GetOptions {
  /**
   * Called before each redirect hop is requested, after the SSRF check on it and before it counts against the budget.
   * Throw to stop: nothing is sent to the hop's URL. The crawler reads the new origin's robots.txt here (PRD-02
   * requirement 1).
   */
  beforeRedirect?: (url: string) => Promise<void>;
}

export interface FetcherOptions {
  guard?: GuardOptions;
  /** Tests: a clock of their own. A fetcher given one gets a private limiter on that clock unless `limiter` is set. */
  clock?: Clock;
  /** Default: the process-wide limiter shared by every scan (PRD-02 requirement 3). */
  limiter?: HostRateLimiter;
  maxPages?: number;
  maxAssets?: number;
  timeoutMs?: number;
}

/**
 * The only way Crawlspace touches the network. GET only (there is no method parameter), every hop SSRF-checked
 * before connecting and again at connect time, 1 request/second per host across every scan in the process, hard
 * request budgets per scan.
 */
export class Fetcher {
  readonly log: RequestLogEntry[] = [];
  private pages = 0;
  private assets = 0;
  private readonly limiter: HostRateLimiter;
  private readonly agent: Agent;
  private readonly clock: Clock;
  private readonly maxPages: number;
  private readonly maxAssets: number;
  private readonly timeoutMs: number;

  constructor(private readonly opts: FetcherOptions = {}) {
    this.clock = opts.clock ?? realClock;
    this.limiter = opts.limiter ?? (opts.clock ? new HostRateLimiter(MIN_INTERVAL_MS, this.clock) : sharedHostRateLimiter());
    this.maxPages = Math.min(opts.maxPages ?? MAX_PAGES, MAX_PAGES);
    this.maxAssets = Math.min(opts.maxAssets ?? MAX_ASSETS_TOTAL, MAX_ASSETS_TOTAL);
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.agent = new Agent({ connect: { lookup: guardedLookup(opts.guard), timeout: this.timeoutMs }, connections: 2 });
  }

  get pagesUsed(): number {
    return this.pages;
  }
  get assetsUsed(): number {
    return this.assets;
  }
  pagesLeft(): number {
    return this.maxPages - this.pages;
  }

  private take(kind: RequestKind): void {
    if (kind === "page") {
      if (this.pages >= this.maxPages) throw new BudgetExceeded(kind, this.maxPages);
      this.pages++;
    } else {
      if (this.assets >= this.maxAssets) throw new BudgetExceeded(kind, this.maxAssets);
      this.assets++;
    }
  }

  async get(rawUrl: string, kind: RequestKind, options: GetOptions = {}): Promise<FetchResult> {
    const redirects: string[] = [];
    let url = parseTarget(rawUrl).href;
    for (let hop = 0; ; hop++) {
      await assertAllowed(url, this.opts.guard); // refuse before any connection (CS-03)
      if (hop > 0) await options.beforeRedirect?.(url);
      this.take(kind); // a redirect hop is a request and counts (CS-02)
      const host = new URL(url).host;
      const startedAt = await this.limiter.acquire(host); // the granted slot (D-47)
      const entry: RequestLogEntry = { method: "GET", url, kind, startedAt };
      this.log.push(entry);
      const t0 = performance.now();
      let res;
      try {
        res = await request(url, {
          method: "GET",
          dispatcher: this.agent,
          headers: { "user-agent": USER_AGENT, accept: kind === "page" ? "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5" : "*/*" },
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
          signal: AbortSignal.timeout(this.timeoutMs * 2),
        });
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        throw e;
      }
      const ttfbMs = Math.round(performance.now() - t0);
      entry.status = res.statusCode;
      const location = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        await res.body.dump({ limit: 64 * 1024 }).catch(() => undefined);
        if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects from ${rawUrl}`);
        redirects.push(url);
        url = parseTarget(new URL(Array.isArray(location) ? location[0]! : location, url).href).href;
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buf.length;
        if (size > MAX_BODY_BYTES) {
          res.body.on("error", () => undefined);
          res.body.destroy();
          entry.error = `body larger than ${MAX_BODY_BYTES} bytes, truncated`;
          break;
        }
        chunks.push(buf);
      }
      const ct = res.headers["content-type"];
      return {
        requestedUrl: rawUrl,
        url,
        status: res.statusCode,
        contentType: (Array.isArray(ct) ? ct[0] : ct) ?? null,
        body: new TextDecoder("utf-8").decode(Buffer.concat(chunks)),
        ttfbMs,
        redirects,
      };
    }
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}
