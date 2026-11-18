import { CATEGORIES, type Category } from "@/lib/checks/types";
import { letterFor } from "@/lib/report/grade";
import { csvResponse, toCsv } from "@/server/csv";
import { getDb } from "@/server/db";
import { guardOperator } from "@/server/operator-auth";
import { getLeadService } from "@/server/scan-service";
import { listScans } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATS = Object.keys(CATEGORIES) as Category[];

/** CSV exports for the operator (D-40): `scans` or `leads`. */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }): Promise<Response> {
  const denied = guardOperator(req);
  if (denied) return denied;
  const { kind } = await ctx.params;
  const day = new Date().toISOString().slice(0, 10);
  if (kind === "scans") {
    const scans = await listScans(getDb(), 10_000);
    const header = ["scan_id", "url", "status", "created_at", "finished_at", "overall_out_of_100", ...CATS.flatMap((c) => [`${c}_score`, `${c}_grade`]), "lead_count"];
    const rows = scans.map((s) => [s.id, s.url, s.status, s.createdAt, s.finishedAt, s.overall, ...CATS.flatMap((c): unknown[] => (s.categories ? [s.categories[c], letterFor(s.categories[c] ?? null)] : ["", ""])), s.leadCount]);
    return csvResponse(toCsv(header, rows), `crawlspace-scans-${day}.csv`);
  }
  if (kind === "leads") {
    const leads = await (await getLeadService()).leads.list(100_000);
    const rows = leads.map((l) => [l.createdAt, l.email, l.scanUrl, l.scanId, l.hubspotStatus, l.hubspotError]);
    return csvResponse(toCsv(["created_at", "email", "scan_url", "scan_id", "hubspot_status", "hubspot_error"], rows), `crawlspace-leads-${day}.csv`);
  }
  return Response.json({ error: "unknown export" }, { status: 404 });
}
