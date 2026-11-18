import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { BrandHeader } from "@/app/components/BrandBar";
import { CATEGORIES, type Category } from "@/lib/checks/types";
import { formatOutOf100, letterFor } from "@/lib/report/grade";
import { getDb } from "@/server/db";
import { OPERATOR_COOKIE, operatorConfig, verifyToken } from "@/server/operator-auth";
import { getLeadService } from "@/server/scan-service";
import { listScans } from "@/server/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operator · Crawlspace", robots: { index: false, follow: false } };

const CATS = Object.keys(CATEGORIES) as Category[];
const ERRORS: Record<string, string> = { wrong: "Wrong password.", locked: "Too many wrong passwords. Wait 15 minutes and try again." };
const when = (iso: string | null) => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "");

/** Operator page (PRD §2: see submitted scans, rerun, export; password env var, no accounts; D-39, D-40). */
export default async function OperatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : null);
  const cfg = operatorConfig();

  if (!cfg.enabled) {
    return (
      <main className="page narrow op" data-testid="operator-disabled">
        <h1>Operator</h1>
        <p>The operator page is turned off. Set <code>CRAWLSPACE_OPERATOR_PASSWORD</code> (at least 12 characters) and restart to use it.</p>
      </main>
    );
  }

  const token = (await cookies()).get(OPERATOR_COOKIE)?.value;
  if (!verifyToken(cfg, token)) {
    const err = param("error");
    return (
      <>
        <BrandHeader />
        <main className="page narrow op op-login" data-testid="operator-login">
          <h1>Operator sign-in</h1>
          <form method="post" action="/api/operator/login">
            <label htmlFor="op-password">Password</label>
            <div className="scan-form-row">
              <input id="op-password" name="password" type="password" autoComplete="current-password" required />
              <button type="submit">Sign in</button>
            </div>
          </form>
          {err ? (
            <p className="form-error" role="alert">
              {ERRORS[err] ?? "Could not sign in."}
            </p>
          ) : null}
        </main>
      </>
    );
  }

  const leadSvc = await getLeadService();
  const [scans, leads] = await Promise.all([listScans(getDb()), leadSvc.leads.list(50)]);
  const rerun = param("rerun");
  const error = param("error");
  return (
    <>
      <BrandHeader />
      <main className="page op" data-testid="operator">
        <h1>Operator</h1>
        <div className="toolbar">
          <a className="button small" href="/api/operator/export/scans" download>
            Export scans (CSV)
          </a>
          <a className="button small" href="/api/operator/export/leads" download>
            Export leads (CSV)
          </a>
          <span className="meta">HubSpot lead capture: {leadSvc.hubspotEnabled ? "on" : "off"}</span>
          <form method="post" action="/api/operator/logout">
            <button type="submit" className="small secondary">
              Sign out
            </button>
          </form>
        </div>
        {rerun ? (
          <p className="notice" role="status" data-testid="rerun-notice">
            Rerun queued: <Link href={`/scans/${rerun}`}>open the new scan</Link>.
          </p>
        ) : null}
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}

        <h2>Scans ({scans.length})</h2>
        <div className="table-wrap">
          <table data-testid="operator-scans">
            <thead>
              <tr>
                <th scope="col">Created</th>
                <th scope="col">URL</th>
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
                  <td>{when(s.createdAt)}</td>
                  <td className="url">{s.url}</td>
                  <td>{s.status}</td>
                  <td>{s.status === "done" ? formatOutOf100(s.overall) : ""}</td>
                  <td>{s.categories ? CATS.map((c) => `${c}:${letterFor(s.categories![c] ?? null)}`).join(" ") : ""}</td>
                  <td data-testid="lead-count">{s.leadCount}</td>
                  <td>
                    <div className="actions">
                      <Link href={`/scans/${s.id}`}>report</Link>
                      {s.status === "done" ? (
                        <a href={`/api/operator/scans/${s.id}/pdf`} download>
                          PDF
                        </a>
                      ) : null}
                      <form method="post" action={`/api/operator/scans/${s.id}/rerun`}>
                        <button type="submit" className="small secondary">
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

        <h2>Latest leads</h2>
        {leads.length === 0 ? (
          <p className="meta">No emails yet.</p>
        ) : (
          <div className="table-wrap">
            <table data-testid="operator-leads">
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
                    <td>{when(l.createdAt)}</td>
                    <td>{l.email}</td>
                    <td className="url">
                      <Link href={`/scans/${l.scanId}`}>{l.scanUrl}</Link>
                    </td>
                    <td title={l.hubspotError ?? undefined}>{l.hubspotStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
