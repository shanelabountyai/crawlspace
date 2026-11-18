import { randomBytes } from "node:crypto";
import type { CrawlReport } from "@/lib/crawl";
import type { FixList } from "@/lib/fixlist";
import type { Scorecard } from "@/lib/scan";
import type { Db } from "./db";

export const SCAN_STATUSES = ["queued", "running", "done", "failed"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

/** Crawl facts worth keeping (D-29: no page HTML). */
export interface CrawlSummary {
  pageRequests: number;
  assetRequests: number;
  blockedBrowserRequests: number;
  skipped: { url: string; reason: string }[];
  notes: string[];
}

export interface ReportView {
  finalUrl: string;
  siteType: string;
  rubricVersion: number;
  overall: number | null;
  scorecard: Scorecard;
  fixList: FixList;
  crawl: CrawlSummary;
}

export interface ScanView {
  id: string;
  url: string;
  status: ScanStatus;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  report: ReportView | null;
}

export function summariseCrawl(report: CrawlReport): CrawlSummary {
  return {
    pageRequests: report.requests.filter((r) => r.kind === "page").length,
    assetRequests: report.requests.filter((r) => r.kind === "asset").length,
    blockedBrowserRequests: report.renderEvents.filter((e) => e.action === "blocked").length,
    skipped: report.skipped.map((s) => ({ ...s })),
    notes: [...report.notes],
  };
}

/**
 * URL-safe, unguessable scan id (reports are private by link). Never starts with "-", so the CSV formula guard
 * leaves it alone and exported ids match stored ones exactly (D-46). Existing ids still match `SCAN_ID_RE`.
 */
export function newScanId(): string {
  for (;;) {
    const id = randomBytes(12).toString("base64url");
    if (id[0] !== "-") return id;
  }
}

export const SCAN_ID_RE = /^[A-Za-z0-9_-]{16}$/;

export class ScanStore {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async create(url: string): Promise<string> {
    const id = newScanId();
    await this.db.scan.create({ data: { id, url, status: "queued", createdAt: this.now() } });
    return id;
  }

  async markRunning(id: string): Promise<void> {
    await this.db.scan.update({ where: { id }, data: { status: "running", startedAt: this.now() } });
  }

  async markDone(id: string, card: Scorecard, fixList: FixList, crawl: CrawlSummary): Promise<void> {
    const report = {
      finalUrl: card.url,
      siteType: card.siteType,
      rubricVersion: card.rubricVersion,
      overall: card.overall,
      scorecard: JSON.stringify(card),
      fixList: JSON.stringify(fixList),
      crawl: JSON.stringify(crawl),
    };
    await this.db.$transaction([
      this.db.report.upsert({ where: { scanId: id }, create: { scanId: id, ...report }, update: report }),
      this.db.scan.update({ where: { id }, data: { status: "done", error: null, finishedAt: this.now() } }),
    ]);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db.scan.update({ where: { id }, data: { status: "failed", error: error.slice(0, 2000), finishedAt: this.now() } });
  }

  /** On startup: scans left queued or running by a previous process will never finish (D-29). */
  async failInterrupted(): Promise<number> {
    const r = await this.db.scan.updateMany({
      where: { status: { in: ["queued", "running"] } },
      data: { status: "failed", error: "interrupted: the server restarted before this scan finished; run it again", finishedAt: this.now() },
    });
    return r.count;
  }

  async get(id: string): Promise<ScanView | null> {
    if (!SCAN_ID_RE.test(id)) return null;
    const s = await this.db.scan.findUnique({ where: { id }, include: { report: true } });
    if (!s) return null;
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      id: s.id,
      url: s.url,
      status: s.status as ScanStatus,
      error: s.error,
      createdAt: s.createdAt.toISOString(),
      startedAt: iso(s.startedAt),
      finishedAt: iso(s.finishedAt),
      report: s.report
        ? {
            finalUrl: s.report.finalUrl,
            siteType: s.report.siteType,
            rubricVersion: s.report.rubricVersion,
            overall: s.report.overall,
            scorecard: JSON.parse(s.report.scorecard) as Scorecard,
            fixList: JSON.parse(s.report.fixList) as FixList,
            crawl: JSON.parse(s.report.crawl) as CrawlSummary,
          }
        : null,
    };
  }
}

export const HUBSPOT_STATUSES = ["off", "sent", "failed"] as const;
export type HubSpotStatus = (typeof HUBSPOT_STATUSES)[number];

export interface LeadView {
  id: string;
  scanId: string;
  scanUrl: string;
  email: string;
  createdAt: string;
  hubspotStatus: HubSpotStatus;
  hubspotError: string | null;
}

/** A scan row for the operator page (no scorecard JSON parsed). */
export interface ScanListItem {
  id: string;
  url: string;
  status: ScanStatus;
  createdAt: string;
  finishedAt: string | null;
  overall: number | null;
  categories: Record<string, number | null> | null;
  leadCount: number;
}

/** Leads left at the PDF gate (D-36). */
export class LeadStore {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async create(scanId: string, email: string): Promise<LeadView> {
    const row = await this.db.lead.create({
      data: { id: newScanId(), scanId, email, createdAt: this.now(), hubspotStatus: "off" },
      include: { scan: { select: { url: true } } },
    });
    return toLead(row);
  }

  async setHubSpot(id: string, status: HubSpotStatus, error: string | null = null): Promise<void> {
    await this.db.lead.update({ where: { id }, data: { hubspotStatus: status, hubspotError: error?.slice(0, 500) ?? null } });
  }

  async countSince(scanId: string, since: Date): Promise<number> {
    return this.db.lead.count({ where: { scanId, createdAt: { gte: since } } });
  }

  async list(limit = 500): Promise<LeadView[]> {
    const rows = await this.db.lead.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { scan: { select: { url: true } } } });
    return rows.map(toLead);
  }
}

function toLead(r: { id: string; scanId: string; email: string; createdAt: Date; hubspotStatus: string; hubspotError: string | null; scan: { url: string } }): LeadView {
  return { id: r.id, scanId: r.scanId, scanUrl: r.scan.url, email: r.email, createdAt: r.createdAt.toISOString(), hubspotStatus: r.hubspotStatus as HubSpotStatus, hubspotError: r.hubspotError };
}

/** Newest scans first with their score and lead count, for the operator page (D-40). */
export async function listScans(db: Db, limit = 200): Promise<ScanListItem[]> {
  const rows = await db.scan.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { report: { select: { overall: true, scorecard: true } }, _count: { select: { leads: true } } },
  });
  return rows.map((s) => {
    let categories: Record<string, number | null> | null = null;
    if (s.report) {
      try {
        categories = (JSON.parse(s.report.scorecard) as Scorecard).categories;
      } catch {
        categories = null;
      }
    }
    return {
      id: s.id,
      url: s.url,
      status: s.status as ScanStatus,
      createdAt: s.createdAt.toISOString(),
      finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
      overall: s.report?.overall ?? null,
      categories,
      leadCount: s._count.leads,
    };
  });
}
