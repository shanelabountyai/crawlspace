import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandFooter, BrandHeader } from "@/app/components/BrandBar";
import { PdfGate } from "@/app/components/PdfGate";
import { hostOf, plainError } from "@/app/components/present";
import { Report } from "@/app/components/Report";
import { ScanProgress } from "@/app/components/ScanProgress";
import { formatScore } from "@/lib/report/grade";
import { urlErrorText } from "@/lib/report/words";
import { getScanService } from "@/server/scan-service";

export const dynamic = "force-dynamic";
const ROBOTS = { index: false, follow: false };

/** The tab title says the state, so a background tab shows when the report is ready (D-60). */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const scan = await (await getScanService()).store.get(id);
  if (!scan) return { title: "Report not found · Crawlspace", robots: ROBOTS };
  const host = hostOf(scan.url);
  const state = scan.status === "done" ? `Report ready: ${host}` : scan.status === "failed" ? `Scan stopped: ${host}` : `Scanning ${host}…`;
  return { title: `${state} · Crawlspace by Lab Intelligence`, robots: ROBOTS };
}

export default async function ScanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const pdfError = urlErrorText(typeof sp.pdf === "string" ? sp.pdf : null); // fixed sentences only (D-61)
  const scan = await (await getScanService()).store.get(id);
  if (!scan) notFound();
  const failed = scan.status === "failed" ? plainError(scan.error ?? "the scan did not finish") : null;
  // robots.txt saying no is a finding about the site, not an error (Progress.dc.html note, D-62)
  const robots = !!scan.error && /robots\.txt/i.test(scan.error);
  const announce =
    scan.status === "done" && scan.report
      ? `Report ready. Agent-readiness score ${formatScore(scan.report.scorecard.overall)} out of 100.`
      : scan.status === "failed"
        ? "The scan stopped."
        : scan.status === "running"
          ? "Scanning."
          : "Waiting for the scanner.";
  return (
    <>
      <BrandHeader
        action={
          <Link href="/" className="btn btn-secondary">
            Scan another site
          </Link>
        }
      />
      {/* One live region that survives the refresh from progress to report, so the change is announced (D-60). */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="scan-announce">
        {announce}
      </p>
      <main id="main" className="page" data-testid="scan-status" data-status={scan.status}>
        {scan.status === "queued" || scan.status === "running" ? <ScanProgress id={scan.id} status={scan.status} host={hostOf(scan.url)} /> : null}
        {failed ? (
          <section className="stack" aria-labelledby="failed-h">
            <p className="eyebrow">{scan.url}</p>
            <h1 id="failed-h" className="title">
              {robots ? "This site asks crawlers not to read it" : "This scan stopped"}
            </h1>
            <p className={`callout ${robots ? "mid" : "bad"}`} role="alert" data-testid="scan-error">
              <span className="callout-glyph" aria-hidden="true">
                {robots ? "◐" : "✕"}
              </span>
              <span>
                {robots ? <strong>Finding: </strong> : failed.lead ? <strong>{failed.lead} </strong> : null}
                {failed.detail}
              </span>
            </p>
            {robots ? (
              <p className="body-2">That is a finding, not an error: AI agents that obey robots.txt cannot read this site either, so we stopped without reading any page.</p>
            ) : (
              <p className="body-2">Nothing was scored. Check the address and try again, or scan another site.</p>
            )}
            <p>
              <Link href="/" className="btn btn-primary">
                Scan another site
              </Link>
            </p>
          </section>
        ) : null}
        {scan.status === "done" && scan.report ? (
          // The PDF panel sits just after "Fix these first" (review 2026-11-20 rank 9, Decision 4b, D-102).
          <Report report={scan.report} scannedAt={scan.report.scorecard.fetchedAt} afterFixes={<PdfGate id={scan.id} initialError={pdfError} />} />
        ) : null}
      </main>
      <BrandFooter />
    </>
  );
}
