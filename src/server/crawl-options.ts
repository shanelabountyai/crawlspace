import type { CrawlOptions } from "@/lib/crawl";
import type { FixListModel } from "@/lib/fixlist";

/**
 * Test hook (D-27). Only scripts/e2e-server.ts sets this, in-process, before the app handles a request.
 * Nothing in env, config or HTTP input can set it, so production always uses the real SSRF guard (D-22/D-23).
 */
export const INJECT_KEY = Symbol.for("crawlspace.e2e.scanDeps");

export interface InjectedScanDeps {
  crawl?: Pick<CrawlOptions, "guard">;
  model?: FixListModel | null;
}

export function injectedDeps(): InjectedScanDeps | undefined {
  return (globalThis as { [INJECT_KEY]?: InjectedScanDeps })[INJECT_KEY];
}
