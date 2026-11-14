import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// The scoring engine stays pure: only src/lib/crawl (Phase 2) and scripts/scan.ts may touch the network.
const FORBIDDEN = [/from\s+["'](node:)?(http|https|net|tls|dns|dns\/promises|dgram|http2)["']/, /from\s+["']undici["']/, /from\s+["']playwright["']/, /import\(["']playwright["']\)/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const root = process.cwd();
const engine = files(join(root, "src/lib")).filter((f) => !f.includes(`${sep}crawl${sep}`)).concat(join(root, "scripts/scan-fixture.ts"));

describe("no network outside the crawler", () => {
  it.each(engine)("%s", (file) => {
    const src = readFileSync(file, "utf8");
    for (const re of FORBIDDEN) expect(re.test(src), `${file} matches ${re}`).toBe(false);
  });
});
