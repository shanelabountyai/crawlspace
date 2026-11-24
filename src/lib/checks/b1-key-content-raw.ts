import { collapse, nodesOfType, parse, visibleText } from "../html";
import type { Page } from "../snapshot";
import { EVENT_TYPES, PRODUCT_TYPES } from "../sitetype";
import type { CheckContext, CheckDefinition, Evidence } from "./types";

const PRICE_RE = /(?:[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP))/;

interface Field {
  name: string;
  value: string | null;
}

function jsonLdName(html: string, types: readonly string[]): string | null {
  const n = nodesOfType(html, types).find((x) => typeof x.name === "string");
  return n ? collapse(String(n.name)) : null;
}

/** Key fields as a browser agent sees them (rendered DOM). */
export function keyFields(page: Page, siteType: CheckContext["siteType"]): Field[] {
  const $ = parse(page.renderedHtml);
  const h1 = collapse($("h1").first().text()) || null;
  const text = visibleText(page.renderedHtml);
  if (siteType === "ecommerce") {
    return [
      { name: "product name", value: h1 ?? jsonLdName(page.renderedHtml, PRODUCT_TYPES) },
      { name: "price", value: PRICE_RE.exec(text)?.[0] ?? null },
    ];
  }
  if (siteType === "event") {
    return [
      { name: "event title", value: h1 ?? jsonLdName(page.renderedHtml, EVENT_TYPES) },
      { name: "event date", value: collapse($("time").first().text()) || null },
    ];
  }
  return [{ name: "main heading", value: h1 }];
}

export const b1KeyContentRaw: CheckDefinition = {
  id: "B1",
  category: "B",
  title: "Key content is in the raw HTML (no JavaScript needed)",
  appliesTo: "all",
  needsRendered: true,
  run(ctx) {
    const oks: boolean[] = [];
    const evidence: Evidence[] = [];
    for (const page of ctx.keyPages) {
      const raw = visibleText(page.rawHtml).toLowerCase();
      for (const f of keyFields(page, ctx.siteType)) {
        if (f.value === null) {
          oks.push(false);
          evidence.push({ url: page.url, detail: `${f.name}: not found even after rendering` });
          continue;
        }
        const ok = raw.includes(f.value.toLowerCase());
        oks.push(ok);
        evidence.push({ url: page.url, detail: `${f.name} "${f.value}" ${ok ? "is in the raw HTML" : "appears only after JavaScript runs"}` });
      }
    }
    const n = oks.filter(Boolean).length;
    const status = n === oks.length ? "pass" : n === 0 ? "fail" : "partial";
    return { status, evidence };
  },
};
