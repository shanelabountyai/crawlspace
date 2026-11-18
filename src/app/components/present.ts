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

export { formatWhen, SITE_TYPE_SOURCE, SITE_TYPE_WORD } from "@/lib/report/words";

export const LABEL_TEXT: Record<string, string> = { heuristic: "Heuristic", "proposed convention": "Proposed convention · low weight" };

/** Host for display; the full URL stays on the page elsewhere. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** A plain-words hint for the guard's technical refusals (D-62); the technical reason is still shown. */
function hintFor(reason: string): string {
  if (/private|loopback|link-local|reserved/i.test(reason)) return "We only scan public websites, so we didn't connect to it.";
  if (/scheme .* not allowed/i.test(reason)) return "Use an address that starts with http:// or https://.";
  if (/not a valid URL|could not resolve|has no addresses/i.test(reason)) return "Check the address; try one like yourstore.com.";
  if (/credentials/i.test(reason)) return "Leave out the user name and password.";
  return "";
}

/**
 * Server messages are terse ("refused: 10.0.0.1 is a private …"). Show them as a plain lead plus the reason,
 * keeping the reason's words exactly so nothing is invented.
 */
export function plainError(message: string): { lead: string; detail: string } {
  const m = message.trim();
  const end = /[.!?]$/.test(m) ? "" : ".";
  // After a lead the reason is kept exactly as written (it often starts with a host or "robots.txt").
  if (/^refused:\s*/i.test(m)) {
    const reason = m.replace(/^refused:\s*/i, "") + end;
    const hint = hintFor(reason);
    return { lead: "Not scanned.", detail: hint ? `${hint} (${reason.replace(/\.$/, "")})` : reason };
  }
  if (/^scan failed:\s*/i.test(m)) return { lead: "The scan failed.", detail: m.replace(/^scan failed:\s*/i, "") + end };
  return { lead: "", detail: cap(m) + end };
}
