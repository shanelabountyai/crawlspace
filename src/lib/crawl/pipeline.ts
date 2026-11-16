import { scanSnapshot, type ScanOptions, type Scorecard } from "../scan";
import type { Snapshot } from "../snapshot";
import { crawlSite, type CrawlOptions, type CrawlReport } from "./crawl";

export interface UrlScanResult {
  card: Scorecard;
  snapshot: Snapshot;
  report: CrawlReport;
}

/**
 * The one way a URL becomes a scorecard, for the CLI and the web app alike:
 * SSRF guard + polite crawl + render (crawlSite), then the Phase 1 engine (scanSnapshot).
 */
export async function scanUrl(input: string, opts: CrawlOptions & ScanOptions = {}): Promise<UrlScanResult> {
  const { agents, weights, ...crawlOpts } = opts;
  const { snapshot, report } = await crawlSite(input, crawlOpts);
  const card = scanSnapshot(snapshot, { agents, weights });
  return { card, snapshot, report };
}
