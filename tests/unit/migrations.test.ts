import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareMigrations, statements } from "../../scripts/compare-migrations";

const dir = join(process.cwd(), "prisma", "migrations");
const committed = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((n) => readFileSync(join(dir, n, "migration.sql"), "utf8"));
const all = committed.join("\n");

describe("migration drift comparator (D-41)", () => {
  it("splits SQL into statements without comments or blank lines", () => {
    expect(statements("-- c\nCREATE TABLE a (\n  x INT\n);\n\n-- d\nCREATE INDEX i ON a(x);\n")).toEqual(["CREATE TABLE a (\n  x INT\n)", "CREATE INDEX i ON a(x)"]);
  });

  it("accepts the committed migrations against a from-empty script with tables before indexes", () => {
    const stmts = statements(all);
    const reordered = [...stmts.filter((s) => s.startsWith("CREATE TABLE")), ...stmts.filter((s) => !s.startsWith("CREATE TABLE"))];
    expect(reordered).not.toEqual(stmts); // the line-by-line check would have failed here
    expect(compareMigrations(reordered.map((s) => `-- step\n${s};`).join("\n\n"), committed)).toEqual({ missing: [], extra: [] });
  });

  it("still catches a missing statement, an extra statement and a changed column", () => {
    const stmts = statements(all);
    expect(compareMigrations([...stmts, 'CREATE INDEX "Lead_email_idx" ON "Lead"("email")'].join(";\n") + ";", committed).missing).toHaveLength(1);
    expect(compareMigrations(stmts.slice(1).join(";\n") + ";", committed).extra).toHaveLength(1);
    const changed = all.replace('"email" TEXT NOT NULL', '"email" TEXT');
    const r = compareMigrations(changed, committed);
    expect(r.missing).toHaveLength(1);
    expect(r.extra).toHaveLength(1);
  });

  it("the Lead migration matches the schema's Lead model fields", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const model = /model Lead \{([\s\S]*?)\n\}/.exec(schema)![1]!;
    const cols = [...model.matchAll(/^\s+(\w+)\s+(String|DateTime)(\?)?/gm)].map((m) => m[1]);
    expect(cols).toEqual(["id", "scanId", "email", "createdAt", "hubspotStatus", "hubspotError"]);
    for (const c of cols) expect(all).toContain(`"${c}"`);
  });
});
