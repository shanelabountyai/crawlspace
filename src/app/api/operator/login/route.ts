import { checkPassword, clientKey, isSecure, issueToken, loginGate, operatorConfig, readSmallBody, sameOrigin, sessionCookie } from "@/server/operator-auth";
import { withBasePath } from "@/lib/base-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (query = "") => ({ status: 303, headers: { location: withBasePath(`/operator${query}`) } });

/** Password form → session cookie (D-39). Form posts get redirects; JSON callers get status codes. */
export async function POST(req: Request): Promise<Response> {
  const cfg = operatorConfig();
  if (!cfg.enabled) return Response.json({ error: "not found" }, { status: 404 });
  if (!sameOrigin(req)) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  const contentType = req.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const locked = () => (isJson ? Response.json({ error: "too many attempts; wait 15 minutes" }, { status: 429 }) : new Response(null, back("?error=locked")));
  const unreadable = () => Response.json({ error: "could not read the request" }, { status: 400 });

  const gate = loginGate();
  const client = clientKey(req);
  // An address that has used up its wrong passwords is refused before its body is read. This is a shortcut only:
  // the check that counts is inside `gate.attempt` below.
  if (gate.blocked(client)) return locked();

  const bytes = await readSmallBody(req);
  if (!bytes) return unreadable();
  let password: unknown;
  try {
    const body = new Response(bytes, { headers: { "content-type": contentType } });
    password = isJson ? ((await body.json()) as { password?: unknown } | null)?.password : (await body.formData()).get("password");
  } catch {
    return unreadable();
  }

  // At once normally; under a flood of wrong passwords from many addresses this waits for its turn (D-77).
  const pass = await gate.turn(client);
  if (!pass) return isJson ? Response.json({ error: "sign-in is busy; try again in a minute" }, { status: 429 }) : new Response(null, back("?error=busy"));
  // One synchronous step (D-76): refuse a full address unchecked, else compare, and count a wrong password.
  const outcome = gate.attempt(pass, () => checkPassword(cfg, password));
  if (outcome === "locked") return locked();
  if (outcome === "wrong") return isJson ? Response.json({ error: "wrong password" }, { status: 401 }) : new Response(null, back("?error=wrong"));

  const cookie = sessionCookie(issueToken(cfg), isSecure(req));
  if (isJson) return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
  const init = back();
  return new Response(null, { ...init, headers: { ...init.headers, "set-cookie": cookie } });
}
