import { checkPassword, clientKey, isSecure, issueToken, loginGate, operatorConfig, sameOrigin, sessionCookie } from "@/server/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (query = "") => ({ status: 303, headers: { location: `/operator${query}` } });

/** Password form → session cookie (D-39). Form posts get redirects; JSON callers get status codes. */
export async function POST(req: Request): Promise<Response> {
  const cfg = operatorConfig();
  if (!cfg.enabled) return Response.json({ error: "not found" }, { status: 404 });
  if (!sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");

  // Count this attempt against its client before anything is awaited (D-76): requests that arrive together each
  // take a place or are refused here, without their password being looked at.
  const ticket = loginGate().enter(clientKey(req));
  if (!ticket.ok) return isJson ? Response.json({ error: "too many attempts; wait 15 minutes" }, { status: 429 }) : new Response(null, back("?error=locked"));

  let password: unknown;
  try {
    password = isJson ? ((await req.json()) as { password?: unknown } | null)?.password : (await req.formData()).get("password");
  } catch {
    ticket.release(); // nothing was checked
    return Response.json({ error: "could not read the request" }, { status: 400 });
  }
  // Under a flood from many addresses this waits its turn (D-77); it resolves at once otherwise and never refuses.
  await ticket.turn();
  if (!checkPassword(cfg, password)) {
    // The place taken above stays counted as this client's wrong password.
    return isJson ? Response.json({ error: "wrong password" }, { status: 401 }) : new Response(null, back("?error=wrong"));
  }
  ticket.release();
  const cookie = sessionCookie(issueToken(cfg), isSecure(req));
  if (isJson) return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
  const init = back();
  return new Response(null, { ...init, headers: { ...init.headers, "set-cookie": cookie } });
}
