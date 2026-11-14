import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Phase 1 rule: no network calls in engine code. The engine must not import network modules or call fetch.
const FORBIDDEN = [/from\s+["'](node:)?(http|https|net|tls|dns|dgram|http2)["']/, /from\s+["']undici["']/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("no network in the Phase 1 engine", () => {
  it.each(files(join(process.cwd(), "src/lib")).concat(files(join(process.cwd(), "scripts"))))("%s", (file) => {
    const src = readFileSync(file, "utf8");
    for (const re of FORBIDDEN) expect(re.test(src), `${file} matches ${re}`).toBe(false);
  });
});
