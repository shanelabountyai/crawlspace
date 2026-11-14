import type { CheckDefinition } from "./types";

const FRESH_DAYS = 90;

export const a3SitemapFresh: CheckDefinition = {
  id: "A3",
  category: "A",
  title: "Sitemap is present and fresh",
  appliesTo: "all",
  run({ snapshot }) {
    const s = snapshot.sitemap;
    const url = s?.url ?? new URL("/sitemap.xml", snapshot.url).href;
    if (!s || s.status !== 200 || s.body === null) {
      return { status: "fail", evidence: [{ url, detail: s ? `sitemap returned ${s.status}` : "no sitemap found" }] };
    }
    const locs = [...s.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].length;
    if (locs === 0) {
      return { status: "fail", evidence: [{ url, detail: "sitemap has no <loc> entries" }] };
    }
    const dates = [...s.body.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/g)]
      .map((m) => Date.parse(m[1]!))
      .filter((n) => Number.isFinite(n));
    if (dates.length === 0) {
      return { status: "partial", evidence: [{ url, detail: `${locs} URLs but no <lastmod>: agents cannot tell what changed` }] };
    }
    const newest = Math.max(...dates);
    const ageDays = Math.floor((Date.parse(snapshot.fetchedAt) - newest) / 86_400_000);
    const newestIso = new Date(newest).toISOString().slice(0, 10);
    if (ageDays <= FRESH_DAYS) {
      return { status: "pass", evidence: [{ url, detail: `${locs} URLs; newest lastmod ${newestIso} (${ageDays} days before scan)` }] };
    }
    return { status: "partial", evidence: [{ url, detail: `stale: newest lastmod ${newestIso} is ${ageDays} days old (> ${FRESH_DAYS})` }] };
  },
};
