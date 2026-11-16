import { defineConfig } from "prisma/config";

// DATABASE_FILE is the SQLite file the app uses (default ./data/crawlspace.db). Only Prisma CLI commands read this file.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: `file:${process.env.DATABASE_FILE ?? "./data/crawlspace.db"}` },
});
