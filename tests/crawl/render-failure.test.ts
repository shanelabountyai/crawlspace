import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Report } from "@/app/components/Report";
import { CHECKS } from "@/lib/checks/registry";
import { crawlSite, type CrawlResult } from "@/lib/crawl";
import type { FetchResult } from "@/lib/crawl/fetcher";
import type { RenderEvent, Renderer } from "@/lib/crawl/render";
import { fixtureAgents, fixtureSnapshot, listFixtures } from "@/lib/fixtures";
import { loadWeights } from "@/lib/rules";
import { scanSnapshot } from "@/lib/scan";
import { score } from "@/lib/score";
import { loadSnapshotFromDir, SnapshotSchema, writeSnapshotToDir } from "@/lib/snapshot";
import { openDb } from "@/server/db";
import { scanPdf } from "@/server/lead-service";
import { ScanService } from "@/server/scan-service";
import { ScanStore, summariseCrawl } from "@/server/store";
import { pdfText } from "../helpers/pdf-text";
import { SiteServer, testGuard } from "../helpers/site-server";

// PRD-02 requirement 6 (review 2026-11-20, CQ-3): a page that was not rendered is never scored as if it had been.
const NOT_RENDERED = "page could not be rendered";
/** The checks that read the rendered view (D-14): all of B (raw-vs-rendered comparison) and all of E. */
const RENDERED_VIEW = ["B1", "B2", "E1", "E2", "E3", "E4"];

class ThrowingRenderer implements Renderer {
  readonly events: RenderEvent[] = [];
  calls = 0;
  constructor(private readonly failOn: (main: FetchResult) => boolean = () => true) {}
  async render(main: FetchResult): Promise<string> {
    this.calls++;
    if (this.failOn(main)) throw new Error("browserType.launch: Executable doesn't exist");
    return main.body;
  }
  async close(): Promise<void> {}
}

const statuses = (r: CrawlResult) => Object.fromEntries(scanSnapshot(r.snapshot, { agents: fixtureAgents() }).checks.map((c) => [c.id, c.status]));

describe("a renderer that fails (PRD-02 requirement 6)", () => {
  let srv: SiteServer;
  let base: string;
  let broken: CrawlResult;
  let working: CrawlResult;

  beforeAll(async () => {
    srv = await new SiteServer().start();
    const appJs = `
const root = document.getElementById("root");
root.innerHTML = '<h1>Glow Lamp</h1><p class="price">$48.00</p><button type="button">Add to cart</button>';`;
    const shell = '<!doctype html><html><head><title>Lamps</title><script src="/static/app.js"></script></head><body><div id="root"></div></body></html>';
    base = srv.site("jsonly.test", {
      "/": { body: shell.replace("</body>", '<a href="/products/glow-lamp">x</a></body>') },
      "/products/glow-lamp": { body: shell },
      "/static/app.js": { type: "text/javascript", body: `document.addEventListener("DOMContentLoaded", () => {${appJs}});` },
    });
    broken = await crawlSite(`${base}/`, { guard: testGuard, renderer: () => new ThrowingRenderer() });
    working = await crawlSite(`${base}/`, { guard: testGuard });
  }, 120_000);

  afterAll(async () => {
    await srv.stop();
  });

  it("the snapshot says it was not rendered, and the crawl report says rendering failed", () => {
    expect(broken.snapshot.rendered).toBe(false);
    expect(broken.report.rendered).toBe(false);
    expect(broken.snapshot.pages).toHaveLength(2);
    for (const p of broken.snapshot.pages) expect(p.renderedHtml).toBe(p.rawHtml);
    expect(broken.report.notes.filter((n) => /^render of .* failed, using raw HTML: /.test(n))).toHaveLength(2);
    expect(broken.report.notes).toContain("rendering failed for 2 of 2 pages; the checks that need the rendered page (categories B and E) are marked not applicable");
  });

  it("the checks that read the rendered view are N/A with the evidence 'page could not be rendered'; no other check is", () => {
    const card = scanSnapshot(broken.snapshot, { agents: fixtureAgents() });
    expect(card.siteType).toBe("ecommerce");
    for (const c of card.checks) {
      if (RENDERED_VIEW.includes(c.id)) {
        expect(c.status, c.id).toBe("not-applicable");
        expect(c.evidence, c.id).toEqual([{ detail: NOT_RENDERED }]);
      } else {
        expect(c.evidence.some((e) => e.detail === NOT_RENDERED), c.id).toBe(false);
      }
    }
    expect(card.categories.B).toBeNull();
    expect(card.categories.E).toBeNull();
  });

  it("the overall score is the score of the other checks alone (CS-05)", () => {
    const weights = loadWeights();
    const card = scanSnapshot(broken.snapshot, { agents: fixtureAgents() });
    const rest = card.checks.filter((c) => !RENDERED_VIEW.includes(c.id));
    expect(card.overall).not.toBeNull();
    expect(card.overall).toBe(score(rest, weights).overall);
    const heavy = card.checks.map((c) => (RENDERED_VIEW.includes(c.id) ? { ...c, weight: 1000 } : c));
    expect(score(heavy, weights)).toEqual(score(card.checks, weights));
    // the other checks come out exactly as they do for the same pages when the flag says rendered
    const asIfRendered = scanSnapshot({ ...broken.snapshot, rendered: true }, { agents: fixtureAgents() });
    for (const c of rest) expect(c, c.id).toEqual(asIfRendered.checks.find((x) => x.id === c.id));
  });

  it("with a working renderer the same site is rendered and B and E are judged", () => {
    expect(working.snapshot.rendered).toBe(true);
    expect(working.report.rendered).toBe(true);
    expect(working.report.notes.some((n) => /rendering/.test(n))).toBe(false);
    const st = statuses(working);
    expect(st.B1).toBe("fail"); // the product name and price exist only after JavaScript runs
    expect(st.B2).not.toBe("not-applicable");
    expect(st.E1).toBe("pass"); // the Add to cart button exists in the rendered view
    // what the unrendered pages would have claimed without the flag: B2 "pass" (raw compared with itself), E1 "fail"
    const unflagged = scanSnapshot({ ...broken.snapshot, rendered: true }, { agents: fixtureAgents() });
    const un = Object.fromEntries(unflagged.checks.map((c) => [c.id, c.status]));
    expect([un.B2, un.E1]).toEqual(["pass", "fail"]);
  });

  it("one page that fails to render is enough: the whole snapshot is marked not rendered", async () => {
    const renderer = new ThrowingRenderer((main) => main.url.includes("/products/"));
    const r = await crawlSite(`${base}/`, { guard: testGuard, renderer: () => renderer });
    expect(renderer.calls).toBe(2);
    expect(r.snapshot.rendered).toBe(false);
    expect(r.report.notes).toContain("rendering failed for 1 of 2 pages; the checks that need the rendered page (categories B and E) are marked not applicable");
    for (const id of RENDERED_VIEW) expect(statuses(r)[id], id).toBe("not-applicable");
  }, 60_000);

  it("rendering switched off (render: false) is not rendered either, and says so", async () => {
    const r = await crawlSite(`${base}/`, { guard: testGuard, render: false });
    expect(r.snapshot.rendered).toBe(false);
    expect(r.report.notes).toContain("rendering was switched off; the checks that need the rendered page (categories B and E) are marked not applicable");
    for (const id of RENDERED_VIEW) expect(statuses(r)[id], id).toBe("not-applicable");
  }, 60_000);

  it("through the web scan service: the scan finishes, and the stored crawl summary says rendering failed", async () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), "cs-render-")), "s.db"));
    try {
      const svc = new ScanService(new ScanStore(db), { crawl: { guard: testGuard, renderer: () => new ThrowingRenderer() }, model: null });
      const r = await svc.submit(`${base}/`);
      if (!r.ok) throw new Error(r.error);
      await svc.idle();
      const v = (await svc.store.get(r.id))!;
      expect(v.status, v.error ?? "").toBe("done");
      expect(v.report!.crawl.rendered).toBe(false);
      expect(v.report!.crawl.notes.some((n) => n.startsWith("rendering failed for 2 of 2 pages"))).toBe(true);
      const byId = Object.fromEntries(v.report!.scorecard.checks.map((c) => [c.id, c]));
      for (const id of RENDERED_VIEW) expect(byId[id]!.evidence, id).toEqual([{ detail: NOT_RENDERED }]);
      // nothing to fix is invented for a check that was not judged
      expect(v.report!.fixList.items.filter((i) => RENDERED_VIEW.includes(i.checkId))).toEqual([]);
      // the report page says so: the crawl summary ("How this site was read") and the evidence on each rendered-view check
      const html = renderToStaticMarkup(createElement(Report, { report: v.report!, scannedAt: v.finishedAt }));
      expect(html).toContain("<li>rendering failed for 2 of 2 pages; the checks that need the rendered page (categories B and E) are marked not applicable</li>");
      expect(html.split(NOT_RENDERED).length - 1).toBe(RENDERED_VIEW.length);
      // the PDF of that report says so too: the crawl summary line and the evidence on each rendered-view check
      const pdf = pdfText((await scanPdf(svc.store, r.id))!.bytes).replace(/\s+/g, " ");
      expect(pdf).toContain("rendering failed for 2 of 2 pages");
      expect(pdf.split(NOT_RENDERED).length - 1).toBe(RENDERED_VIEW.length);
    } finally {
      await db.$disconnect();
    }
  }, 60_000);

  it("summariseCrawl carries the flag", () => {
    expect(summariseCrawl(broken.report).rendered).toBe(false);
    expect(summariseCrawl(working.report).rendered).toBe(true);
  });
});

describe("the snapshot's rendered flag in the engine", () => {
  const agents = fixtureAgents();

  it("a snapshot without the flag counts as rendered: every committed fixture loads as rendered and none carries the not-rendered evidence", () => {
    for (const name of listFixtures()) {
      const snap = fixtureSnapshot(name);
      expect(snap.rendered, name).toBe(true);
      expect("rendered" in JSON.parse(readFileSync(join(process.cwd(), "fixtures/sites", name, "snapshot.json"), "utf8")), name).toBe(false);
      for (const c of scanSnapshot(snap, { agents }).checks) expect(c.evidence.some((e) => e.detail === NOT_RENDERED), `${name} ${c.id}`).toBe(false);
    }
  });

  it("exactly the B and E checks are declared as reading the rendered view", () => {
    expect(CHECKS.filter((c) => c.needsRendered).map((c) => c.id)).toEqual(RENDERED_VIEW);
  });

  for (const name of ["good-shop", "js-only-shop", "good-event"]) {
    it(`${name} marked not rendered: B and E are N/A, every other check is unchanged, the score is the others' score`, () => {
      const weights = loadWeights();
      const rendered = scanSnapshot(fixtureSnapshot(name), { agents });
      const not = scanSnapshot(SnapshotSchema.parse({ ...fixtureSnapshot(name), rendered: false }), { agents });
      for (const c of not.checks) {
        if (RENDERED_VIEW.includes(c.id)) expect(c, c.id).toMatchObject({ status: "not-applicable", evidence: [{ detail: NOT_RENDERED }] });
        else expect(c, c.id).toEqual(rendered.checks.find((x) => x.id === c.id));
      }
      expect(not.overall).toBe(score(rendered.checks.filter((c) => !RENDERED_VIEW.includes(c.id)), weights).overall);
    });
  }

  it("a check that does not apply to the site type keeps that reason", () => {
    const card = scanSnapshot(SnapshotSchema.parse({ ...fixtureSnapshot("other-site"), rendered: false }), { agents });
    expect(card.checks.find((c) => c.id === "E1")?.evidence).toEqual([{ detail: "does not apply to site type 'other'" }]);
    expect(card.checks.find((c) => c.id === "B1")?.evidence).toEqual([{ detail: NOT_RENDERED }]);
  });

  it("the flag survives the on-disk format, and a rendered snapshot's manifest is written as before (no new key)", () => {
    const dirA = mkdtempSync(join(tmpdir(), "cs-flag-"));
    const dirB = mkdtempSync(join(tmpdir(), "cs-flag-"));
    const not = SnapshotSchema.parse({ ...fixtureSnapshot("good-shop"), rendered: false });
    writeSnapshotToDir(not, dirA);
    expect(loadSnapshotFromDir(dirA)).toEqual(not);
    expect(JSON.parse(readFileSync(join(dirA, "snapshot.json"), "utf8")).rendered).toBe(false);
    writeSnapshotToDir(fixtureSnapshot("good-shop"), dirB);
    expect("rendered" in JSON.parse(readFileSync(join(dirB, "snapshot.json"), "utf8"))).toBe(false);
    expect(loadSnapshotFromDir(dirB).rendered).toBe(true);
  });
});
