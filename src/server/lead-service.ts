import { pdfFileName, renderReportPdf } from "@/lib/report/pdf";
import { hubspotFromEnv, type LeadSink } from "./hubspot";
import { LeadStore, type LeadView, type ScanStore } from "./store";

/** Gate submissions accepted per scan per hour (D-38). */
export const LEADS_PER_SCAN_PER_HOUR = 10;
export const MAX_EMAIL_LENGTH = 254;
// Syntax check only (no double opt-in in v1, D-38): local@domain.tld, no spaces, one @.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const e = input.trim();
  if (!e || e.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(e)) return null;
  const at = e.lastIndexOf("@");
  return `${e.slice(0, at)}@${e.slice(at + 1).toLowerCase()}`;
}

export interface PdfFile {
  bytes: Uint8Array;
  fileName: string;
}

export type GateResult = { ok: true; lead: LeadView; pdf: PdfFile } | { ok: false; status: 400 | 404 | 409 | 429; error: string };

/** Build the PDF of a finished scan; null when the scan is unknown or has no report. */
export async function scanPdf(scans: ScanStore, id: string): Promise<PdfFile | null> {
  const scan = await scans.get(id);
  if (!scan || scan.status !== "done" || !scan.report) return null;
  const r = scan.report;
  const bytes = await renderReportPdf({ finalUrl: r.finalUrl, scorecard: r.scorecard, fixList: r.fixList, crawl: r.crawl });
  return { bytes, fileName: pdfFileName(r.finalUrl, r.scorecard.fetchedAt) };
}

/**
 * The email gate in front of the PDF (D-35, D-36, D-38): validate, store the lead locally, optionally submit it to
 * HubSpot (flag off by default; a failure is recorded on the lead and never blocks the PDF), then return the PDF.
 */
export class LeadService {
  constructor(
    readonly scans: ScanStore,
    readonly leads: LeadStore,
    private readonly sink: LeadSink | null = hubspotFromEnv(),
    private readonly now: () => Date = () => new Date(),
    private readonly perHour = LEADS_PER_SCAN_PER_HOUR,
  ) {}

  get hubspotEnabled(): boolean {
    return this.sink !== null;
  }

  async requestPdf(scanId: string, rawEmail: unknown, pageUri: string): Promise<GateResult> {
    const email = normaliseEmail(rawEmail);
    if (!email) return { ok: false, status: 400, error: "enter a valid email address to download the PDF" };
    const scan = await this.scans.get(scanId);
    if (!scan) return { ok: false, status: 404, error: "no such scan" };
    if (scan.status !== "done" || !scan.report) return { ok: false, status: 409, error: "this scan has not finished, so there is no report to download yet" };
    const since = new Date(this.now().getTime() - 3_600_000);
    if ((await this.leads.countSince(scanId, since)) >= this.perHour) return { ok: false, status: 429, error: "too many download requests for this report; try again later" };

    const lead = await this.leads.create(scanId, email);
    if (this.sink) {
      const r = await this.sink.submit(email, { pageUri, pageName: `Crawlspace report: ${scan.url}` });
      if (r.status === "sent") {
        await this.leads.setHubSpot(lead.id, "sent");
        lead.hubspotStatus = "sent";
      } else {
        await this.leads.setHubSpot(lead.id, "failed", r.error);
        lead.hubspotStatus = "failed";
        lead.hubspotError = r.error;
      }
    }
    const pdf = await scanPdf(this.scans, scanId);
    if (!pdf) return { ok: false, status: 409, error: "this scan has no report to download" };
    return { ok: true, lead, pdf };
  }
}
