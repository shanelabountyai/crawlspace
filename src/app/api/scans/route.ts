import { scanErrorCode } from "@/lib/report/words";
import { getScanService } from "@/server/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a scan. JSON `{ "url": "…" }` → 201 `{ id, url }` (errors as JSON, unchanged); a plain form post (no JS) → 303 to
 * the report page, or back to the form with an error code (D-61).
 */
export async function POST(req: Request): Promise<Response> {
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let url: unknown;
  try {
    url = isJson ? ((await req.json()) as { url?: unknown } | null)?.url : (await req.formData()).get("url");
  } catch {
    return Response.json({ error: "could not read the request" }, { status: 400 });
  }
  const svc = await getScanService();
  const r = await svc.submit(url);
  if (!r.ok) {
    if (!isJson) return new Response(null, { status: 303, headers: { location: `/?error=${scanErrorCode(r.status, r.error)}#url` } });
    return Response.json({ error: r.error }, { status: r.status });
  }
  if (!isJson) return new Response(null, { status: 303, headers: { location: `/scans/${r.id}` } });
  return Response.json({ id: r.id, url: r.url }, { status: 201 });
}
