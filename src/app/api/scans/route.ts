import { getScanService } from "@/server/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a scan. JSON `{ "url": "…" }` → 201 `{ id, url }`; a plain form post (no JS) → 303 to the report page. */
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
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  if (!isJson) return new Response(null, { status: 303, headers: { location: `/scans/${r.id}` } });
  return Response.json({ id: r.id, url: r.url }, { status: 201 });
}
