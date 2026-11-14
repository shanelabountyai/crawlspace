import { jsonLdBlocks } from "../html";
import type { CheckDefinition, Evidence } from "./types";

export const c1JsonLdParses: CheckDefinition = {
  id: "C1",
  category: "C",
  title: "JSON-LD structured data parses",
  appliesTo: "all",
  run({ snapshot }) {
    let ok = 0;
    let bad = 0;
    let renderedOnly = 0;
    const evidence: Evidence[] = [];
    for (const p of snapshot.pages) {
      const blocks = jsonLdBlocks(p.rawHtml);
      for (const b of blocks) {
        if (b.ok) ok++;
        else {
          bad++;
          evidence.push({ url: p.url, line: b.line, selector: `script[type="application/ld+json"]:nth-of-type(${b.index + 1})`, detail: `JSON-LD does not parse: ${b.error}` });
        }
      }
      if (blocks.length === 0) {
        const r = jsonLdBlocks(p.renderedHtml).filter((b) => b.ok).length;
        if (r > 0) {
          renderedOnly += r;
          evidence.push({ url: p.url, detail: `${r} JSON-LD block(s) appear only after JavaScript runs` });
        }
      }
    }
    if (ok + bad === 0) {
      if (renderedOnly > 0) return { status: "partial", evidence };
      return { status: "fail", evidence: [{ detail: "no JSON-LD found on any page" }] };
    }
    if (bad === 0 && renderedOnly === 0) {
      return { status: "pass", evidence: [{ detail: `${ok} JSON-LD block(s) parse cleanly in the raw HTML` }] };
    }
    if (ok === 0 && renderedOnly === 0) return { status: "fail", evidence };
    return { status: "partial", evidence: [{ detail: `${ok} block(s) parse, ${bad} do not` }, ...evidence] };
  },
};
