export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness check for the host (Render `healthCheckPath`, the Docker job in CI): 200 and a small fixed JSON body.
 * It answers "the web process is up and serving". It never opens the database and never starts a scan (D-69).
 */
export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
