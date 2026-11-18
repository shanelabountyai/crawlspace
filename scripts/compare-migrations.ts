/**
 * Migration drift comparator (D-41): the committed migrations must contain exactly the SQL statements Prisma
 * generates from prisma/schema.prisma, ignoring comments, blank lines, trailing whitespace and statement order.
 * Usage: tsx scripts/compare-migrations.ts <generated.sql> <migration.sql>...
 */
import { readFileSync } from "node:fs";

export function statements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !/^\s*--/.test(l))
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "")
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function compareMigrations(generated: string, committed: string[]): { missing: string[]; extra: string[] } {
  const want = statements(generated);
  const have = committed.flatMap(statements);
  const take = (from: string[], minus: string[]) => {
    const rest = [...minus];
    return from.filter((s) => {
      const i = rest.indexOf(s);
      if (i === -1) return true;
      rest.splice(i, 1);
      return false;
    });
  };
  return { missing: take(want, have), extra: take(have, want) };
}

function main(argv: string[]) {
  const [gen, ...files] = argv;
  if (!gen || files.length === 0) {
    console.error("usage: compare-migrations <generated.sql> <migration.sql>...");
    process.exit(2);
  }
  const { missing, extra } = compareMigrations(readFileSync(gen, "utf8"), files.map((f) => readFileSync(f, "utf8")));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`migrations match prisma/schema.prisma (${files.length} migration file(s))`);
    return;
  }
  for (const s of missing) console.error(`missing from prisma/migrations (Prisma generates it):\n${s};\n`);
  for (const s of extra) console.error(`in prisma/migrations but not generated from the schema:\n${s};\n`);
  console.error("prisma/migrations is out of date with prisma/schema.prisma");
  process.exit(1);
}

if (process.argv[1] && /compare-migrations\.ts$/.test(process.argv[1])) main(process.argv.slice(2));
