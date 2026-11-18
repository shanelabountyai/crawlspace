/**
 * Presentation helpers for the design pass (docs/design/*.dc.html, D-48..). Words, glyphs and colour classes only:
 * no score arithmetic. Letter bands come from src/lib/report/grade.ts (D-34) and are never redefined here.
 */
import type { Status as CheckStatus } from "@/lib/rules";
import { gradeTone, letterFor, type Tone } from "@/lib/report/grade";

/** Status = word, then glyph, then colour (Tokens.dc.html). */
export const STATUS = {
  pass: { word: "Pass", glyph: "✓", tone: "pass" },
  partial: { word: "Partial", glyph: "◐", tone: "partial" },
  fail: { word: "Fail", glyph: "✕", tone: "fail" },
  "not-applicable": { word: "Not applicable", glyph: "–", tone: "na" },
} as const satisfies Record<CheckStatus, { word: string; glyph: string; tone: string }>;

/** Readiness word for a score, following the D-34 letter tone: A/B ready, C/D partly ready, F not ready. */
export const READINESS: Record<Tone, { word: string; glyph: string; tone: string }> = {
  good: { word: "Ready", glyph: "✓", tone: "pass" },
  mid: { word: "Partly ready", glyph: "◐", tone: "partial" },
  bad: { word: "Not ready", glyph: "✕", tone: "fail" },
  na: { word: "Nothing to score", glyph: "–", tone: "na" },
};

export function readinessFor(score: number | null) {
  return READINESS[gradeTone(letterFor(score))];
}

/** CSS colour class for a letter's tone. */
export function toneClass(score: number | null): string {
  return gradeTone(letterFor(score));
}

export const SITE_TYPE_WORD: Record<string, string> = { ecommerce: "Ecommerce", event: "Events and ticketing", other: "Other" };

export const SITE_TYPE_SOURCE: Record<string, string> = {
  override: "set for this scan",
  "jsonld-raw": "detected from structured data",
  "jsonld-rendered": "detected from structured data",
  "page-kinds": "detected from the pages found",
  default: "nothing more specific detected",
};

export const LABEL_TEXT: Record<string, string> = { heuristic: "Heuristic", "proposed convention": "Proposed convention · low weight" };

/** `Nov 18, 2026, 4:05 PM UTC`: fixed locale and zone, so server and client render the same text. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d)} UTC`;
}

/** Host for display; the full URL stays on the page elsewhere. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Server messages are terse ("refused: 10.0.0.1 is a private …"). Show them as a plain lead plus the reason,
 * keeping the reason's words exactly so nothing is invented.
 */
export function plainError(message: string): { lead: string; detail: string } {
  const m = message.trim();
  const end = /[.!?]$/.test(m) ? "" : ".";
  // After a lead the reason is kept exactly as written (it often starts with a host or "robots.txt").
  if (/^refused:\s*/i.test(m)) return { lead: "Not scanned.", detail: m.replace(/^refused:\s*/i, "") + end };
  if (/^scan failed:\s*/i.test(m)) return { lead: "The scan failed.", detail: m.replace(/^scan failed:\s*/i, "") + end };
  return { lead: "", detail: cap(m) + end };
}
