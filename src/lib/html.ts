import * as cheerio from "cheerio";

export type Doc = cheerio.CheerioAPI;

// Parsing is pure; a small memo keeps repeated checks over the same HTML cheap without
// changing results (cheerio documents are only read, never mutated, by callers).
const cache = new Map<string, Doc>();
export function parse(html: string): Doc {
  let doc = cache.get(html);
  if (!doc) {
    doc = cheerio.load(html);
    if (cache.size > 200) cache.clear();
    cache.set(html, doc);
  }
  return doc;
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Visible body text, scripts/styles removed. Works on a fresh parse so the cached doc stays untouched. */
export function visibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  return collapse($("body").text());
}

/** 1-based line number of the first occurrence of `needle` in `text`, or undefined. */
export function lineOf(text: string, needle: string): number | undefined {
  const i = text.indexOf(needle);
  if (i < 0) return undefined;
  return text.slice(0, i).split("\n").length;
}

export type JsonLdBlock = { index: number; line?: number; ok: true; value: unknown } | { index: number; line?: number; ok: false; error: string };

export function jsonLdBlocks(html: string): JsonLdBlock[] {
  const $ = parse(html);
  const out: JsonLdBlock[] = [];
  $('script[type="application/ld+json"]').each((index, el) => {
    const text = $(el).html() ?? "";
    const line = lineOf(html, text.trim().slice(0, 40) || "application/ld+json");
    try {
      out.push({ index, line, ok: true, value: JSON.parse(text) as unknown });
    } catch (e) {
      out.push({ index, line, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  return out;
}

export type JsonLdNode = Record<string, unknown>;

/** Flatten parsed JSON-LD (arrays, @graph) into typed nodes. */
export function jsonLdNodes(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === "object") {
      const o = v as JsonLdNode;
      if ("@type" in o) nodes.push(o);
      if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(visit);
    }
  };
  for (const b of jsonLdBlocks(html)) if (b.ok) visit(b.value);
  return nodes;
}

export function nodeTypes(n: JsonLdNode): string[] {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

export function nodesOfType(html: string, types: readonly string[]): JsonLdNode[] {
  return jsonLdNodes(html).filter((n) => nodeTypes(n).some((t) => types.includes(t)));
}

export function present(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "object";
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}
