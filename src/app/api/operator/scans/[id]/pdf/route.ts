import { scanPdf } from "@/server/lead-service";
import { guardOperator } from "@/server/operator-auth";
import { getScanService } from "@/server/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The operator's PDF of any finished scan, no email gate (D-40). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = guardOperator(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const pdf = await scanPdf((await getScanService()).store, id);
  if (!pdf) return Response.json({ error: "no finished report for that scan" }, { status: 404 });
  return new Response(Buffer.from(pdf.bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pdf.fileName}"`, "cache-control": "no-store" },
  });
}
