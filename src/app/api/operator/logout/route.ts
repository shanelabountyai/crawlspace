import { clearCookie, isSecure } from "@/server/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return new Response(null, { status: 303, headers: { location: "/operator", "set-cookie": clearCookie(isSecure(req)) } });
}
