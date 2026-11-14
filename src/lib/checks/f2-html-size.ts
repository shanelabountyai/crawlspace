import { scannedPages, type CheckDefinition } from "./types";

export const f2HtmlSize: CheckDefinition = {
  id: "F2",
  category: "F",
  title: "HTML size of key pages",
  appliesTo: "all",
  run(ctx) {
    const sized = scannedPages(ctx).map((p) => ({ p, bytes: Buffer.byteLength(p.rawHtml, "utf8") }));
    const worst = sized.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    const kb = Math.round(worst.bytes / 1024);
    const status = worst.bytes <= 500 * 1024 ? "pass" : worst.bytes <= 1536 * 1024 ? "partial" : "fail";
    return { status, evidence: [{ url: worst.p.url, detail: `largest raw HTML ${kb} KB (pass ≤ 500 KB, partial ≤ 1.5 MB)` }] };
  },
};
