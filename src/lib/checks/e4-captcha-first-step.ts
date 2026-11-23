import type { CheckDefinition, Evidence } from "./types";

const MARKERS: [RegExp, string][] = [
  [/class="[^"]*\bg-recaptcha\b/i, "reCAPTCHA widget"],
  [/class="[^"]*\bh-captcha\b/i, "hCaptcha widget"],
  [/class="[^"]*\bcf-turnstile\b/i, "Turnstile widget"],
  [/src="[^"]*(recaptcha|hcaptcha|turnstile)[^"]*"/i, "CAPTCHA script"],
  [/\bcaptcha\b/i, "the word CAPTCHA"],
];

export const e4CaptchaFirstStep: CheckDefinition = {
  id: "E4",
  category: "E",
  title: "No CAPTCHA on the first cart/registration step",
  appliesTo: ["ecommerce", "event"],
  needsRendered: true,
  run({ actionPages }) {
    if (actionPages.length === 0) return { status: "not-applicable", evidence: [{ detail: "no cart or registration page captured" }] };
    const evidence: Evidence[] = [];
    for (const p of actionPages) {
      const html = `${p.rawHtml}\n${p.renderedHtml}`;
      const hit = MARKERS.find(([re]) => re.test(html));
      if (hit) evidence.push({ url: p.url, detail: `${hit[1]} on the first step: agents stop here` });
    }
    if (evidence.length) return { status: "fail", evidence };
    return { status: "pass", evidence: [{ detail: `${actionPages.length} action page(s) without CAPTCHA markers` }] };
  },
};
