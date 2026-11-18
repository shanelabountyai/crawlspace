import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { CATEGORIES, type Category } from "@/lib/checks/types";
import { fixtureAgents, fixtureSnapshot } from "@/lib/fixtures";
import { generateFixList } from "@/lib/fixlist";
import { BRAND } from "@/lib/report/brand";
import { formatOutOf100, letterFor } from "@/lib/report/grade";
import { pdfFileName, pdfSafe, renderReportPdf, wrapText, type PdfReportInput } from "@/lib/report/pdf";
import { scanSnapshot } from "@/lib/scan";
import { pdfPageTexts, pdfText } from "../helpers/pdf-text";

const crawl = { pageRequests: 6, assetRequests: 2, blockedBrowserRequests: 3, skipped: [{ url: "https://x.example/admin", reason: "disallowed by robots.txt" }], notes: ["a note"] };

async function input(name: string): Promise<PdfReportInput> {
  const card = scanSnapshot(fixtureSnapshot(name), { agents: fixtureAgents() });
  return { finalUrl: card.url, scorecard: card, fixList: await generateFixList(card), crawl };
}

describe("PDF export (D-37)", () => {
  it.each(["good-shop", "js-only-shop", "walled-shop", "captcha-event", "other-site"])("%s: a valid PDF with the whole report on it", async (name) => {
    const inp = await input(name);
    const bytes = await renderReportPdf(inp);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    const pages = pdfPageTexts(bytes);
    expect(pages.length).toBe(doc.getPageCount());
    const text = pdfText(bytes);
    expect(text).toContain(inp.finalUrl);
    expect(text).toContain(formatOutOf100(inp.scorecard.overall));
    for (const k of Object.keys(CATEGORIES) as Category[]) {
      expect(text).toContain(CATEGORIES[k]);
      expect(text).toContain(letterFor(inp.scorecard.categories[k]));
    }
    for (const c of inp.scorecard.checks) expect(text).toMatch(new RegExp(`\\b${c.id}\\b`));
    for (const f of inp.fixList.items) expect(text.replace(/\n/g, " ")).toContain(pdfSafe(f.title).slice(0, 30));
    if (inp.fixList.items.length === 0) expect(text).toContain("Nothing to fix");
    expect(text).toContain("disallowed by robots.txt");
  });

  it("every page carries the Lab Intelligence wordmark, the address and a page number (D-33)", async () => {
    const bytes = await renderReportPdf(await input("js-only-shop"));
    const pages = pdfPageTexts(bytes);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p, i) => {
      expect(p).toContain(BRAND.wordmark);
      expect(p).toContain(BRAND.address);
      expect(p).toContain(`Page ${i + 1} of ${pages.length}`);
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getAuthor()).toBe("Lab Intelligence");
  });

  it("dates come from the scan, not the clock, and the same report renders the same text", async () => {
    const inp = await input("good-event");
    const a = await renderReportPdf(inp);
    const b = await renderReportPdf(inp);
    expect(pdfText(a)).toBe(pdfText(b));
    const doc = await PDFDocument.load(a, { updateMetadata: false });
    expect(doc.getCreationDate()?.toISOString()).toBe(new Date(inp.scorecard.fetchedAt).toISOString());
  });

  it("a very long report paginates instead of running off the page", async () => {
    const inp = await input("js-only-shop");
    const many = Array.from({ length: 60 }, (_, i) => ({ ...inp.fixList.items[0]!, checkId: `B1`, title: `Long item ${i}`, why: "word ".repeat(120), how: "x".repeat(400) }));
    const bytes = await renderReportPdf({ ...inp, fixList: { ...inp.fixList, items: many } });
    const text = pdfText(bytes);
    expect(text).toContain("Long item 59");
    expect(pdfPageTexts(bytes).length).toBeGreaterThan(5);
  });

  it("text outside Latin-1 is replaced, not thrown", async () => {
    expect(pdfSafe("“Fix” → now ≤ 2 … 日本 ✓")).toBe('"Fix" -> now <= 2 ... ?? ?');
    const inp = await input("js-only-shop");
    const item = { ...inp.fixList.items[0]!, title: "Ajoutez « prix » — 日本語 ✓" };
    const bytes = await renderReportPdf({ ...inp, fixList: { ...inp.fixList, items: [item] } });
    expect(pdfText(bytes)).toContain("Ajoutez « prix » - ??? ?");
  });

  it("wraps long words (URLs) by character within the width", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const url = "https://example.test/" + "a".repeat(300);
    const lines = wrapText(`see ${url} now`, font, 10, 200);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(200);
    expect(lines.join("").replace(/\s/g, "")).toBe(`see${url}now`);
  });

  it("names the file after the host and the scan day", () => {
    expect(pdfFileName("https://shop.example/products/1", "2026-11-18T10:00:00.000Z")).toBe("crawlspace-shop.example-2026-11-18.pdf");
    expect(pdfFileName("not a url", "?")).toBe("crawlspace-report-undated.pdf");
  });
});
