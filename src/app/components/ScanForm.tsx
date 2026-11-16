"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ScanForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = String(new FormData(e.currentTarget).get("url") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
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

  return (
    <form className="scan-form" method="post" action="/api/scans" onSubmit={onSubmit} noValidate>
      <label htmlFor="url">Website address</label>
      <div className="scan-form-row">
        <input id="url" name="url" type="text" inputMode="url" autoComplete="url" placeholder="yourshop.com" required spellCheck={false} />
        <button type="submit" disabled={busy}>{busy ? "Starting…" : "Scan site"}</button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
