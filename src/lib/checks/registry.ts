import type { Agent, Weights } from "../rules";
import type { SiteType, Snapshot } from "../snapshot";
import { a1RobotsReachable } from "./a1-robots-reachable";
import { a2AiAgentsAllowed } from "./a2-ai-agents-allowed";
import { a3SitemapFresh } from "./a3-sitemap-fresh";
import { a4NoBotWall } from "./a4-no-bot-wall";
import { b1KeyContentRaw } from "./b1-key-content-raw";
import { b2TextDiff } from "./b2-text-diff";
import { c1JsonLdParses } from "./c1-jsonld-parses";
import { c2ProductOffer } from "./c2-product-offer";
import { c3EventComplete } from "./c3-event-complete";
import { c4Organization } from "./c4-organization";
import { d1LlmsTxt } from "./d1-llms-txt";
import { d2OpenGraph } from "./d2-opengraph";
import { e1PrimaryCta } from "./e1-primary-cta";
import { e2FormLabels } from "./e2-form-labels";
import { e3GuestPath } from "./e3-guest-path";
import { e4CaptchaFirstStep } from "./e4-captcha-first-step";
import { f1Ttfb } from "./f1-ttfb";
import { f2HtmlSize } from "./f2-html-size";
import { buildContext, type CheckContext, type CheckDefinition, type CheckResult } from "./types";

export const CHECKS: readonly CheckDefinition[] = [
  a1RobotsReachable, a2AiAgentsAllowed, a3SitemapFresh, a4NoBotWall,
  b1KeyContentRaw, b2TextDiff,
  c1JsonLdParses, c2ProductOffer, c3EventComplete, c4Organization,
  d1LlmsTxt, d2OpenGraph,
  e1PrimaryCta, e2FormLabels, e3GuestPath, e4CaptchaFirstStep,
  f1Ttfb, f2HtmlSize,
];

export function applies(check: CheckDefinition, siteType: SiteType): boolean {
  return check.appliesTo === "all" || check.appliesTo.includes(siteType);
}

/** Evidence on a rendered-view check when the snapshot's pages were not rendered (PRD-02 requirement 6). */
export const NOT_RENDERED_DETAIL = "page could not be rendered";

/**
 * Run one check against a context; adds id/category/title/weight and applies the two N/A rules: the check does not
 * apply to the site type, or it reads the rendered view and the pages were not rendered. N/A never changes the
 * score (CS-05).
 */
export function runCheck(check: CheckDefinition, ctx: CheckContext, weights: Weights): CheckResult {
  const weight = weights.checks[check.id];
  if (weight === undefined) throw new Error(`rules/weights.json has no weight for ${check.id}`);
  const na = (detail: string) => ({ status: "not-applicable" as const, evidence: [{ detail }] });
  const outcome = !applies(check, ctx.siteType)
    ? na(`does not apply to site type '${ctx.siteType}'`)
    : check.needsRendered && !ctx.snapshot.rendered
      ? na(NOT_RENDERED_DETAIL)
      : check.run(ctx);
  const base = { id: check.id, category: check.category, title: check.title, weight, status: outcome.status, evidence: outcome.evidence };
  return check.label ? { ...base, label: check.label } : base;
}

export function runChecks(snapshot: Snapshot, siteType: SiteType, agents: readonly Agent[], weights: Weights): CheckResult[] {
  const ctx = buildContext(snapshot, siteType, agents);
  return CHECKS.map((c) => runCheck(c, ctx, weights));
}

export * from "./types";
