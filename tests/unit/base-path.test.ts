import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_PATH, BASE_PATH_MAX_LENGTH, cookiePath, parseBasePath, withBasePath } from "@/lib/base-path";
import { clearCookie, sessionCookie } from "@/server/operator-auth";

// Opt-in base path for serving under another site (D-103): the validator, the helper, and a source sweep so no
// root-relative URL that Next does not prefix by itself bypasses the helper.

describe("parseBasePath (build-time validation of CRAWLSPACE_BASE_PATH)", () => {
  it("unset, empty or whitespace means served at the root", () => {
    expect(parseBasePath(undefined)).toBe("");
    expect(parseBasePath(null)).toBe("");
    expect(parseBasePath("")).toBe("");
    expect(parseBasePath("   ")).toBe("");
  });

  it.each(["/agent-check", "/a", "/Agent_Check2", "/tools/agent-check", "/0"])("accepts %s", (v) => {
    expect(parseBasePath(v)).toBe(v);
  });

  it("trims surrounding whitespace (a value pasted into a dashboard)", () => {
    expect(parseBasePath("  /agent-check\n")).toBe("/agent-check");
  });

  it.each([
    ["agent-check", /must start with "\/"/],
    ["/agent-check/", /must not end with "\/"/],
    ["/", /must not end with "\/"/],
    ["//agent-check", /may contain only/],
    ["/agent//check", /may contain only/],
    ["/agent check", /may contain only/],
    ["/agent%20check", /may contain only/],
    ["/../etc", /may contain only/],
    ["/./x", /may contain only/],
    ["/agent.check", /may contain only/],
    ["/_next", /may contain only/],
    ["/-x", /may contain only/],
    ["/agent?x=1", /may contain only/],
    ["/agent#x", /may contain only/],
    ["/agent\\check", /may contain only/],
    ["/ägent", /may contain only/],
    ["https://assess.labintelligence.co/agent-check", /must start with "\/"/],
    [`/${"a".repeat(BASE_PATH_MAX_LENGTH)}`, /longer than/],
  ])("refuses %j", (v, msg) => {
    expect(() => parseBasePath(v)).toThrow(msg);
  });

  it("the test run itself has no base path, so every other test sees the app at the root", () => {
    expect(process.env.CRAWLSPACE_BASE_PATH ?? "").toBe("");
    expect(BASE_PATH).toBe("");
  });
});

describe("withBasePath", () => {
  it("returns the path unchanged when no base path is set (today's behaviour)", () => {
    for (const p of ["/", "/api/scans", "/scans/abc?pdf=pdf-email#pdf-h", "/?error=scan-refused#url", "/operator?rerun=x"]) {
      expect(withBasePath(p)).toBe(p);
      expect(withBasePath(p, "")).toBe(p);
    }
  });

  it("prefixes the base path", () => {
    const b = "/agent-check";
    expect(withBasePath("/api/scans", b)).toBe("/agent-check/api/scans");
    expect(withBasePath("/scans/abc?pdf=pdf-email#pdf-h", b)).toBe("/agent-check/scans/abc?pdf=pdf-email#pdf-h");
    expect(withBasePath("/operator?error=wrong", b)).toBe("/agent-check/operator?error=wrong");
    expect(withBasePath("/api/health", "/tools/agent-check")).toBe("/tools/agent-check/api/health");
  });

  it("maps the home page to the base path itself, the URL Next serves it at (no trailing slash)", () => {
    expect(withBasePath("/", "/agent-check")).toBe("/agent-check");
    expect(withBasePath("/?error=scan-refused#url", "/agent-check")).toBe("/agent-check?error=scan-refused#url");
    expect(withBasePath("/#main", "/agent-check")).toBe("/agent-check#main");
  });

  it.each(["api/scans", "", "//evil.example/x", "https://evil.example/"])("refuses %j (not an app path)", (p) => {
    expect(() => withBasePath(p, "/agent-check")).toThrow(/single "\/"/);
  });
});

describe("cookie path", () => {
  it("is / at the root (unchanged) and the base path when one is set", () => {
    expect(cookiePath("")).toBe("/");
    expect(cookiePath("/agent-check")).toBe("/agent-check");
  });

  it("the operator cookies still say Path=/ with no base path", () => {
    expect(sessionCookie("t", true)).toMatch(/; Path=\/; HttpOnly; SameSite=Strict;/);
    expect(clearCookie(false)).toMatch(/; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/);
  });
});

describe("source sweep: root-relative URLs that Next does not prefix go through withBasePath", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  }
  const root = process.cwd();
  const sources = [...files(join(root, "src/app")), ...files(join(root, "src/server"))];
  // Each pattern is a root-relative string literal in a place Next leaves alone. <Link href> is not listed: Next
  // prefixes it (and router.push / redirect()) by itself.
  const RAW = [
    { what: "fetch", re: /\bfetch\s*\(\s*["'`]\// },
    { what: "form action", re: /\baction=\{?\s*["'`]\// },
    { what: "plain <a href>", re: /<a\b[^>]*\bhref=\{?\s*["'`]\// },
    { what: "Location header", re: /\blocation:\s*["'`]\// },
    { what: "new URL(path, base)", re: /new URL\(\s*["'`]\/[^"'`]*["'`]\s*,/ },
    { what: "cookie Path=/", re: /Path=\/[;`"']/ },
  ];
  it.each(sources.map((f) => [f.slice(root.length + 1), f]))("%s", (_name, file) => {
    const src = readFileSync(file, "utf8");
    for (const { what, re } of RAW) expect(src, what).not.toMatch(re);
  });
});
