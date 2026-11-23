import { parse, visibleText } from "../html";
import type { CheckDefinition, Evidence } from "./types";

const GUEST_RE = /\b(guest checkout|check ?out as (a )?guest|continue as (a )?guest|register as (a )?guest|no account (needed|required))\b/i;

export const e3GuestPath: CheckDefinition = {
  id: "E3",
  category: "E",
  title: "Guest path exists without a forced account",
  label: "heuristic",
  appliesTo: ["ecommerce", "event"],
  needsRendered: true,
  run({ actionPages }) {
    if (actionPages.length === 0) return { status: "not-applicable", evidence: [{ detail: "no cart or registration page captured" }] };
    const evidence: Evidence[] = [];
    let forced = 0;
    for (const p of actionPages) {
      const $ = parse(p.renderedHtml);
      const password = $('input[type="password"]').length > 0;
      const guest = GUEST_RE.test(visibleText(p.renderedHtml));
      if (password && !guest) {
        forced++;
        evidence.push({ url: p.url, selector: 'input[type="password"]', detail: "first step asks for a password and offers no guest option" });
      } else {
        evidence.push({ url: p.url, detail: guest ? "explicit guest option" : "no password required on first step" });
      }
    }
    return { status: forced === 0 ? "pass" : "fail", evidence };
  },
};
