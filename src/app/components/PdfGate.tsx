"use client";

import { useState, type FormEvent } from "react";
import { plainError } from "./present";

/**
 * The email gate in front of the PDF download (D-35, D-38; LeadStates.dc.html). The on-screen report stays free.
 * Without JS the form posts natively and the browser downloads the PDF; errors come back as `?pdf=<message>`.
 */
export function PdfGate({ id, initialError }: { id: string; initialError?: string | null }) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return; // aria-disabled keeps focus on the button (D-63)
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

  const msg = error ? plainError(error) : null;
  const invalid = !!error && /email/i.test(error);
  return (
    <section className="pdf-panel" aria-labelledby="pdf-h" data-testid="pdf-gate">
      <div className="pdf-copy">
        <h2 id="pdf-h">Take this report to your team</h2>
        <p>The report above is free either way. Leave your email to download the full PDF, with every check and its evidence, ready to forward to your developer.</p>
      </div>
      <form className="pdf-form" method="post" action={`/api/scans/${id}/pdf`} onSubmit={onSubmit} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pdf-email" className="field-label">
              Work email
            </label>
            <input
              id="pdf-email"
              className="input"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              maxLength={254}
              aria-invalid={invalid ? true : undefined}
              autoFocus={!!initialError}
              aria-describedby={msg ? "pdf-note pdf-error" : "pdf-note"}
            />
          </div>
          <button type="submit" className="btn" aria-disabled={busy || undefined}>
            {busy ? "Preparing…" : "Download PDF"}
          </button>
        </div>
        {msg ? (
          <p className="pdf-msg bad form-error" role="alert" id="pdf-error" data-testid="pdf-error">
            <span aria-hidden="true">✕</span>
            <span>
              <strong>{invalid ? "Check the address." : "Not now."}</strong> {msg.detail}
            </span>
          </p>
        ) : null}
        <div role="status">
          {done ? (
            <p className="pdf-msg good" data-testid="pdf-done">
              <span aria-hidden="true">✓</span>
              <span>
                <strong>Done.</strong> Your PDF is downloading.
              </span>
            </p>
          ) : null}
        </div>
        <p className="pdf-note" id="pdf-note">
          Your email is stored with this scan so Lab Intelligence can follow up about it. It is never shown on a public page.
        </p>
      </form>
    </section>
  );
}
