import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandFooter, BrandHeader } from "@/app/components/BrandBar";
import { PdfGate } from "@/app/components/PdfGate";
import { hostOf, plainError } from "@/app/components/present";
import { Report } from "@/app/components/Report";
import { ScanProgress } from "@/app/components/ScanProgress";
import { getScanService } from "@/server/scan-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scan report · Crawlspace by Lab Intelligence", robots: { index: false, follow: false } };

export default async function ScanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const pdfError = typeof sp.pdf === "string" ? sp.pdf.slice(0, 200) : null;
  const scan = await (await getScanService()).store.get(id);
  if (!scan) notFound();
  const failed = scan.status === "failed" ? plainError(scan.error ?? "the scan did not finish") : null;
  return (
    <>
      <BrandHeader
        action={
          <Link href="/" className="btn btn-secondary">
            Scan another site
          </Link>
        }
      />
      <main id="main" className="page" data-testid="scan-status" data-status={scan.status}>
        {scan.status === "queued" || scan.status === "running" ? <ScanProgress id={scan.id} status={scan.status} host={hostOf(scan.url)} /> : null}
        {failed ? (
          <section className="stack" aria-labelledby="failed-h">
            <p className="eyebrow">{scan.url}</p>
            <h1 id="failed-h" className="title">
              This scan stopped
            </h1>
            <p className="callout bad" role="alert" data-testid="scan-error">
              <span className="callout-glyph" aria-hidden="true">
                ✕
              </span>
              <span>
                {failed.lead ? <strong>{failed.lead} </strong> : null}
                {failed.detail}
              </span>
            </p>
            <p className="body-2">If robots.txt blocks CrawlspaceBot, that is a finding, not an error: agents that obey robots.txt cannot read this site either.</p>
            <p>
              <Link href="/" className="btn btn-primary">
                Scan another site
              </Link>
            </p>
          </section>
        ) : null}
        {scan.status === "done" && scan.report ? (
          <>
            <Report report={scan.report} scannedAt={scan.report.scorecard.fetchedAt} />
            <PdfGate id={scan.id} initialError={pdfError} />
          </>
        ) : null}
      </main>
      <BrandFooter />
    </>
  );
}
