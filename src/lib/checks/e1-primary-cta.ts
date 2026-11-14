import { collapse, parse } from "../html";
import type { CheckDefinition, Evidence } from "./types";

export const CTA_RE = /\b(add to (cart|bag|basket)|buy now|buy tickets?|get tickets?|book now|register|sign up|rsvp|reserve)\b/i;
const CONTROLS = 'button, a[href], input[type="submit"], input[type="button"], [role="button"]';

export const e1PrimaryCta: CheckDefinition = {
  id: "E1",
  category: "E",
  title: "Primary call to action is a real button or link with a name",
  label: "heuristic",
  appliesTo: ["ecommerce", "event"],
  run(ctx) {
    const oks: boolean[] = [];
    const evidence: Evidence[] = [];
    for (const p of ctx.keyPages) {
      const $ = parse(p.renderedHtml);
      let found: string | null = null;
      $(CONTROLS).each((_, el) => {
        if (found) return;
        const $el = $(el);
        const name = collapse($el.attr("aria-label") ?? "") || collapse($el.text()) || collapse($el.attr("value") ?? "");
        if (CTA_RE.test(name)) found = `<${el.tagName}> "${name}"`;
      });
      if (found) {
        oks.push(true);
        evidence.push({ url: p.url, detail: `CTA is ${found}` });
        continue;
      }
      oks.push(false);
      const fake = $("div, span, li, p")
        .filter((_, el) => CTA_RE.test(collapse($(el).clone().children().remove().end().text())))
        .first();
      if (fake.length) {
        const cls = fake.attr("class");
        evidence.push({ url: p.url, selector: `${fake.prop("tagName")?.toLowerCase()}${cls ? "." + cls.split(/\s+/)[0] : ""}`, detail: `CTA "${collapse(fake.text())}" is a non-interactive element agents cannot reliably press` });
      } else {
        evidence.push({ url: p.url, detail: "no add-to-cart / register control found" });
      }
    }
    const n = oks.filter(Boolean).length;
    return { status: n === oks.length ? "pass" : n === 0 ? "fail" : "partial", evidence };
  },
};
