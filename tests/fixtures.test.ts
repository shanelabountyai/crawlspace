import { describe, expect, it } from "vitest";
import { CHECKS } from "@/lib/checks/registry";
import { fixtureAgents, fixtureExpected, fixtureSnapshot, listFixtures } from "@/lib/fixtures";
import { scanSnapshot } from "@/lib/scan";

const fixtures = listFixtures();

describe("fixture sites", () => {
  it("has at least 8 fixtures covering every site type", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    const types = new Set(fixtures.map((f) => fixtureExpected(f).siteType));
    expect([...types].sort()).toEqual(["ecommerce", "event", "other"]);
  });

  it.each(fixtures)("%s matches expected.json", (name) => {
    const expected = fixtureExpected(name);
    const card = scanSnapshot(fixtureSnapshot(name), { agents: fixtureAgents() });
    expect(card.siteType).toBe(expected.siteType);
    expect(Object.keys(expected.checks).sort()).toEqual(CHECKS.map((c) => c.id).sort());
    const statuses = Object.fromEntries(card.checks.map((c) => [c.id, c.status]));
    expect(statuses).toEqual(expected.checks);
    expect(card.categories).toEqual(expected.categories);
    expect(card.overall).toBe(expected.overall);
  });

  it.each(fixtures)("%s: every non-N/A result carries evidence", (name) => {
    const card = scanSnapshot(fixtureSnapshot(name), { agents: fixtureAgents() });
    for (const c of card.checks) {
      expect(c.evidence.length, `${name} ${c.id}`).toBeGreaterThan(0);
      for (const e of c.evidence) expect(e.detail.length).toBeGreaterThan(0);
    }
  });

  it("uses no real company names or real domains (only .example hosts)", () => {
    for (const name of fixtures) {
      const s = fixtureSnapshot(name);
      for (const p of s.pages) expect(new URL(p.url).hostname.endsWith(".example")).toBe(true);
      expect(new URL(s.url).hostname.endsWith(".example")).toBe(true);
    }
  });
});

describe("real agent list (rules/agents.json)", () => {
  it("A2 is not-applicable while no agent has been verified (D-10)", () => {
    const card = scanSnapshot(fixtureSnapshot("ai-blocking-shop"));
    const a2 = card.checks.find((c) => c.id === "A2")!;
    expect(a2.status).toBe("not-applicable");
  });
});
