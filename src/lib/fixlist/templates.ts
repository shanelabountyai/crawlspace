import { normaliseUrl } from "./input";
import type { FixInput, FixItem } from "./types";

interface Template {
  title: string;
  /** Why it matters to an agent (the evidence is appended). */
  why: string;
  how: string;
}

/** One template per rubric check ID (PRD §3: used when no model is available or the model skipped a check). */
export const TEMPLATES: Record<string, Template> = {
  A1: {
    title: "Serve a robots.txt file",
    why: "Agents and crawlers read /robots.txt first to learn what they may fetch. Without a reachable file they have to guess, and some stop.",
    how: "Publish a plain-text /robots.txt at the root of the site that returns HTTP 200. Allow the pages you want agents to read and add a Sitemap: line pointing to your sitemap.",
  },
  A2: {
    title: "Let the AI agents you want in through robots.txt",
    why: "robots.txt currently blocks some or all of the AI user agents Crawlspace checks for, so those assistants cannot read your key pages.",
    how: "Decide which AI agents you want to serve, then remove the Disallow rules that block them from the home, product/event and cart/registration pages. Keep blocking only the agents you deliberately exclude.",
  },
  A3: {
    title: "Publish a fresh XML sitemap",
    why: "A sitemap tells agents which pages exist and how recently they changed. A missing or stale sitemap hides new products and events.",
    how: "Serve /sitemap.xml (or point to it from robots.txt) listing your key pages, each with a <lastmod> date, and regenerate it whenever content changes.",
  },
  A4: {
    title: "Remove the bot wall from key pages",
    why: "Some key pages answered with a block or challenge page instead of content. An agent sees the wall, not your product or event.",
    how: "Configure your firewall or bot protection to serve normal pages to well-behaved agents (identified by user agent and rate) and reserve challenges for abusive traffic. Never challenge the home page.",
  },
  B1: {
    title: "Put the key facts in the HTML the server sends",
    why: "Agents that do not run JavaScript only see the HTML as served. The key facts (name and price, or title and date) are missing from it.",
    how: "Render the product name and price, or the event title and date, on the server (server-side rendering or static generation) so they are in the page source, not injected later by JavaScript.",
  },
  B2: {
    title: "Reduce how much text needs JavaScript",
    why: "A large share of the visible text only appears after JavaScript runs, so non-JavaScript agents see an almost empty page.",
    how: "Server-render the main content of each page (headings, descriptions, prices, dates). Keep JavaScript for interactivity rather than for producing the text itself.",
  },
  C1: {
    title: "Fix the JSON-LD structured data",
    why: "Structured data is the most reliable way for an agent to read facts, but some JSON-LD blocks are broken, missing, or only appear after JavaScript runs.",
    how: "Emit valid JSON-LD in a <script type=\"application/ld+json\"> tag in the server-sent HTML, and check it with a structured-data validator after every template change.",
  },
  C2: {
    title: "Complete the Product and Offer data",
    why: "Shopping agents look for Product and Offer structured data with name, price, currency and availability. It is missing, incomplete or only present after JavaScript runs.",
    how: "On every product page add a Product JSON-LD block with name and an Offer that has price, priceCurrency and availability, rendered in the server-sent HTML.",
  },
  C3: {
    title: "Complete the Event data",
    why: "Agents that find and book events look for Event structured data with name, startDate, location and offers. It is missing, incomplete or only present after JavaScript runs.",
    how: "On every event page add an Event JSON-LD block with name, startDate (ISO 8601 with time zone), location and offers (price or free, plus the registration URL), rendered in the server-sent HTML.",
  },
  C4: {
    title: "Describe your organization in structured data",
    why: "An Organization block tells agents who runs the site, which helps them trust and attribute what they read. It is missing or only appears after JavaScript runs.",
    how: "Add an Organization JSON-LD block (name, url, logo, contact point) to the home page HTML as served.",
  },
  D1: {
    title: "Add a well-formed /llms.txt (proposed convention)",
    why: "/llms.txt is a proposed convention, not a standard, so it carries little weight here. Where agents do read it, it gives them a short map of your most useful pages.",
    how: "Publish /llms.txt as Markdown: an H1 with the site name, a one-line summary, then sections of links to your key pages. Keep it short and up to date.",
  },
  D2: {
    title: "Add the OpenGraph basics to the home page",
    why: "OpenGraph tags give agents and link previews a reliable title, type, image and canonical URL for the site.",
    how: "Add og:title, og:type, og:image and og:url meta tags to the <head> of the home page as served.",
  },
  E1: {
    title: "Make the main call to action a real, named button",
    why: "Agents act through buttons and links. The primary action (add to cart or register) is missing, unnamed, or built from an element agents cannot reliably press. This check is a heuristic.",
    how: "Use a <button> or <a href> for the primary action, with visible text or an aria-label such as \"Add to cart\" or \"Register\", present in the rendered page.",
  },
  E2: {
    title: "Label every form field",
    why: "Agents fill forms by matching labels to fields. Unlabelled fields force them to guess what to type.",
    how: "Give every input, select and textarea a <label for> (or aria-label / aria-labelledby) that says what it expects. Placeholder text alone is not a label.",
  },
  E3: {
    title: "Offer a guest path without a forced account",
    why: "An agent acting for someone usually cannot create or sign in to an account. The cart or registration step appears to require one. This check is a heuristic.",
    how: "Let people check out or register as a guest (email only), and make the guest option visible on the first step.",
  },
  E4: {
    title: "Move the CAPTCHA off the first step",
    why: "A CAPTCHA on the first cart or registration step stops agents before they can start.",
    how: "Remove the CAPTCHA from the first step; if you need bot protection, use invisible risk scoring and only challenge suspicious sessions at the final submit.",
  },
  F1: {
    title: "Speed up the server response",
    why: "Slow time to first byte makes agents wait and can make them time out before reading the page.",
    how: "Cache key pages (CDN or full-page cache), and profile slow server work such as database queries or third-party calls made during the request. Aim for under 800 ms.",
  },
  F2: {
    title: "Shrink the HTML of key pages",
    why: "Very large HTML pages are slow to download and parse, and agents may truncate them before reaching the important content.",
    how: "Move inline data blobs, large inline scripts and styles, and repeated markup out of the HTML. Aim for under 500 KB per page.",
  },
};

/** The template fix for one check, filled with that check's evidence. Throws for an unknown ID (registry and templates must match). */
export function templateFix(input: FixInput): FixItem {
  const t = TEMPLATES[input.checkId];
  if (!t) throw new Error(`no fix-list template for check ${input.checkId}`);
  const details = input.evidence.map((e) => e.detail).filter(Boolean);
  const found = details.length ? ` Found: ${details.slice(0, 3).join("; ")}${details.length > 3 ? "; …" : ""}.` : "";
  const partly = input.status === "partial" ? " (partly passing)" : "";
  const evidenceUrls = [...new Set(input.evidence.flatMap((e) => (e.url ? [normaliseUrl(e.url)].filter((u): u is string => !!u) : [])))];
  return { checkId: input.checkId, title: t.title, why: `${t.why}${partly}${found}`, how: t.how, evidenceUrls, source: "template" };
}
