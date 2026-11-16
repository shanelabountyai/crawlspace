import { describe, expect, it } from "vitest";
import { CHECKS } from "@/lib/checks/registry";
import { fixtureAgents, fixtureSnapshot, listFixtures } from "@/lib/fixtures";
import { buildPrompt, fixInputs, generateFixList, inputUrls, RecordedModel, TEMPLATES, templateFixList } from "@/lib/fixlist";
import { loadWeights } from "@/lib/rules";
import { scanSnapshot } from "@/lib/scan";

const card = (name: string) => scanSnapshot(fixtureSnapshot(name), { agents: fixtureAgents() });

describe("fix-list templates (no API key)", () => {
  it("has exactly one template per rubric check ID", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(CHECKS.map((c) => c.id).sort());
    expect(Object.keys(TEMPLATES).sort()).toEqual(Object.keys(loadWeights().checks).sort());
  });

  it.each(listFixtures())("%s: one template fix per failed/partial check, none for pass or N/A", async (name) => {
    const c = card(name);
    const list = await generateFixList(c); // no model → templates
    const want = c.checks.filter((k) => k.status === "fail" || k.status === "partial").map((k) => k.id);
    expect(list.items.map((i) => i.checkId).sort()).toEqual([...want].sort());
    expect(list.items.every((i) => i.source === "template")).toBe(true);
    expect(list.source).toBe("template");
    const urls = inputUrls(fixInputs(c));
    for (const i of list.items) for (const u of i.evidenceUrls) expect(urls.has(u)).toBe(true);
    if (want.length) expect(list.note).toMatch(/no language model/);
  });

  it("ranks templates by points lost, ties in rubric order", () => {
    const list = templateFixList(card("js-only-shop"));
    // B1 fail w4, E1 fail w3, B2 fail w2, C2 partial w4 (2), D2 fail w1, C1 partial w2 (1), C4 partial w1 (0.5), D1 fail w0.5
    expect(list.items.map((i) => i.checkId)).toEqual(["B1", "E1", "B2", "C2", "C1", "D2", "C4", "D1"]);
  });

  it("is deterministic", async () => {
    expect(await generateFixList(card("walled-shop"))).toEqual(await generateFixList(card("walled-shop")));
  });

  it("labels heuristic and proposed-convention checks in their template text", () => {
    expect(TEMPLATES.D1!.title).toMatch(/proposed convention/);
    expect(TEMPLATES.E1!.why).toMatch(/heuristic/);
    expect(TEMPLATES.E3!.why).toMatch(/heuristic/);
  });

  it("a site with nothing to fix gets an empty list and the model is not called", async () => {
    const model = new RecordedModel("{}");
    const list = await generateFixList(card("good-shop"), { model });
    expect(list.items).toEqual([]);
    expect(model.prompts).toHaveLength(0);
  });
});

describe("fix-list prompt", () => {
  it("contains only failed/partial checks, their evidence URLs, and the hard rules", () => {
    const c = card("broken-jsonld-shop");
    const p = buildPrompt(c.url, fixInputs(c));
    const payload = JSON.parse(p.user.slice(p.user.indexOf("{")));
    expect(payload.allowedCheckIds).toEqual(["A3", "C1", "C2", "D1", "D2", "E2"]);
    expect(payload.allowedUrls).toContain("https://broken-jsonld-shop.example/cart");
    expect(p.user).not.toMatch(/"checkId": "A1"/);
    expect(p.system).toMatch(/Never invent a check/);
    expect(p.system).toMatch(/Only cite URLs that appear in the input evidence/);
    expect(buildPrompt(c.url, fixInputs(c))).toEqual(p);
  });
});
