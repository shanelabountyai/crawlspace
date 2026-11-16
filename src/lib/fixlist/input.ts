import type { Scorecard } from "../scan";
import type { FixInput } from "./types";

/** Failed and partial checks only, in rubric order. */
export function fixInputs(card: Scorecard): FixInput[] {
  const out: FixInput[] = [];
  for (const c of card.checks) {
    if (c.status !== "fail" && c.status !== "partial") continue;
    const item: FixInput = { checkId: c.id, title: c.title, category: c.category, status: c.status, weight: c.weight, evidence: c.evidence.map((e) => ({ ...e })) };
    if (c.label) item.label = c.label;
    out.push(item);
  }
  return out;
}

/** Normalised form used for every URL comparison (WHATWG href, no fragment). Null if not an http(s) URL. */
export function normaliseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Every evidence URL in the input, normalised. */
export function inputUrls(inputs: readonly FixInput[]): Set<string> {
  const s = new Set<string>();
  for (const i of inputs) for (const e of i.evidence) if (e.url) {
    const n = normaliseUrl(e.url);
    if (n) s.add(n);
  }
  return s;
}
