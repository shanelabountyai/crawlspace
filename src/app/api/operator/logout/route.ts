import { clearCookie, cookieValue, endAllSessions, isSecure, OPERATOR_COOKIE, operatorConfig, sameOrigin, verifyToken } from "@/server/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out: clear the cookie in this browser and, when the request carries a valid session from this site, end
 * every session (D-79), so a copy of the cookie stops working too. Without a valid session nothing is ended: a
 * stranger cannot sign the operator out.
 */
export async function POST(req: Request): Promise<Response> {
  const cfg = operatorConfig();
  if (sameOrigin(req) && verifyToken(cfg, cookieValue(req.headers.get("cookie"), OPERATOR_COOKIE))) endAllSessions();
  return new Response(null, { status: 303, headers: { location: "/operator", "set-cookie": clearCookie(isSecure(req)) } });
}
