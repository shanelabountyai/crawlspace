"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { plainError } from "./present";
import { withBasePath } from "@/lib/base-path";

/** Scan form (Form.dc.html, PhoneForm.dc.html). Posts natively without JS; with JS shows refusals in place. */
export function ScanForm({ initialError }: { initialError?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return; // aria-disabled, not disabled, so keyboard focus stays on the button (D-63)
    const url = String(new FormData(e.currentTarget).get("url") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/scans"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? `something went wrong (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      router.push(`/scans/${data.id}`);
    } catch {
      setError("could not reach the scanner");
      setBusy(false);
    }
  }

  const msg = error ? plainError(error) : null;
  return (
    <form className="scan-form" method="post" action={withBasePath("/api/scans")} onSubmit={onSubmit} noValidate aria-describedby={msg ? "scan-error" : undefined}>
      <div className="field">
        <label htmlFor="url" className="field-label">
          Website address
        </label>
        <div className="field-row">
          <input
            id="url"
            className="input"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="yourstore.com"
            required
            spellCheck={false}
            aria-invalid={msg ? true : undefined}
            autoFocus={!!initialError}
            aria-describedby={msg ? "scan-error" : undefined}
          />
          <button type="submit" className="btn btn-primary btn-lg" aria-disabled={busy || undefined}>
            {busy ? "Starting…" : "Scan my site"}
          </button>
        </div>
      </div>
      {msg ? (
        <p className="callout bad form-error" role="alert" id="scan-error">
          <span className="callout-glyph" aria-hidden="true">
            ✕
          </span>
          <span>
            {msg.lead ? <strong>{msg.lead} </strong> : null}
            {msg.detail}
          </span>
        </p>
      ) : null}
    </form>
  );
}
