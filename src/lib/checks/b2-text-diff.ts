import { visibleText } from "../html";
import { scannedPages, type CheckDefinition, type Evidence } from "./types";

export const b2TextDiff: CheckDefinition = {
  id: "B2",
  category: "B",
  title: "Most visible text is present without JavaScript",
  appliesTo: "all",
  needsRendered: true,
  run(ctx) {
    let raw = 0;
    let rendered = 0;
    const evidence: Evidence[] = scannedPages(ctx).map((p) => {
      const r = visibleText(p.rawHtml).length;
      const d = visibleText(p.renderedHtml).length;
      raw += Math.min(r, d);
      rendered += d;
      const pct = d === 0 ? 0 : Math.round((Math.min(r, d) / d) * 100);
      return { url: p.url, detail: `${pct}% of rendered text is in the raw HTML (${r} of ${d} chars)` };
    });
    if (rendered === 0) return { status: "fail", evidence: [...evidence, { detail: "no visible text even after rendering" }] };
    const ratio = raw / rendered;
    const diff = Math.round((1 - ratio) * 100);
    evidence.unshift({ detail: `text diff: ${diff}% of visible text needs JavaScript` });
    return { status: ratio >= 0.9 ? "pass" : ratio >= 0.5 ? "partial" : "fail", evidence };
  },
};
