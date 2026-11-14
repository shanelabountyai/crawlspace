import { CATEGORIES, type Category, type CheckResult } from "./checks/types";
import type { Weights } from "./rules";

export interface ScoreSummary {
  overall: number | null;
  categories: Record<Category, number | null>;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Weighted percent over applicable checks. N/A results are excluded from numerator and denominator (CS-05). */
export function weightedPercent(results: readonly CheckResult[], weights: Weights): number | null {
  let num = 0;
  let den = 0;
  for (const r of results) {
    if (r.status === "not-applicable") continue;
    num += r.weight * weights.statusValues[r.status];
    den += r.weight;
  }
  return den === 0 ? null : round1((100 * num) / den);
}

export function score(results: readonly CheckResult[], weights: Weights): ScoreSummary {
  const categories = Object.fromEntries(
    (Object.keys(CATEGORIES) as Category[]).map((c) => [c, weightedPercent(results.filter((r) => r.category === c), weights)]),
  ) as Record<Category, number | null>;
  return { overall: weightedPercent(results, weights), categories };
}
