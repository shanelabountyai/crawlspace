import { guardOperator } from "@/server/operator-auth";
import { getScanService } from "@/server/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rerun = a new scan of the same URL through the normal submit path (SSRF guard, queue limit); the old one is kept (D-40). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardOperator(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const svc = await getScanService();
  const old = await svc.store.get(id);
  if (!old) return Response.json({ error: "no such scan" }, { status: 404 });
  const r = await svc.submit(old.url);
  const isJson = (req.headers.get("accept") ?? "").includes("application/json");
  if (!r.ok) return isJson ? Response.json({ error: r.error }, { status: r.status }) : new Response(null, { status: 303, headers: { location: `/operator?error=${encodeURIComponent(r.error)}` } });
  return isJson ? Response.json({ id: r.id, url: r.url }, { status: 201 }) : new Response(null, { status: 303, headers: { location: `/operator?rerun=${r.id}` } });
}
