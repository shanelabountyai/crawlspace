import { scannedPages, type CheckDefinition } from "./types";

export const f1Ttfb: CheckDefinition = {
  id: "F1",
  category: "F",
  title: "Time to first byte on key pages",
  appliesTo: "all",
  run(ctx) {
    const pages = scannedPages(ctx);
    const worst = pages.reduce((a, b) => (b.ttfbMs > a.ttfbMs ? b : a));
    const ms = worst.ttfbMs;
    const status = ms <= 800 ? "pass" : ms <= 1800 ? "partial" : "fail";
    return { status, evidence: [{ url: worst.url, detail: `slowest TTFB ${ms} ms (pass ≤ 800, partial ≤ 1800)` }] };
  },
};
