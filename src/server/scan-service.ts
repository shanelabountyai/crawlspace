import { assertAllowed, CrawlRefused, normaliseStartUrl, scanUrl, SsrfError, type CrawlOptions } from "@/lib/crawl";
import { generateFixList, type FixListModel } from "@/lib/fixlist";
import { modelFromEnv } from "./anthropic-model";
import { injectedDeps } from "./crawl-options";
import { getDb } from "./db";
import { hubspotFromEnv } from "./hubspot";
import { LeadService } from "./lead-service";
import { LeadStore, ScanStore, summariseCrawl } from "./store";

/** Scans waiting or running at once (D-29). */
export const QUEUE_LIMIT = 5;
export const MAX_URL_LENGTH = 2048;

export type SubmitResult = { ok: true; id: string; url: string } | { ok: false; status: 400 | 429; error: string };

export interface ScanServiceDeps {
  crawl?: Pick<CrawlOptions, "guard" | "render" | "renderer">;
  model?: FixListModel | null;
  queueLimit?: number;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Web scans. Same path as the CLI: normaliseStartUrl + assertAllowed (SSRF guard) up front, then scanUrl
 * (crawl + engine) and the fix list. One crawl at a time, in process (D-29).
 */
export class ScanService {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(readonly store: ScanStore, private readonly deps: ScanServiceDeps = {}) {}

  async submit(input: unknown): Promise<SubmitResult> {
    if (typeof input !== "string" || !input.trim()) return { ok: false, status: 400, error: "enter a website address" };
    if (input.length > MAX_URL_LENGTH) return { ok: false, status: 400, error: "that address is too long" };
    let url: string;
    try {
      url = normaliseStartUrl(input);
      await assertAllowed(url, this.deps.crawl?.guard); // CS-03: refused before any row, queue slot or connection
    } catch (e) {
      if (e instanceof SsrfError) return { ok: false, status: 400, error: `refused: ${e.message}` };
      throw e;
    }
    if (this.pending >= (this.deps.queueLimit ?? QUEUE_LIMIT)) return { ok: false, status: 429, error: "the scanner is busy; try again in a minute" };
    const id = await this.store.create(url);
    this.pending++;
    this.chain = this.chain.then(() => this.run(id, url)).finally(() => {
      this.pending--;
    });
    return { ok: true, id, url };
  }

  /** Resolves when every queued scan has finished (tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  private async run(id: string, url: string): Promise<void> {
    try {
      await this.store.markRunning(id);
      const { card, report } = await scanUrl(url, { ...(this.deps.crawl ?? {}) });
      const fixList = await generateFixList(card, { model: this.deps.model ?? null });
      await this.store.markDone(id, card, fixList, summariseCrawl(report));
    } catch (e) {
      const why = e instanceof CrawlRefused || e instanceof SsrfError ? `refused: ${message(e)}` : `scan failed: ${message(e)}`;
      await this.store.markFailed(id, why).catch(() => undefined);
    }
  }
}

const KEY = Symbol.for("crawlspace.scanService");
type Holder = { [KEY]?: Promise<ScanService> };

/** Production wiring: real SSRF guard and the env-configured model, unless the e2e harness injected test deps (D-27). */
export function resolveDeps(): ScanServiceDeps {
  const injected = injectedDeps();
  return {
    crawl: injected?.crawl ? { guard: injected.crawl.guard } : {},
    model: injected && "model" in injected ? (injected.model ?? null) : modelFromEnv(),
  };
}

export function getScanService(): Promise<ScanService> {
  const g = globalThis as Holder;
  g[KEY] ??= (async () => {
    const store = new ScanStore(getDb());
    await store.failInterrupted();
    return new ScanService(store, resolveDeps());
  })();
  return g[KEY];
}

const LEADS_KEY = Symbol.for("crawlspace.leadService");
type LeadHolder = { [LEADS_KEY]?: Promise<LeadService> };

/** Production wiring for the PDF gate: same DB as the scans; HubSpot only if the flag is on (D-36). */
export function getLeadService(): Promise<LeadService> {
  const g = globalThis as LeadHolder;
  g[LEADS_KEY] ??= (async () => {
    const svc = await getScanService();
    return new LeadService(svc.store, new LeadStore(getDb()), hubspotFromEnv());
  })();
  return g[LEADS_KEY];
}
