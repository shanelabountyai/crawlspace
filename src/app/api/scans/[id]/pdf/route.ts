import { pdfErrorCode } from "@/lib/report/words";
import { getLeadService } from "@/server/scan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The email gate (D-35, D-38): `{ email }` as JSON or a form post → the report PDF as a download.
 * There is no GET: the public PDF always goes through this gate (the operator has its own route).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let email: unknown;
  try {
    email = isJson ? ((await req.json()) as { email?: unknown } | null)?.email : (await req.formData()).get("email");
  } catch {
    return Response.json({ error: "could not read the request" }, { status: 400 });
  }
  const pageUri = new URL(`/scans/${encodeURIComponent(id)}`, req.url).toString();
  const r = await (await getLeadService()).requestPdf(id, email, pageUri);
  if (!r.ok) {
    if (isJson || r.status === 404) return Response.json({ error: r.error }, { status: r.status });
    return new Response(null, { status: 303, headers: { location: `/scans/${encodeURIComponent(id)}?pdf=${pdfErrorCode(r.status)}#pdf-h` } });
  }
  return new Response(Buffer.from(r.pdf.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${r.pdf.fileName}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
