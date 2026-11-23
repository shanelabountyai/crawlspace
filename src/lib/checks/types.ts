import type { Agent, Status } from "../rules";
import type { Page, SiteType, Snapshot } from "../snapshot";

export const CATEGORIES = {
  A: "Access",
  B: "Readable without JS",
  C: "Structured data",
  D: "Machine guidance",
  E: "Actionability",
  F: "Speed",
} as const;
export type Category = keyof typeof CATEGORIES;

export interface Evidence {
  url?: string;
  selector?: string;
  line?: number;
  detail: string;
}

export interface CheckOutcome {
  status: Status;
  evidence: Evidence[];
}

export interface CheckContext {
  snapshot: Snapshot;
  siteType: SiteType;
  agents: readonly Agent[];
  home: Page;
  /** product/event pages; home for `other` sites or when none were captured. */
  keyPages: Page[];
  /** cart/registration pages. */
  actionPages: Page[];
}

export interface CheckDefinition {
  id: string;
  category: Category;
  title: string;
  /** Shown next to the result so readers know how much to trust it. */
  label?: "heuristic" | "proposed convention";
  appliesTo: readonly SiteType[] | "all";
  /**
   * The check reads the rendered view (D-14: all of E, and B's raw-versus-rendered comparison). On a snapshot whose
   * pages were not rendered it is not run and returns N/A, "page could not be rendered" (PRD-02 requirement 6).
   */
  needsRendered?: boolean;
  run(ctx: CheckContext): CheckOutcome;
}

export interface CheckResult extends CheckOutcome {
  id: string;
  category: Category;
  title: string;
  label?: CheckDefinition["label"];
  weight: number;
}

export function buildContext(snapshot: Snapshot, siteType: SiteType, agents: readonly Agent[]): CheckContext {
  const home = snapshot.pages.find((p) => p.kind === "home")!;
  const wanted = siteType === "ecommerce" ? ["product"] : siteType === "event" ? ["event"] : [];
  let keyPages = snapshot.pages.filter((p) => wanted.includes(p.kind));
  if (keyPages.length === 0) keyPages = [home];
  const actionPages = snapshot.pages.filter((p) => p.kind === "cart" || p.kind === "registration");
  return { snapshot, siteType, agents, home, keyPages, actionPages };
}

/** All three outcomes from a per-item boolean list: all → pass, none → fail, else partial. */
export function tally(oks: boolean[]): Status {
  const n = oks.filter(Boolean).length;
  if (n === oks.length) return "pass";
  if (n === 0) return "fail";
  return "partial";
}

/** Home + key pages, deduplicated, in snapshot order. */
export function scannedPages(ctx: CheckContext): Page[] {
  const ids = new Set([ctx.home.id, ...ctx.keyPages.map((p) => p.id)]);
  return ctx.snapshot.pages.filter((p) => ids.has(p.id));
}
