import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonLdBlocks, jsonLdNodes, visibleText } from "@/lib/html";
import { fixtureSnapshot } from "@/lib/fixtures";
import { loadAgents, loadWeights } from "@/lib/rules";
import { CHECKS } from "@/lib/checks/registry";
import { detectSiteType } from "@/lib/sitetype";
import { loadSnapshotFromDir, SnapshotSchema } from "@/lib/snapshot";

describe("html helpers", () => {
  it("extracts visible text without scripts", () => {
    expect(visibleText("<body><p>Hi <b>there</b></p><script>var x=1</script></body>")).toBe("Hi there");
  });
  it("reports JSON-LD parse errors and flattens @graph", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"A"},{"@type":"WebSite"}]}</script>
<script type="application/ld+json">{"@type": "Product",}</script>`;
    const blocks = jsonLdBlocks(html);
    expect(blocks.map((b) => b.ok)).toEqual([true, false]);
    expect(jsonLdNodes(html).map((n) => n["@type"])).toEqual(["Organization", "WebSite"]);
  });
});

describe("rules", () => {
  it("weights.json has a weight for every registered check and nothing else", () => {
    expect(Object.keys(loadWeights().checks).sort()).toEqual(CHECKS.map((c) => c.id).sort());
  });
  it("check IDs are unique and every check lives in a known category", () => {
    const ids = CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CHECKS) expect(c.id.startsWith(c.category)).toBe(true);
  });
  it("llms.txt (D1) stays low weight (D-04)", () => {
    const w = loadWeights().checks;
    expect(w.D1).toBeLessThan(Math.min(...Object.entries(w).filter(([k]) => k !== "D1").map(([, v]) => v)));
  });
  it("agents.json validates; every listed agent carries verifiedOn + source", () => {
    for (const a of loadAgents()) {
      expect(a.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.source).toMatch(/^https:\/\//);
    }
    expect(() => loadAgents({ agents: [{ token: "X", operator: "Y" }] })).toThrow();
  });
});

describe("snapshot", () => {
  it("rejects a snapshot without a home page", () => {
    const s = fixtureSnapshot("good-shop");
    expect(() => SnapshotSchema.parse({ ...s, pages: s.pages.filter((p) => p.kind !== "home") })).toThrow();
  });
  it("refuses manifest paths that escape the fixture directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-snap-"));
    mkdirSync(join(dir, "pages"));
    writeFileSync(
      join(dir, "snapshot.json"),
      JSON.stringify({
        url: "https://x.example/", fetchedAt: "2026-11-01T00:00:00Z", robots: null, sitemap: null, llms: null,
        pages: [{ id: "home", url: "https://x.example/", kind: "home", status: 200, ttfbMs: 1, raw: "../../etc/passwd", rendered: "pages/a.html" }],
      }),
    );
    expect(() => loadSnapshotFromDir(dir)).toThrow(/escapes/);
  });
  it("site type override wins over detection", () => {
    const s = { ...fixtureSnapshot("good-shop"), siteTypeOverride: "other" as const };
    expect(detectSiteType(s)).toEqual({ siteType: "other", source: "override" });
  });
});
