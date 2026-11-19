import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { CATEGORIES, type Category } from "../checks/types";
import type { FixList } from "../fixlist/types";
import type { Scorecard } from "../scan";
import { BRAND } from "./brand";
import { formatOutOf100, formatScore, gradeTone, letterFor, type Tone } from "./grade";
import { FIX_SOURCE_TEXT, formatWhen, SITE_TYPE_SOURCE, SITE_TYPE_WORD } from "./words";

/**
 * PDF export of a stored report (D-37): pdf-lib with the standard Helvetica fonts, drawn from the same data the
 * report page shows. Pure: no network, no clock (dates come from the scan), so the same report gives the same bytes.
 */
export interface PdfReportInput {
  finalUrl: string;
  scorecard: Scorecard;
  fixList: FixList;
  crawl: { pageRequests: number; assetRequests: number; blockedBrowserRequests: number; skipped: { url: string; reason: string }[]; notes: string[] };
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const BAND_H = 44; // dark header band (PdfReport.dc.html)
const TOP = PAGE_H - BAND_H - 22; // below the running header
const BOTTOM = MARGIN + 34; // above the footer

/** Design tokens (docs/design/Tokens.dc.html, light): ink, muted, line, accent and the status colours. */
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = hex("#16181D");
const INK_2 = hex("#3E434D");
const MUTED = hex("#565B66");
const LINE = hex("#D9D9D2");
const ACCENT = hex("#0F5E63");
const BAND = hex("#16181D");
const BAND_ACCENT = hex("#7FD1CF");
const BAND_MUTED = hex("#C9CBD1");
const WHITE = hex("#FFFFFF");
const TONES: Record<Tone, ReturnType<typeof rgb>> = {
  good: hex("#1D4F91"),
  mid: hex("#6B4100"),
  bad: hex("#9A2E0B"),
  na: hex("#565B66"),
};
const READINESS: Record<Tone, string> = { good: "Ready", mid: "Partly ready", bad: "Not ready", na: "Nothing to score" };
const STATUS_TEXT = { pass: "Pass", partial: "Partial", fail: "Fail", "not-applicable": "N/A" } as const;
const STATUS_TONE = { pass: "good", partial: "mid", fail: "bad", "not-applicable": "na" } as const;

const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—−]/g, "-"],
  [/…/g, "..."],
  [/→/g, "->"],
  [/←/g, "<-"],
  [/≤/g, "<="],
  [/≥/g, ">="],
  [/•/g, "-"],
  [/[   ]/g, " "],
  [/[\t\r\n]+/g, " "],
];

/** Standard PDF fonts only encode Latin-1-ish text; anything else becomes `?` instead of throwing (D-37). */
export function pdfSafe(text: string): string {
  let t = text;
  for (const [re, to] of REPLACEMENTS) t = t.replace(re, to);
  return t.replace(/[^\x20-\x7E\xA1-\xFF]/g, "?");
}

/** Split text into lines that fit `width` at `size`. Long unbroken tokens (URLs) are cut by character. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(" ").filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = "";
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (let word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    while (!fits(word)) {
      let n = word.length - 1;
      while (n > 1 && !fits(word.slice(0, n))) n--;
      lines.push(word.slice(0, n));
      word = word.slice(n);
    }
    line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

class Writer {
  page!: PDFPage;
  y = TOP;
  readonly pages: PDFPage[] = [];
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = TOP;
  }

  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    const lh = size * 1.35;
    for (const line of wrapText(text, font, size, CONTENT_W - indent)) {
      this.ensure(lh);
      this.y -= lh;
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 2;
  }

  heading(text: string) {
    this.ensure(40);
    this.y -= 14;
    this.text(text, { size: 15, bold: true, color: ACCENT, gap: 6 });
  }

  rule() {
    this.ensure(10);
    this.y -= 4;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.5, color: LINE });
    this.y -= 6;
  }
}

function drawFrame(w: Writer, input: PdfReportInput) {
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    page.drawRectangle({ x: 0, y: PAGE_H - BAND_H, width: PAGE_W, height: BAND_H, color: BAND });
    const baseline = PAGE_H - BAND_H / 2 - 4;
    // "Lab Intelligence / Crawlspace", as on the web header (PdfReport.dc.html)
    page.drawText(pdfSafe(BRAND.company), { x: MARGIN, y: baseline, size: 11, font: w.bold, color: WHITE });
    const trail = ` / ${BRAND.product}`;
    page.drawText(trail, { x: MARGIN + w.bold.widthOfTextAtSize(pdfSafe(BRAND.company), 11), y: baseline, size: 11, font: w.bold, color: BAND_ACCENT });
    const right = pdfSafe(BRAND.tagline);
    page.drawText(right, { x: PAGE_W - MARGIN - w.font.widthOfTextAtSize(right, 9), y: baseline, size: 9, font: w.font, color: BAND_MUTED });

    page.drawLine({ start: { x: MARGIN, y: MARGIN + 22 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 22 }, thickness: 0.5, color: LINE });
    const host = wrapText(input.finalUrl, w.font, 8, CONTENT_W - 80)[0] ?? "";
    page.drawText(pdfSafe(`${BRAND.wordmark} · ${BRAND.address}`), { x: MARGIN, y: MARGIN + 10, size: 8, font: w.font, color: MUTED });
    page.drawText(host, { x: MARGIN, y: MARGIN, size: 8, font: w.font, color: MUTED });
    const num = `Page ${i + 1} of ${total}`;
    page.drawText(num, { x: PAGE_W - MARGIN - w.font.widthOfTextAtSize(num, 8), y: MARGIN, size: 8, font: w.font, color: MUTED });
  });
}

function scannedOn(iso: string): string {
  return formatWhen(iso);
}

export async function renderReportPdf(input: PdfReportInput): Promise<Uint8Array> {
  const { scorecard: card, fixList, crawl } = input;
  const doc = await PDFDocument.create();
  const when = new Date(card.fetchedAt);
  const stamp = Number.isNaN(when.getTime()) ? new Date(0) : when;
  doc.setTitle(pdfSafe(`${BRAND.tagline}: ${input.finalUrl}`));
  doc.setAuthor(BRAND.company);
  doc.setSubject("Crawlspace agent-readiness scorecard and fix list");
  doc.setCreator(pdfSafe(BRAND.wordmark));
  doc.setProducer("Crawlspace (pdf-lib)");
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);

  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));

  // Title block: the scanned URL is the title (PdfReport.dc.html); same words as the report page
  w.text(input.finalUrl, { size: 18, bold: true, gap: 4 });
  const siteType = `${SITE_TYPE_WORD[card.siteType] ?? card.siteType} (${SITE_TYPE_SOURCE[card.siteTypeSource] ?? card.siteTypeSource})`;
  w.text(`Scanned ${scannedOn(card.fetchedAt)} · site type ${siteType} · rubric v${card.rubricVersion}`, { size: 9, color: MUTED, gap: 10 });

  // Overall: score box (PdfReport.dc.html). The readiness word follows the D-34 letter tone.
  w.ensure(90);
  const boxTop = w.y;
  w.y -= 12;
  w.text("AGENT-READINESS SCORE", { size: 8.5, bold: true, color: MUTED, gap: 0, indent: 14 });
  const tone = gradeTone(letterFor(card.overall));
  w.text(formatOutOf100(card.overall), { size: 30, bold: true, color: INK, gap: 2, indent: 14 });
  w.text(READINESS[tone], { size: 11, bold: true, color: TONES[tone], gap: 10, indent: 14 });
  // Category grades in a two-column grid inside the box, right of the score
  const cats = Object.keys(CATEGORIES) as Category[];
  const gx = MARGIN + 190;
  const colW = (CONTENT_W - 190 - 10) / 2;
  cats.forEach((k, i) => {
    const score = card.categories[k];
    const letter = letterFor(score);
    const x = gx + (i % 2) * colW;
    const y = boxTop - 26 - Math.floor(i / 2) * 20;
    w.page.drawText(letter, { x, y, size: 11, font: w.bold, color: TONES[gradeTone(letter)] });
    w.page.drawText(pdfSafe(CATEGORIES[k]), { x: x + 24, y, size: 9, font: w.font, color: INK });
    const s = score === null ? "n/a" : `${formatScore(score)}/100`;
    w.page.drawText(s, { x: x + 24, y: y - 9, size: 7.5, font: w.font, color: MUTED });
  });
  w.y = Math.min(w.y, boxTop - 26 - 2 * 20 - 16);
  w.page.drawRectangle({ x: MARGIN, y: w.y, width: CONTENT_W, height: boxTop - w.y, borderColor: LINE, borderWidth: 0.8 });
  w.y -= 12;

  w.text("Grades: A 90+, B 80+, C 70+, D 60+, F below 60. Checks that do not apply to this site are left out of the score.", { size: 8, color: MUTED });

  // Fix list
  w.heading("Fix these first");
  if (fixList.items.length === 0) {
    w.text("Nothing to fix: every applicable check passed.");
  } else {
    w.text(`${FIX_SOURCE_TEXT[fixList.source]}.`, { size: 9, color: MUTED, gap: 6 });
    fixList.items.forEach((f, i) => {
      w.ensure(50);
      w.text(`${i + 1}. ${f.title}  [${f.checkId}]`, { size: 11, bold: true, gap: 2 });
      w.text(f.why, { indent: 14, color: INK_2 });
      w.text(`Fix: ${f.how}`, { indent: 14 });
      if (f.evidenceUrls.length) w.text(`Evidence: ${f.evidenceUrls.join(", ")}`, { indent: 14, size: 8, color: MUTED });
      w.y -= 6;
    });
  }

  // Every check
  w.heading("Every check");
  for (const c of card.checks) {
    w.ensure(36);
    w.rule();
    const head = `${c.id}  ${c.title}${c.label ? ` (${c.label})` : ""}`;
    const status = STATUS_TEXT[c.status];
    const statusW = w.bold.widthOfTextAtSize(status, 10);
    const lines = wrapText(head, w.bold, 10, CONTENT_W - 110);
    lines.forEach((line, i) => {
      w.ensure(14);
      w.y -= 13.5;
      w.page.drawText(line, { x: MARGIN, y: w.y, size: 10, font: w.bold, color: INK });
      if (i === 0) {
        w.page.drawText(status, { x: PAGE_W - MARGIN - statusW, y: w.y, size: 10, font: w.bold, color: TONES[STATUS_TONE[c.status]] });
        const wt = `weight ${c.weight}`;
        w.page.drawText(wt, { x: PAGE_W - MARGIN - statusW - 12 - w.font.widthOfTextAtSize(wt, 8), y: w.y, size: 8, font: w.font, color: MUTED });
      }
    });
    w.y -= 2;
    for (const e of c.evidence) {
      const where = [e.url, e.selector, e.line ? `line ${e.line}` : ""].filter(Boolean).join(" ");
      w.text(`- ${e.detail}${where ? ` (${where})` : ""}`, { indent: 10, size: 8.5, color: MUTED, gap: 0 });
    }
  }

  // Crawl
  w.heading("How this site was read");
  w.text(
    `${crawl.pageRequests} page requests and ${crawl.assetRequests} script requests, all GET, at most one per second, as CrawlspaceBot; ${crawl.blockedBrowserRequests} other browser requests blocked. Not-applicable checks do not count toward the score.`,
    { size: 9 },
  );
  for (const s of crawl.skipped) w.text(`skipped ${s.url}: ${s.reason}`, { size: 8.5, color: MUTED, indent: 10, gap: 0 });
  for (const n of crawl.notes) w.text(n, { size: 8.5, color: MUTED, indent: 10, gap: 0 });
  w.y -= 8;
  w.text(
    "This is an automated check of up to 15 pages at the time shown. Checks marked heuristic or proposed convention are approximations; read the evidence before acting.",
    { size: 8, color: MUTED },
  );

  drawFrame(w, input);
  return doc.save({ useObjectStreams: false });
}

/** `crawlspace-shop.example-2026-11-18.pdf` */
export function pdfFileName(finalUrl: string, fetchedAt: string): string {
  let host = "report";
  try {
    host = new URL(finalUrl).hostname.replace(/[^a-z0-9.-]/gi, "") || host;
  } catch {
    // keep the default
  }
  const day = /^\d{4}-\d{2}-\d{2}/.exec(fetchedAt)?.[0] ?? "undated";
  return `crawlspace-${host}-${day}.pdf`;
}
