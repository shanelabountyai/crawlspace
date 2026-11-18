"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Scan progress (Progress.dc.html, ScanOutcomes.dc.html). Polls the scan until it is done or failed, then re-renders
 * the server page. The app does not record pages while a scan runs (D-29), so the bar is indeterminate (D-50).
 */
export function ScanProgress({ id, status, host }: { id: string; status: "queued" | "running"; host: string }) {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/scans/${id}`, { cache: "no-store" });
        const data = (await res.json()) as { status?: string };
        if (data.status && data.status !== status) {
          router.refresh();
          return;
        }
      } catch {
        // keep polling
      }
      if (!stop) timer = setTimeout(tick, 1500);
    };
    let timer = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, status, router]);

  const queued = status === "queued";
  return (
    <section className="stack" aria-labelledby="progress-h" data-testid="scan-progress">
      <p className="eyebrow">Scanning {host}</p>
      <h1 id="progress-h" className="title">
        {queued ? "Waiting for the scanner" : "Reading your site"}
      </h1>
      <div role="status" aria-live="polite" className="stack-sm">
        <p className="body-2">
          {queued
            ? "One scan runs at a time. Yours starts as soon as the one ahead finishes; this page updates by itself."
            : "We read up to 15 pages, one a second, so we never slow your site down. This usually takes under a minute; you can keep this tab in the background."}
        </p>
      </div>
      <div className="progress-track" role="progressbar" aria-label="Scan progress" aria-valuetext={queued ? "Waiting" : "Reading pages"}>
        <span className="progress-bar" />
      </div>
      <p className="meta">If robots.txt blocks CrawlspaceBot, we stop and show that as a result. It&apos;s a finding, not an error.</p>
    </section>
  );
}
