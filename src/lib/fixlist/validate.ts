import { z } from "zod";
import { inputUrls, normaliseUrl } from "./input";
import { DROP_REASONS, ModelFixSchema, type DroppedItem, type DropReason, type FixInput, type FixItem } from "./types";

/** Anything shaped like a rubric check ID (rules/weights.json uses A1..F2; [A-F] + 1–2 digits). */
const CHECK_ID_IN_TEXT = /\b[A-F][0-9]{1,2}\b/g;
/** URLs in prose. Trailing punctuation is trimmed before comparing. */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>`]+/gi;

export class UnparseableOutput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnparseableOutput";
  }
}

export interface ValidationResult {
  kept: FixItem[];
  dropped: DroppedItem[];
  byReason: Record<DropReason, number>;
}

/** Pull the JSON object out of a model reply (allows a ```json fence around it). Throws UnparseableOutput. */
export function parseModelOutput(text: string): unknown[] {
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) body = fence[1]!.trim();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new UnparseableOutput("model output is not JSON");
  }
  const top = z.object({ fixes: z.array(z.unknown()) }).safeParse(data);
  if (!top.success) throw new UnparseableOutput('model output has no "fixes" array');
  return top.data.fixes;
}

function urlsInText(text: string): string[] {
  return (text.match(URL_IN_TEXT) ?? []).map((u) => u.replace(/[.,;:!?)\]}]+$/, ""));
}

/**
 * CS-04: keep only fixes that stay inside the input. An item is dropped (and counted) when
 * - it does not match the schema (malformed),
 * - its checkId is not one of the input's failed/partial checks (unknown-check),
 * - it cites a URL, in evidenceUrls or anywhere in its text, that is not an input evidence URL (unknown-url),
 * - its text names a check ID that is not in the input (unknown-check-in-text),
 * - an earlier kept item already covers the same check (duplicate).
 */
export function validateFixes(raw: readonly unknown[], inputs: readonly FixInput[]): ValidationResult {
  const ids = new Set(inputs.map((i) => i.checkId));
  const urls = inputUrls(inputs);
  const kept: FixItem[] = [];
  const dropped: DroppedItem[] = [];
  const byReason = Object.fromEntries(DROP_REASONS.map((r) => [r, 0])) as Record<DropReason, number>;
  const drop = (reason: DropReason, detail: string) => {
    dropped.push({ reason, detail });
    byReason[reason]++;
  };

  raw.forEach((entry, idx) => {
    const parsed = ModelFixSchema.safeParse(entry);
    if (!parsed.success) return drop("malformed", `fix #${idx + 1} does not match the expected shape`);
    const fix = parsed.data;
    const checkId = fix.checkId.trim();
    if (!ids.has(checkId)) return drop("unknown-check", `fix #${idx + 1} cites check "${checkId}", which is not a failed or partial check in this scan`);

    const text = [fix.title, fix.why, fix.how].join("\n");
    const cited = [...fix.evidenceUrls, ...urlsInText(text)];
    for (const u of cited) {
      const n = normaliseUrl(u);
      if (!n || !urls.has(n)) return drop("unknown-url", `fix #${idx + 1} (${checkId}) cites ${u}, which is not in the scan evidence`);
    }
    const strayId = (text.match(CHECK_ID_IN_TEXT) ?? []).find((id) => !ids.has(id));
    if (strayId) return drop("unknown-check-in-text", `fix #${idx + 1} (${checkId}) mentions check ${strayId}, which is not a failed or partial check in this scan`);
    if (kept.some((k) => k.checkId === checkId)) return drop("duplicate", `fix #${idx + 1} repeats check ${checkId}`);

    const evidenceUrls = [...new Set(fix.evidenceUrls.map((u) => normaliseUrl(u)!))];
    kept.push({ checkId, title: fix.title.trim(), why: fix.why.trim(), how: fix.how.trim(), evidenceUrls, source: "llm" });
  });
  return { kept, dropped, byReason };
}
