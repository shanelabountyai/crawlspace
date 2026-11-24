import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots, robotsAccess } from "@/lib/robots";

const body = `# comment
User-agent: ExampleAIBot
User-agent: OtherBot
Disallow: /

User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$
Disallow:
`;

describe("robots.txt parser", () => {
  const groups = parseRobots(body);
  it("groups consecutive user-agent lines", () => {
    expect(groups).toHaveLength(2);
    expect(groups[0]!.agents).toEqual(["exampleaibot", "otherbot"]);
  });
  it("blocks a fully disallowed agent and reports the rule line", () => {
    const v = isAllowed(groups, "ExampleAIBot", "/products/x");
    expect(v.allowed).toBe(false);
    expect(v.rule?.line).toBe(4);
  });
  it("matches agents case-insensitively and falls back to *", () => {
    expect(isAllowed(groups, "otherbot", "/").allowed).toBe(false);
    expect(isAllowed(groups, "SomeBot", "/").allowed).toBe(true);
    expect(isAllowed(groups, "SomeBot", "/private/x").allowed).toBe(false);
  });
  it("longest match wins; Allow wins ties", () => {
    expect(isAllowed(groups, "SomeBot", "/private/public-page").allowed).toBe(true);
  });
  it("supports * and $ patterns", () => {
    expect(isAllowed(groups, "SomeBot", "/docs/a.pdf").allowed).toBe(false);
    expect(isAllowed(groups, "SomeBot", "/docs/a.pdf?x=1").allowed).toBe(true);
  });
  it("empty robots allows everything", () => {
    expect(isAllowed(parseRobots(""), "ExampleAIBot", "/").allowed).toBe(true);
  });
});

// D-24 and PRD-02 requirement 2 (Decision 10a; RFC 9309 section 2.3.1): what a robots.txt fetch means for a crawler.
describe("robotsAccess", () => {
  it("a network error (DNS, connect, timeout, TLS) means disallow-all", () => {
    for (const error of ["getaddrinfo ENOTFOUND shop.example", "connect ECONNREFUSED 93.184.216.34:443", "Headers Timeout Error", "certificate has expired", "other side closed"]) {
      const a = robotsAccess({ error });
      expect(a.ok, error).toBe(false);
      if (!a.ok) expect(a.why).toBe(`could not be read (${error})`);
    }
  });
  it.each([500, 502, 503, 504, 599])("a %i answer means disallow-all", (status) => {
    const a = robotsAccess({ status, body: "User-agent: *\nAllow: /\n" });
    expect(a).toEqual({ ok: false, why: `returned ${status}` });
  });
  it.each([400, 401, 403, 404, 410, 429])("a %i answer means no rules: everything is allowed", (status) => {
    const a = robotsAccess({ status, body: "User-agent: *\nDisallow: /\n" });
    expect(a).toEqual({ ok: true, groups: [] });
  });
  it("a 200 answer is parsed and its rules apply", () => {
    const a = robotsAccess({ status: 200, body: "User-agent: *\nDisallow: /private/\n" });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(isAllowed(a.groups, "CrawlspaceBot", "/private/x").allowed).toBe(false);
      expect(isAllowed(a.groups, "CrawlspaceBot", "/").allowed).toBe(true);
    }
  });
});
