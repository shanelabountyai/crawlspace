import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The web app and the CLI share one scan path: scanUrl (SSRF guard + crawl + engine). Nothing else may call
// crawlSite or scanSnapshot directly, and nothing may build its own network client.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const root = process.cwd();
const callers = [...files(join(root, "src/app")), ...files(join(root, "src/server")), join(root, "scripts/scan.ts")];

describe("single scan path", () => {
  it.each(callers)("%s does not bypass scanUrl", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/\bcrawlSite\s*\(/);
    expect(src).not.toMatch(/\bscanSnapshot\s*\(/);
    expect(src).not.toMatch(/from\s+["'](node:)?(http|https|net|dns|dns\/promises)["']|from\s+["']undici["']/);
  });

  it("the CLI and the web service both call scanUrl", () => {
    expect(readFileSync(join(root, "scripts/scan.ts"), "utf8")).toMatch(/\bscanUrl\(/);
    expect(readFileSync(join(root, "src/server/scan-service.ts"), "utf8")).toMatch(/\bscanUrl\(/);
    expect(readFileSync(join(root, "src/server/scan-service.ts"), "utf8")).toMatch(/\bassertAllowed\(/);
  });

  it("only the live model adapter talks to anything over fetch", () => {
    const fetchers = callers.filter((f) => /\bfetch\s*\(/.test(readFileSync(f, "utf8")));
    expect(fetchers.map((f) => f.slice(root.length + 1))).toEqual(["src/server/anthropic-model.ts"]);
  });
});
