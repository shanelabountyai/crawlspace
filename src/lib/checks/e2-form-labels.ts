import { parse } from "../html";
import type { CheckDefinition } from "./types";

const FIELDS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), select, textarea';

export const e2FormLabels: CheckDefinition = {
  id: "E2",
  category: "E",
  title: "Form fields have labels",
  appliesTo: "all",
  run({ snapshot }) {
    let total = 0;
    let labelled = 0;
    const evidence = [];
    for (const p of snapshot.pages) {
      const $ = parse(p.renderedHtml);
      $(FIELDS).each((_, el) => {
        const $el = $(el);
        total++;
        const id = $el.attr("id");
        const ok =
          ($el.attr("aria-label") ?? "").trim() !== "" ||
          ($el.attr("aria-labelledby") ?? "").trim() !== "" ||
          (id !== undefined && $(`label[for="${id}"]`).length > 0) ||
          $el.closest("label").length > 0;
        if (ok) labelled++;
        else {
          const name = $el.attr("name");
          evidence.push({ url: p.url, selector: `${el.tagName}${id ? "#" + id : name ? `[name="${name}"]` : ""}`, detail: "field has no label" });
        }
      });
    }
    if (total === 0) return { status: "not-applicable", evidence: [{ detail: "no form fields on scanned pages" }] };
    const ratio = labelled / total;
    evidence.unshift({ detail: `${labelled} of ${total} fields labelled` });
    return { status: ratio === 1 ? "pass" : ratio >= 0.5 ? "partial" : "fail", evidence };
  },
};
