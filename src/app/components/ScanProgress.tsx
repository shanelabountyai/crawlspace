"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls the scan until it is done or failed, then re-renders the server page. */
export function ScanProgress({ id, status }: { id: string; status: "queued" | "running" }) {
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

  return (
    <div className="progress" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div>
        <strong>{status === "queued" ? "Waiting for the scanner…" : "Scanning…"}</strong>
        <p>Crawlspace reads up to 15 pages, one request per second, and renders them in a sandboxed browser. This usually takes under a minute.</p>
      </div>
    </div>
  );
}
