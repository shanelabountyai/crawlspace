import { pdfErrorCode } from "@/lib/report/words";
import { getLeadService } from "@/server/scan-service";
import { PUBLIC_MAX_BODY_BYTES, readSmallBody } from "@/server/operator-auth";
import { withBasePath } from "@/lib/base-path";

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
    // At most PUBLIC_MAX_BODY_BYTES is read; a larger body is refused unparsed (review 2026-11-20, SEC-5)
    const bytes = await readSmallBody(req, PUBLIC_MAX_BODY_BYTES);
    if (!bytes) throw new Error("body too large or unreadable");
    const body = new Response(bytes, { headers: { "content-type": req.headers.get("content-type") ?? "" } });
    email = isJson ? ((await body.json()) as { email?: unknown } | null)?.email : (await body.formData()).get("email");
  } catch {
    return Response.json({ error: "could not read the request" }, { status: 400 });
  }
  const pageUri = new URL(withBasePath(`/scans/${encodeURIComponent(id)}`), req.url).toString();
  const r = await (await getLeadService()).requestPdf(id, email, pageUri);
  if (!r.ok) {
    if (isJson || r.status === 404) return Response.json({ error: r.error }, { status: r.status });
    return new Response(null, { status: 303, headers: { location: withBasePath(`/scans/${encodeURIComponent(id)}?pdf=${pdfErrorCode(r.status)}#pdf-h`) } });
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
