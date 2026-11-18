import { checkPassword, isSecure, issueToken, loginLimiter, operatorConfig, sameOrigin, sessionCookie } from "@/server/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (query = "") => ({ status: 303, headers: { location: `/operator${query}` } });

/** Password form → session cookie (D-39). Form posts get redirects; JSON callers get status codes. */
export async function POST(req: Request): Promise<Response> {
  const cfg = operatorConfig();
  if (!cfg.enabled) return Response.json({ error: "not found" }, { status: 404 });
  if (!sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const limiter = loginLimiter();
  if (limiter.blocked()) return isJson ? Response.json({ error: "too many attempts; wait 15 minutes" }, { status: 429 }) : new Response(null, back("?error=locked"));
  let password: unknown;
  try {
    password = isJson ? ((await req.json()) as { password?: unknown } | null)?.password : (await req.formData()).get("password");
  } catch {
    return Response.json({ error: "could not read the request" }, { status: 400 });
  }
  if (!checkPassword(cfg, password)) {
    limiter.fail();
    return isJson ? Response.json({ error: "wrong password" }, { status: 401 }) : new Response(null, back("?error=wrong"));
  }
  const cookie = sessionCookie(issueToken(cfg), isSecure(req));
  if (isJson) return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
  const init = back();
  return new Response(null, { ...init, headers: { ...init.headers, "set-cookie": cookie } });
}
