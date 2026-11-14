import { runChecks, type CheckResult } from "./checks/registry";
import { loadAgents, loadWeights, type Agent, type Weights } from "./rules";
import { score, type ScoreSummary } from "./score";
import { detectSiteType, type SiteTypeResult } from "./sitetype";
import type { Snapshot } from "./snapshot";

export interface Scorecard extends ScoreSummary {
  url: string;
  fetchedAt: string;
  siteType: SiteTypeResult["siteType"];
  siteTypeSource: SiteTypeResult["source"];
  rubricVersion: number;
  checks: CheckResult[];
}

export interface ScanOptions {
  agents?: readonly Agent[];
  weights?: Weights;
}

/** Pure: snapshot in, scorecard out. No I/O beyond the bundled rules files. */
export function scanSnapshot(snapshot: Snapshot, opts: ScanOptions = {}): Scorecard {
  const weights = opts.weights ?? loadWeights();
  const agents = opts.agents ?? loadAgents();
  const st = detectSiteType(snapshot);
  const checks = runChecks(snapshot, st.siteType, agents, weights);
  return {
    url: snapshot.url,
    fetchedAt: snapshot.fetchedAt,
    siteType: st.siteType,
    siteTypeSource: st.source,
    rubricVersion: weights.version,
    ...score(checks, weights),
    checks,
  };
}
