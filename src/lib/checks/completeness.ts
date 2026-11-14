import { nodesOfType, present, type JsonLdNode } from "../html";
import type { Page } from "../snapshot";
import type { Status } from "../rules";
import type { Evidence } from "./types";

type Getter = (n: JsonLdNode) => unknown;
export type FieldSpec = Record<string, Getter>;

function firstOffer(n: JsonLdNode): JsonLdNode | null {
  const o = n.offers;
  const first = Array.isArray(o) ? o[0] : o;
  return first && typeof first === "object" ? (first as JsonLdNode) : null;
}

export const offerField = (key: string, alt?: string): Getter => (n) => {
  const o = firstOffer(n);
  if (!o) return undefined;
  return present(o[key]) ? o[key] : alt ? o[alt] : undefined;
};

function missing(n: JsonLdNode, spec: FieldSpec): string[] {
  return Object.entries(spec).filter(([, get]) => !present(get(n))).map(([k]) => k);
}

/** Best node on a page = the one with the fewest missing fields. */
function best(html: string, types: readonly string[], spec: FieldSpec): { node: JsonLdNode; missing: string[] } | null {
  const scored = nodesOfType(html, types).map((node) => ({ node, missing: missing(node, spec) }));
  scored.sort((a, b) => a.missing.length - b.missing.length);
  return scored[0] ?? null;
}

/** Shared rule for C2/C3: complete in raw on every page → pass; nothing anywhere → fail; else partial. */
export function completeness(pages: Page[], types: readonly string[], typeLabel: string, spec: FieldSpec): { status: Status; evidence: Evidence[] } {
  const grades: ("full" | "some" | "none")[] = [];
  const evidence: Evidence[] = [];
  for (const p of pages) {
    const raw = best(p.rawHtml, types, spec);
    if (raw && raw.missing.length === 0) {
      grades.push("full");
      evidence.push({ url: p.url, detail: `${typeLabel} complete in raw HTML (${Object.keys(spec).join(", ")})` });
      continue;
    }
    const rendered = best(p.renderedHtml, types, spec);
    if (!raw && rendered && rendered.missing.length === 0) {
      grades.push("some");
      evidence.push({ url: p.url, detail: `${typeLabel} complete only after JavaScript runs` });
    } else if (raw || rendered) {
      grades.push("some");
      const m = (raw ?? rendered)!.missing;
      evidence.push({ url: p.url, detail: `${typeLabel} missing: ${m.join(", ")}` });
    } else {
      grades.push("none");
      evidence.push({ url: p.url, detail: `no ${typeLabel} structured data` });
    }
  }
  const status: Status = grades.every((g) => g === "full") ? "pass" : grades.every((g) => g === "none") ? "fail" : "partial";
  return { status, evidence };
}
