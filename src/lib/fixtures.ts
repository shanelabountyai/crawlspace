import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CATEGORIES } from "./checks/types";
import { loadAgents, STATUSES, type Agent } from "./rules";
import { loadSnapshotFromDir, SiteTypeSchema, type Snapshot } from "./snapshot";

export const FIXTURES_DIR = join(process.cwd(), "fixtures");
export const SITES_DIR = join(FIXTURES_DIR, "sites");

const pct = z.number().min(0).max(100).nullable();
export const ExpectedSchema = z
  .object({
    siteType: SiteTypeSchema,
    overall: pct,
    categories: z.object(Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, pct])) as Record<keyof typeof CATEGORIES, typeof pct>).strict(),
    checks: z.record(z.string(), z.enum(STATUSES)),
  })
  .strict();
export type Expected = z.infer<typeof ExpectedSchema>;

export function listFixtures(): string[] {
  return readdirSync(SITES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SITES_DIR, d.name, "snapshot.json")))
    .map((d) => d.name)
    .sort();
}

export function fixtureSnapshot(name: string): Snapshot {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid fixture name: ${name}`);
  return loadSnapshotFromDir(join(SITES_DIR, name));
}

export function fixtureExpected(name: string): Expected {
  return ExpectedSchema.parse(JSON.parse(readFileSync(join(SITES_DIR, name, "expected.json"), "utf8")));
}

export function fixtureAgents(): Agent[] {
  return loadAgents(JSON.parse(readFileSync(join(FIXTURES_DIR, "agents.fixture.json"), "utf8")));
}
