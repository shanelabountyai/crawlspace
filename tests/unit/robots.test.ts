import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "@/lib/robots";

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
