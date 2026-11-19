import { clientKey, guardOperator, SHARED_CLIENT, TRUSTED_PROXY_HOPS_ENV, trustedProxyHops } from "@/server/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * For the signed-in operator only: how this request's address reached the app (D-78). It is the way to find out how
 * many proxies the host puts in front (CRAWLSPACE_TRUSTED_PROXY_HOPS) without guessing: `forwardedFor` is the
 * X-Forwarded-For list as received, `countedAs` is the bucket a sign-in attempt from this request would be counted in.
 */
export function GET(req: Request): Response {
  const denied = guardOperator(req);
  if (denied) return denied;
  const forwardedFor = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim().slice(0, 60))
    .filter((e) => e.length > 0)
    .slice(-20);
  const countedAs = clientKey(req);
  return Response.json(
    { setting: TRUSTED_PROXY_HOPS_ENV, trustedProxyHops: trustedProxyHops(), forwardedFor, countedAs, perAddress: countedAs !== SHARED_CLIENT },
    { headers: { "cache-control": "no-store" } },
  );
}
