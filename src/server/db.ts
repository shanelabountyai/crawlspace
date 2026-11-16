import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = InstanceType<typeof PrismaClient>;

export const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/** SQLite file for the app (D-03). `:memory:` is not supported: the migrator and Prisma open separate connections. */
export function databaseFile(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.DATABASE_FILE ?? join(process.cwd(), "data", "crawlspace.db"));
}

/**
 * Apply prisma/migrations/<name>/migration.sql in name order, once each, recorded in `_crawlspace_migrations` (D-26).
 * Returns the names applied by this call.
 */
export function migrate(file: string, dir: string = MIGRATIONS_DIR): string[] {
  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.exec('CREATE TABLE IF NOT EXISTS "_crawlspace_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" TEXT NOT NULL)');
    const done = new Set((sqlite.prepare('SELECT "name" FROM "_crawlspace_migrations"').all() as { name: string }[]).map((r) => r.name));
    const names = readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
      .map((d) => d.name)
      .sort();
    const applied: string[] = [];
    for (const name of names) {
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
      sqlite.transaction(() => {
        sqlite.exec(sql);
        sqlite.prepare('INSERT INTO "_crawlspace_migrations" ("name", "appliedAt") VALUES (?, ?)').run(name, new Date().toISOString());
      })();
      applied.push(name);
    }
    return applied;
  } finally {
    sqlite.close();
  }
}

export function openDb(file: string = databaseFile()): Db {
  migrate(file);
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
}

const KEY = Symbol.for("crawlspace.db");
type Holder = { [KEY]?: { file: string; db: Db } };

/** Process-wide client (survives Next dev hot reloads). */
export function getDb(): Db {
  const g = globalThis as Holder;
  const file = databaseFile();
  if (!g[KEY] || g[KEY].file !== file) g[KEY] = { file, db: openDb(file) };
  return g[KEY].db;
}
