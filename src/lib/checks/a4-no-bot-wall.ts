import { visibleText, parse, collapse } from "../html";
import type { Page } from "../snapshot";
import type { CheckDefinition, Evidence } from "./types";

const WALL_STATUSES = new Set([401, 403, 429, 503]);
const MARKERS = [/just a moment\.\.\./i, /checking your browser/i, /attention required/i, /verify you are (a )?human/i, /cf-chl-/i, /challenge-platform/i];

export function wallReason(p: Pick<Page, "status" | "rawHtml">): string | null {
  if (WALL_STATUSES.has(p.status)) return `HTTP ${p.status}`;
  const title = collapse(parse(p.rawHtml)("title").text());
  const haystack = `${title} ${visibleText(p.rawHtml)} ${p.rawHtml.slice(0, 5000)}`;
  const m = MARKERS.find((re) => re.test(haystack));
  return m ? `challenge-page marker ${m}` : null;
}

export const a4NoBotWall: CheckDefinition = {
  id: "A4",
  category: "A",
  title: "No bot wall on key pages",
  appliesTo: "all",
  run(ctx) {
    const pages = ctx.snapshot.pages.filter((p) => p.kind !== "other");
    const evidence: Evidence[] = [];
    let homeWalled = false;
    for (const p of pages) {
      const why = wallReason(p);
      if (why) {
        evidence.push({ url: p.url, detail: `${p.kind} page looks like a bot wall (${why})` });
        if (p.kind === "home") homeWalled = true;
      }
    }
    if (evidence.length === 0) {
      return { status: "pass", evidence: [{ detail: `${pages.length} pages served normally (no 401/403/429/503, no challenge markers)` }] };
    }
    return { status: homeWalled ? "fail" : "partial", evidence };
  },
};
