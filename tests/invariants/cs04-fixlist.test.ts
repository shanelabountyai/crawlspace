import { describe, expect, it } from "vitest";
import { fixtureAgents, fixtureSnapshot, listFixtures } from "@/lib/fixtures";
import { fixInputs, generateFixList, inputUrls, normaliseUrl, RecordedModel, validateFixes, type FixList } from "@/lib/fixlist";
import { scanSnapshot } from "@/lib/scan";

// CS-04: a fix-list item that cites a check ID or URL not in the input is dropped (and counted).

const card = (name: string) => scanSnapshot(fixtureSnapshot(name), { agents: fixtureAgents() });
const ORIGIN = "https://broken-jsonld-shop.example";

function assertInsideInput(list: FixList, name: string) {
  const inputs = fixInputs(card(name));
  const ids = new Set(inputs.map((i) => i.checkId));
  const urls = inputUrls(inputs);
  for (const item of list.items) {
    expect(ids.has(item.checkId), `${item.checkId} is an input check`).toBe(true);
    for (const u of item.evidenceUrls) expect(urls.has(normaliseUrl(u)!), `${u} is an input URL`).toBe(true);
    if (item.source === "llm") {
      for (const u of `${item.title} ${item.why} ${item.how}`.match(/https?:\/\/[^\s"'<>`]+/g) ?? []) expect(urls.has(normaliseUrl(u.replace(/[.,;:!?)\]}]+$/, ""))!)).toBe(true);
      for (const id of `${item.title} ${item.why} ${item.how}`.match(/\b[A-F][0-9]{1,2}\b/g) ?? []) expect(ids.has(id)).toBe(true);
    }
  }
}

describe("CS-04 fix-list validator", () => {
  it("drops and counts every invented check, URL and prose reference in a recorded model reply", async () => {
    const model = RecordedModel.fromFixture("broken-jsonld-shop.invented.json", { origin: ORIGIN });
    const list = await generateFixList(card("broken-jsonld-shop"), { model });
    expect(list.dropped.total).toBe(7);
    expect(list.dropped.byReason).toEqual({ malformed: 1, "unknown-check": 2, "unknown-url": 2, "unknown-check-in-text": 1, duplicate: 1 });
    expect(list.dropped.items.map((d) => d.detail).join("\n")).toMatch(/C9[\s\S]*B1[\s\S]*imaginary-checkout[\s\S]*ogp\.me[\s\S]*F7/);
    // kept model items in model order, then templates for what the model did not validly cover
    expect(list.items.map((i) => [i.checkId, i.source])).toEqual([
      ["C2", "llm"], ["C1", "llm"], ["E2", "llm"], ["D2", "llm"], ["A3", "template"], ["D1", "template"],
    ]);
    expect(list.source).toBe("mixed");
    assertInsideInput(list, "broken-jsonld-shop");
  });

  it("keeps a faithful reply whole (also inside a ```json fence)", async () => {
    for (const file of ["broken-jsonld-shop.faithful.json", "broken-jsonld-shop.fenced.md"]) {
      const list = await generateFixList(card("broken-jsonld-shop"), { model: RecordedModel.fromFixture(file, { origin: ORIGIN }) });
      expect(list.source, file).toBe("llm");
      expect(list.dropped.total).toBe(0);
      expect(list.items.map((i) => i.checkId)).toEqual(["C2", "C1", "E2", "D2", "A3", "D1"]);
      assertInsideInput(list, "broken-jsonld-shop");
    }
  });

  it("the same reply aimed at another origin is dropped entirely (URLs are compared exactly)", async () => {
    const model = RecordedModel.fromFixture("broken-jsonld-shop.faithful.json", { origin: "https://elsewhere.example" });
    const list = await generateFixList(card("broken-jsonld-shop"), { model });
    expect(list.dropped.byReason["unknown-url"]).toBe(6);
    expect(list.source).toBe("template");
    assertInsideInput(list, "broken-jsonld-shop");
  });

  describe.each(listFixtures())("adversarial items on fixture %s", (name) => {
    it("keeps exactly the items that stay inside the input and counts the rest", () => {
      const inputs = fixInputs(card(name));
      const ids = inputs.map((i) => i.checkId);
      const urls = [...inputUrls(inputs)];
      const outsideIds = ["A1", "A2", "A3", "A4", "B1", "B2", "C1", "C2", "C3", "C4", "D1", "D2", "E1", "E2", "E3", "E4", "F1", "F2", "C9", "Z1", "a1", ""].filter((id) => !ids.includes(id));
      const raw: unknown[] = [];
      const expectKept: string[] = [];
      let expectDropped = 0;
      // one good item per input check
      for (const id of ids) {
        raw.push({ checkId: id, title: `Fix ${id}`, why: "Because the evidence says so.", how: "Change it.", evidenceUrls: urls.slice(0, 1) });
        expectKept.push(id);
      }
      // invented check IDs
      for (const id of outsideIds) {
        raw.push({ checkId: id, title: "Invented", why: "x", how: "y", evidenceUrls: [] });
        expectDropped++;
      }
      // a real check citing an invented URL, in the field and in prose
      if (ids.length) {
        raw.push({ checkId: ids[0], title: "t", why: "w", how: "h", evidenceUrls: [`https://${name}.example/not-scanned`] });
        raw.push({ checkId: ids[0], title: "t", why: "see https://evil.example/page.", how: "h", evidenceUrls: [] });
        raw.push({ checkId: ids[0], title: "t", why: "w", how: "also fix Z9 and F9", evidenceUrls: [] });
        expectDropped += 3;
      }
      const v = validateFixes(raw, inputs);
      expect(v.kept.map((k) => k.checkId)).toEqual(expectKept);
      expect(v.dropped.length).toBe(expectDropped);
      expect(Object.values(v.byReason).reduce((a, b) => a + b, 0)).toBe(expectDropped);
      for (const k of v.kept) for (const u of k.evidenceUrls) expect(urls).toContain(u);
    });
  });

  it("unparseable or failing model output falls back to templates, never to unvalidated text", async () => {
    const c = card("broken-jsonld-shop");
    const notJson = await generateFixList(c, { model: RecordedModel.fromFixture("not-json.txt") });
    expect(notJson.source).toBe("template");
    expect(notJson.note).toMatch(/not JSON/);
    const failing = await generateFixList(c, { model: new RecordedModel(new Error("timeout")) });
    expect(failing.source).toBe("template");
    expect(failing.note).toMatch(/timeout/);
    const noArray = await generateFixList(c, { model: new RecordedModel('{"items":[]}') });
    expect(noArray.note).toMatch(/fixes/);
    for (const l of [notJson, failing, noArray]) expect(l.items.every((i) => i.source === "template")).toBe(true);
  });
});
