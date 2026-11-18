"use client";

import { useState, type FormEvent } from "react";

/**
 * The email gate in front of the PDF download (D-35, D-38). The on-screen report above stays free.
 * Without JS the form posts natively and the browser downloads the PDF; errors come back as `?pdf=<message>`.
 */
export function PdfGate({ id, initialError }: { id: string; initialError?: string | null }) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/api/scans/${id}/pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `something went wrong (HTTP ${res.status})`);
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "crawlspace-report.pdf";
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setDone(true);
    } catch {
      setError("could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pdf-gate" aria-labelledby="pdf-h" data-testid="pdf-gate">
      <h2 id="pdf-h">Download this report as a PDF</h2>
      <form method="post" action={`/api/scans/${id}/pdf`} onSubmit={onSubmit}>
        <label htmlFor="pdf-email">Email address</label>
        <div className="scan-form-row">
          <input id="pdf-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required maxLength={254} />
          <button type="submit" disabled={busy}>{busy ? "Preparing…" : "Download PDF"}</button>
        </div>
        <p className="meta fine-print">
          The report above is free either way. Your email is stored with this scan so Lab Intelligence can follow up about it. It is never shown on a public page.
        </p>
        {error ? (
          <p className="form-error" role="alert" data-testid="pdf-error">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="meta" role="status" data-testid="pdf-done">
            Your PDF is downloading.
          </p>
        ) : null}
      </form>
    </section>
  );
}
