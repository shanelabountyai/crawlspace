import { describe, expect, it } from "vitest";
import type { CheckResult } from "@/lib/checks/types";
import { fixtureAgents, fixtureSnapshot, listFixtures } from "@/lib/fixtures";
import { loadWeights } from "@/lib/rules";
import { scanSnapshot } from "@/lib/scan";
import { score } from "@/lib/score";

// CS-05: N/A checks never change the score.
describe("CS-05 N/A checks are score-neutral", () => {
  const weights = loadWeights();
  const agents = fixtureAgents();

  it("at least one fixture has N/A checks (so this invariant is exercised)", () => {
    const withNa = listFixtures().filter((n) => scanSnapshot(fixtureSnapshot(n), { agents }).checks.some((c) => c.status === "not-applicable"));
    expect(withNa.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of listFixtures()) {
    it(`${name}: dropping, re-weighting or duplicating N/A results leaves every score unchanged`, () => {
      const card = scanSnapshot(fixtureSnapshot(name), { agents });
      const base = score(card.checks, weights);
      const na = card.checks.filter((c) => c.status === "not-applicable");
      const applicable = card.checks.filter((c) => c.status !== "not-applicable");

      expect(score(applicable, weights)).toEqual(base);
      const heavy: CheckResult[] = card.checks.map((c) => (c.status === "not-applicable" ? { ...c, weight: 1000 } : c));
      expect(score(heavy, weights)).toEqual(base);
      expect(score([...card.checks, ...na, ...na], weights)).toEqual(base);
      const zeroed: CheckResult[] = card.checks.map((c) => (c.status === "not-applicable" ? { ...c, weight: 0 } : c));
      expect(score(zeroed, weights)).toEqual(base);
    });
  }

  it("an all-N/A category scores null rather than 100", () => {
    const card = scanSnapshot(fixtureSnapshot("good-shop"), { agents });
    const onlyNa = card.checks.map((c) => (c.category === "C" ? { ...c, status: "not-applicable" as const } : c));
    expect(score(onlyNa, weights).categories.C).toBeNull();
  });

  it("other-site: ecommerce/event checks are N/A and the score equals the score of the remaining checks", () => {
    const card = scanSnapshot(fixtureSnapshot("other-site"), { agents });
    const na = card.checks.filter((c) => c.status === "not-applicable").map((c) => c.id);
    expect(na).toEqual(expect.arrayContaining(["C2", "C3", "E1", "E3", "E4"]));
    let num = 0;
    let den = 0;
    for (const c of card.checks) {
      if (c.status === "not-applicable") continue;
      num += c.weight * weights.statusValues[c.status];
      den += c.weight;
    }
    expect(card.overall).toBe(Math.round((1000 * num) / den) / 10);
  });
});
