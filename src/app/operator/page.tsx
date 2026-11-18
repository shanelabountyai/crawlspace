import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { BrandHeader } from "@/app/components/BrandBar";
import { formatWhen, plainError } from "@/app/components/present";
import { CATEGORIES, type Category } from "@/lib/checks/types";
import { formatOutOf100, letterFor } from "@/lib/report/grade";
import { getDb } from "@/server/db";
import { OPERATOR_COOKIE, operatorConfig, verifyToken } from "@/server/operator-auth";
import { getLeadService } from "@/server/scan-service";
import { listScans } from "@/server/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operator · Crawlspace", robots: { index: false, follow: false } };

const CATS = Object.keys(CATEGORIES) as Category[];
const ERRORS: Record<string, { lead: string; detail: string }> = {
  wrong: { lead: "Wrong password.", detail: "Try again." },
  locked: { lead: "Too many wrong passwords.", detail: "Wait 15 minutes and try again." },
};
const SCAN_STATUS = {
  queued: { word: "Waiting", glyph: "○", tone: "na" },
  running: { word: "Running", glyph: "●", tone: "run" },
  done: { word: "Done", glyph: "✓", tone: "pass" },
  failed: { word: "Failed", glyph: "✕", tone: "fail" },
} as const;
const HUBSPOT = {
  off: { word: "Off", glyph: "–", tone: "na" },
  sent: { word: "Sent", glyph: "✓", tone: "pass" },
  failed: { word: "Failed", glyph: "✕", tone: "fail" },
} as const;

function Pill({ s }: { s: { word: string; glyph: string; tone: string } }) {
  return (
    <span className={`pill tone-${s.tone}`}>
      <span aria-hidden="true">{s.glyph}</span>
      {s.word}
    </span>
  );
}

/** Operator page (PRD §2; D-39, D-40; Operator.dc.html and OperatorSignIn.dc.html). */
export default async function OperatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : null);
  const cfg = operatorConfig();

  if (!cfg.enabled) {
    return (
      <>
        <BrandHeader trail="Operator" />
        <main id="main" className="page narrow" data-testid="operator-disabled">
          <section className="card signin-card" aria-labelledby="off-h">
            <h1 id="off-h" className="title">
              Operator page turned off
            </h1>
            <p className="body-2">
              Set <code className="inline-code">CRAWLSPACE_OPERATOR_PASSWORD</code> (at least 12 characters) and restart to use it.
            </p>
          </section>
        </main>
      </>
    );
  }

  const token = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!verifyToken(cfg, token)) {
    const code = param("error");
    const err = code ? (ERRORS[code] ?? { lead: "Could not sign in.", detail: "" }) : null;
    return (
      <>
        <BrandHeader trail="Operator" />
        <main id="main" className="page narrow" data-testid="operator-login">
          <section className="card signin-card" aria-labelledby="si-h">
            <h1 id="si-h" className="title">
              Operator sign-in
            </h1>
            <p className="body-2">For the site owner only. There are no accounts: the password is set on the server.</p>
            <form method="post" action="/api/operator/login" className="field">
              <label htmlFor="op-password" className="field-label">
                Password
              </label>
              <div className="field-row">
                <input
                  id="op-password"
                  className="input"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? "op-error" : undefined}
                />
                <button type="submit" className="btn btn-primary btn-lg">
                  Sign in
                </button>
              </div>
            </form>
            {err ? (
              <p className="callout bad form-error" role="alert" id="op-error">
                <span className="callout-glyph" aria-hidden="true">
                  ✕
                </span>
                <span>
                  <strong>{err.lead}</strong> {err.detail}
                </span>
              </p>
            ) : null}
          </section>
        </main>
      </>
    );
  }

  const leadSvc = await getLeadService();
  const [scans, leads] = await Promise.all([listScans(getDb()), leadSvc.leads.list(50)]);
  const rerun = param("rerun");
  const error = param("error");
  const errMsg = error ? plainError(error) : null;
  return (
    <>
      <BrandHeader
        trail="Operator"
        action={
          <form method="post" action="/api/operator/logout">
            <button type="submit" className="btn btn-secondary">
              Sign out
            </button>
          </form>
        }
      />
      <main id="main" className="page" data-testid="operator">
        <div className="op-head">
          <div className="stack-sm">
            <h1 className="title">Submitted scans</h1>
            <p className="eyebrow">
              {scans.length} scan{scans.length === 1 ? "" : "s"}, newest first (up to 200) · HubSpot lead capture: <strong>{leadSvc.hubspotEnabled ? "on" : "off"}</strong>
            </p>
          </div>
          <div className="op-actions">
            <a className="btn btn-primary" href="/api/operator/export/scans" download>
              Export scans (CSV)
            </a>
            <a className="btn btn-secondary" href="/api/operator/export/leads" download>
              Export leads (CSV)
            </a>
          </div>
        </div>
        {rerun ? (
          <p className="callout good" role="status" data-testid="rerun-notice">
            <span className="callout-glyph" aria-hidden="true">
              ✓
            </span>
            <span>
              <strong>Rerun queued.</strong> The old scan is kept. <Link href={`/scans/${encodeURIComponent(rerun)}`}>Open the new scan</Link>
            </span>
          </p>
        ) : null}
        {errMsg ? (
          <p className="callout bad" role="alert">
            <span className="callout-glyph" aria-hidden="true">
              ✕
            </span>
            <span>
              {errMsg.lead ? <strong>{errMsg.lead} </strong> : null}
              {errMsg.detail}
            </span>
          </p>
        ) : null}

        <section aria-labelledby="scans-h" className="stack">
          <h2 id="scans-h" className="section-title">
            Scans
          </h2>
          {scans.length === 0 ? (
            <p className="meta">No scans yet. Scans appear here as visitors submit them.</p>
          ) : (
            <div className="table-wrap">
              <table className="data op-table" data-testid="operator-scans">
                <thead>
                  <tr>
                    <th scope="col">Created</th>
                    <th scope="col">Site</th>
                    <th scope="col">Status</th>
                    <th scope="col">Score</th>
                    <th scope="col">Grades</th>
                    <th scope="col">Leads</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr key={s.id} data-scan={s.id} data-status={s.status}>
                      <td className="nowrap">{formatWhen(s.createdAt)}</td>
                      <td>
                        <code>{s.url}</code>
                      </td>
                      <td>
                        <Pill s={SCAN_STATUS[s.status]} />
                      </td>
                      <td className="nowrap">
                        <strong>{s.status === "done" ? formatOutOf100(s.overall) : ""}</strong>
                      </td>
                      <td className="grades">{s.categories ? CATS.map((c) => `${c}:${letterFor(s.categories![c] ?? null)}`).join(" ") : ""}</td>
                      <td data-testid="lead-count">{s.leadCount}</td>
                      <td className="actions-cell">
                        <div className="actions">
                          <Link href={`/scans/${s.id}`} aria-label={`Report for ${s.url}`}>
                            Report
                          </Link>
                          {s.status === "done" ? (
                            <a href={`/api/operator/scans/${s.id}/pdf`} download aria-label={`PDF for ${s.url}`}>
                              PDF
                            </a>
                          ) : null}
                          <form method="post" action={`/api/operator/scans/${s.id}/rerun`}>
                            <button type="submit" className="btn btn-secondary">
                              Rerun
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="leads-h" className="stack">
          <h2 id="leads-h" className="section-title">
            Latest leads
          </h2>
          {leads.length === 0 ? (
            <p className="meta">No emails yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data op-table" data-testid="operator-leads">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Email</th>
                    <th scope="col">Scan</th>
                    <th scope="col">HubSpot</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap">{formatWhen(l.createdAt)}</td>
                      <td>{l.email}</td>
                      <td>
                        <Link href={`/scans/${l.scanId}`}>{l.scanUrl}</Link>
                      </td>
                      <td>
                        <Pill s={HUBSPOT[l.hubspotStatus] ?? HUBSPOT.off} />
                        {l.hubspotError ? <span className="meta"> {l.hubspotError}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
