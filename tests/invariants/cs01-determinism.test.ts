import { describe, expect, it } from "vitest";
import { CHECKS, runCheck } from "@/lib/checks/registry";
import { buildContext } from "@/lib/checks/types";
import { fixtureAgents, fixtureSnapshot, listFixtures } from "@/lib/fixtures";
import { loadWeights } from "@/lib/rules";
import { scanSnapshot } from "@/lib/scan";
import { detectSiteType } from "@/lib/sitetype";

// CS-01: every check is deterministic over the same snapshot.
describe("CS-01 determinism", () => {
  const weights = loadWeights();
  const agents = fixtureAgents();

  for (const name of listFixtures()) {
    it(`${name}: each check returns identical output twice and on a deep clone`, () => {
      const snap = fixtureSnapshot(name);
      const frozen = JSON.stringify(snap);
      const { siteType } = detectSiteType(snap);
      for (const check of CHECKS) {
        const first = runCheck(check, buildContext(snap, siteType, agents), weights);
        const second = runCheck(check, buildContext(snap, siteType, agents), weights);
        const clone = runCheck(check, buildContext(structuredClone(snap), siteType, agents), weights);
        expect(second, `${name} ${check.id} second run`).toEqual(first);
        expect(clone, `${name} ${check.id} on clone`).toEqual(first);
      }
      // Checks never mutate the snapshot.
      expect(JSON.stringify(snap)).toBe(frozen);
    });

    it(`${name}: full scan is byte-identical across runs`, () => {
      const a = JSON.stringify(scanSnapshot(fixtureSnapshot(name), { agents }));
      const b = JSON.stringify(scanSnapshot(fixtureSnapshot(name), { agents }));
      expect(b).toBe(a);
    });
  }
});
