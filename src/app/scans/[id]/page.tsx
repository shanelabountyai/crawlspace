import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandFooter, BrandHeader } from "@/app/components/BrandBar";
import { PdfGate } from "@/app/components/PdfGate";
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
  return (
    <>
      <BrandHeader />
      <main className="page">
        <p className="back">
          <Link href="/">← New scan</Link>
        </p>
        <h1>
          Agent-readiness report <span className="muted">for {scan.url}</span>
        </h1>
        <div data-testid="scan-status" data-status={scan.status}>
          {scan.status === "queued" || scan.status === "running" ? <ScanProgress id={scan.id} status={scan.status} /> : null}
          {scan.status === "failed" ? (
            <div className="notice error" role="alert" data-testid="scan-error">
              <strong>This scan did not finish.</strong> {scan.error}
            </div>
          ) : null}
          {scan.status === "done" && scan.report ? (
            <>
              <Report report={scan.report} scannedAt={scan.report.scorecard.fetchedAt} />
              <PdfGate id={scan.id} initialError={pdfError} />
            </>
          ) : null}
        </div>
      </main>
      <BrandFooter />
    </>
  );
}
