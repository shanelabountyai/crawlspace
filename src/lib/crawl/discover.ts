import { collapse, nodesOfType, parse } from "../html";
import type { PageKind, SiteType } from "../snapshot";
import { EVENT_TYPES, PRODUCT_TYPES } from "../sitetype";

const PRODUCT_URL = /\/(products?|p|items?|dp|shop\/[^/]+)\/[^/?#]+/i;
const EVENT_URL = /\/(events?|e|tickets?|sessions?|conferences?|summit|meetups?|webinars?|shows?|concerts?)\/[^/?#]+/i;
const CART_URL = /\/(cart|basket|bag|checkout)(\/|$|\?)/i;
const CART_TEXT = /\b(cart|basket|bag|checkout)\b/i;
const REG_URL = /\/(register|registration|tickets?|rsvp|sign-?up|book(ing)?)(\/|$|\?)/i;
const REG_TEXT = /\b(register|registration|get tickets|buy tickets|rsvp|sign up|book now)\b/i;
const SKIP = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|css|js|mp4|mp3|woff2?|xml|txt)(\?|$)/i;

function bareHost(h: string): string {
  return h.toLowerCase().replace(/^www\./, "");
}

/** Same site = same host, ignoring a leading `www.`. Other hosts (CDNs, ticketing platforms) are never crawled as pages. */
export function sameSite(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (ua.protocol === "http:" || ua.protocol === "https:") && bareHost(ua.hostname) === bareHost(ub.hostname);
  } catch {
    return false;
  }
}

export function normalise(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

export interface Link {
  url: string;
  text: string;
}

export function extractLinks(html: string, base: string): Link[] {
  const $ = parse(html);
  const out: Link[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const url = normalise($(el).attr("href") ?? "", base);
    if (!url || seen.has(url) || !sameSite(url, base) || SKIP.test(url)) return;
    seen.add(url);
    out.push({ url, text: collapse($(el).attr("aria-label") || $(el).text()) });
  });
  return out;
}

export interface SitemapParse {
  urls: string[];
  childSitemaps: string[];
}

export function parseSitemap(xml: string): SitemapParse {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
  return /<sitemapindex[\s>]/i.test(xml) ? { urls: [], childSitemaps: locs } : { urls: locs, childSitemaps: [] };
}

export function urlKind(url: string): "product" | "event" | null {
  const path = new URL(url).pathname;
  if (PRODUCT_URL.test(path)) return "product";
  if (EVENT_URL.test(path)) return "event";
  return null;
}

/** Site-type hint before key pages are fetched: home JSON-LD first, then which URL pattern dominates. */
export function guessSiteType(homeHtml: string, candidates: string[]): SiteType {
  if (nodesOfType(homeHtml, EVENT_TYPES).length) return "event";
  if (nodesOfType(homeHtml, PRODUCT_TYPES).length) return "ecommerce";
  const kinds = candidates.map(urlKind);
  const p = kinds.filter((k) => k === "product").length;
  const e = kinds.filter((k) => k === "event").length;
  if (p === 0 && e === 0) return "other";
  return p >= e ? "ecommerce" : "event";
}

/** Up to `max` product or event URLs: links on the home page first (what the site promotes), then the sitemap. */
export function pickKeyPages(siteType: SiteType, homeUrl: string, homeLinks: Link[], sitemapUrls: string[], max: number, allowed: (url: string) => boolean): { picked: string[]; skipped: string[] } {
  if (siteType === "other") return { picked: [], skipped: [] };
  const want = siteType === "ecommerce" ? "product" : "event";
  const ordered = [...homeLinks.map((l) => l.url), ...sitemapUrls.filter((u) => sameSite(u, homeUrl))];
  const picked: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>([new URL(homeUrl).href]);
  for (const u of ordered) {
    if (picked.length >= max) break;
    if (seen.has(u) || urlKind(u) !== want) continue;
    seen.add(u);
    if (allowed(u)) picked.push(u);
    else skipped.push(u);
  }
  return { picked, skipped };
}

/** The cart or registration entry point linked from the home or key pages (same site only). */
export function findActionLink(siteType: SiteType, pages: { url: string; html: string }[]): { url: string; kind: PageKind } | null {
  if (siteType === "other") return null;
  const [urlRe, textRe, kind]: [RegExp, RegExp, PageKind] = siteType === "ecommerce" ? [CART_URL, CART_TEXT, "cart"] : [REG_URL, REG_TEXT, "registration"];
  for (const p of pages) {
    const links = extractLinks(p.html, p.url).filter((l) => l.url !== p.url);
    const hit = links.find((l) => urlRe.test(new URL(l.url).pathname + new URL(l.url).search)) ?? links.find((l) => textRe.test(l.text));
    if (hit) return { url: hit.url, kind };
    // Forms whose action is the cart/registration endpoint (e.g. "Add to cart" posts to /cart): visit the action with GET only.
    const $ = parse(p.html);
    const action = $("form[action]")
      .map((_, el) => normalise($(el).attr("action") ?? "", p.url))
      .get()
      .find((u): u is string => typeof u === "string" && sameSite(u, p.url) && urlRe.test(new URL(u).pathname));
    if (action) return { url: action, kind };
  }
  return null;
}

/** Kind of a fetched page from its own JSON-LD, else its URL. */
export function pageKind(url: string, html: string): PageKind {
  if (nodesOfType(html, PRODUCT_TYPES.filter((t) => t.startsWith("Product"))).length) return "product";
  if (nodesOfType(html, EVENT_TYPES).length) return "event";
  return urlKind(url) ?? "other";
}
