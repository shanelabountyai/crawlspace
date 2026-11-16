import { getScanService } from "@/server/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const view = await (await getScanService()).store.get(id);
  if (!view) return Response.json({ error: "no such scan" }, { status: 404 });
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
