import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "@/app/api/health/route";

// Health route for the host's health check (D-69): up or not, nothing else.
describe("GET /api/health", () => {
  it("answers 200 with a small JSON body that is not cached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("imports nothing, so it cannot open the database or start a scan", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/health/route.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\b(require|import)\s*\(/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });
});
