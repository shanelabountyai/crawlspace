import { nodesOfType } from "./html";
import type { SiteType, Snapshot } from "./snapshot";

export const PRODUCT_TYPES = ["Product", "ProductGroup", "Offer", "AggregateOffer"] as const;
export const EVENT_TYPES = [
  "Event", "BusinessEvent", "EducationEvent", "ExhibitionEvent", "Festival", "MusicEvent",
  "SocialEvent", "SportsEvent", "TheaterEvent", "ComedyEvent", "SaleEvent",
] as const;

export interface SiteTypeResult {
  siteType: SiteType;
  source: "override" | "jsonld-raw" | "jsonld-rendered" | "page-kinds" | "default";
}

export function detectSiteType(s: Snapshot): SiteTypeResult {
  if (s.siteTypeOverride) return { siteType: s.siteTypeOverride, source: "override" };
  for (const [view, source] of [["rawHtml", "jsonld-raw"], ["renderedHtml", "jsonld-rendered"]] as const) {
    const hasEvent = s.pages.some((p) => nodesOfType(p[view], EVENT_TYPES).length > 0);
    const hasProduct = s.pages.some((p) => nodesOfType(p[view], PRODUCT_TYPES).length > 0);
    if (hasProduct && !hasEvent) return { siteType: "ecommerce", source };
    if (hasEvent && !hasProduct) return { siteType: "event", source };
    if (hasEvent && hasProduct) {
      // Event pages often embed an Offer; the Event node is the stronger signal.
      return { siteType: "event", source };
    }
  }
  const kinds = new Set(s.pages.map((p) => p.kind));
  if (kinds.has("product") || kinds.has("cart")) return { siteType: "ecommerce", source: "page-kinds" };
  if (kinds.has("event") || kinds.has("registration")) return { siteType: "event", source: "page-kinds" };
  return { siteType: "other", source: "default" };
}
