/**
 * Cloudflare Worker: serve Crawlspace at a path of another site (D-103, D-106). TEMPLATE, NOT DEPLOYED.
 *
 *   https://assess.labintelligence.co<BASE_PATH>/...  →  <ORIGIN><BASE_PATH>/...   (same path and query)
 *   every other path on the host                      →  untouched (passed to the host's own origin)
 *
 * The Crawlspace build must use the same base path (CRAWLSPACE_BASE_PATH, docs/DEPLOY.md "Serving at a path").
 * Configuration comes from Worker variables, never from this file: ORIGIN (e.g. https://crawlspace.onrender.com) and
 * BASE_PATH (e.g. /agent-check). Neither is a secret. If either is missing or invalid the Worker passes EVERY request
 * through untouched and logs an error, so a misconfiguration can never break the other apps on the host.
 *
 * Self-contained on purpose (no imports), so it can be pasted into the Cloudflare dashboard as one file.
 * Tests: tests/unit/cloudflare-worker.test.ts.
 */

export interface Env {
  ORIGIN?: string;
  BASE_PATH?: string;
}

// Same rule as parseBasePath in src/lib/base-path.ts (the test checks they agree): "/"-separated segments of
// letters, digits, "-" and "_", each starting with a letter or digit; no trailing slash; at most 64 characters.
const BASE_PATH_RE = /^(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)+$/;

export interface ProxyConfig {
  origin: string; // scheme + host (+ port), no path, no trailing slash
  basePath: string;
}

/** The validated configuration, or null when ORIGIN or BASE_PATH is missing or invalid. */
export function readConfig(env: Env): ProxyConfig | null {
  const basePath = (env.BASE_PATH ?? "").trim();
  if (!basePath || basePath.length > 64 || !BASE_PATH_RE.test(basePath)) return null;
  let origin: URL;
  try {
    origin = new URL((env.ORIGIN ?? "").trim());
  } catch {
    return null;
  }
  // https only, and no path, query, fragment or credentials: the path always comes from the visitor's request.
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== "/" && origin.pathname !== "")) return null;
  return { origin: origin.origin, basePath };
}

/** True for the base path itself and anything below it ("/agent-check", "/agent-check/..."), not "/agent-checkout". */
export function matchesBasePath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/**
 * The request to send to the origin, or null when this request is not ours (pass it through untouched).
 * Method, headers and body pass through. X-Forwarded-Host / -Proto say what the visitor asked for.
 * X-Forwarded-For is REPLACED with the address Cloudflare saw (CF-Connecting-IP), so a value the visitor typed never
 * reaches the app's sign-in limiter (docs/DECISIONS.md D-105). Redirects are returned to the browser, not followed.
 */
export function toOriginRequest(request: Request, cfg: ProxyConfig): Request | null {
  const url = new URL(request.url);
  if (!matchesBasePath(url.pathname, cfg.basePath)) return null;
  const target = `${cfg.origin}${url.pathname}${url.search}`;
  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  const client = request.headers.get("CF-Connecting-IP");
  if (client) headers.set("X-Forwarded-For", client);
  else headers.delete("X-Forwarded-For");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: "manual",
    // Needed by runtimes that follow the fetch spec strictly when a stream body is passed (Node); Workers ignore it.
    ...(hasBody ? ({ duplex: "half" } as Record<string, unknown>) : {}),
  });
}

/**
 * Crawlspace sends relative redirects, which the browser resolves against the public host already. A Location that
 * names the origin itself (should not happen) is rewritten to the public host, so visitors never leave the site.
 */
export function rewriteResponse(response: Response, cfg: ProxyConfig, publicOrigin: string): Response {
  const location = response.headers.get("Location");
  if (!location || !location.startsWith(`${cfg.origin}/`)) return response;
  const out = new Response(response.body, response);
  out.headers.set("Location", publicOrigin + location.slice(cfg.origin.length));
  return out;
}

const crawlspaceProxy = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cfg = readConfig(env);
    if (!cfg) {
      console.error("crawlspace proxy: ORIGIN or BASE_PATH is missing or invalid; passing every request through");
      return fetch(request);
    }
    const originRequest = toOriginRequest(request, cfg);
    if (!originRequest) return fetch(request); // not under the base path: the host's own origin answers, unchanged
    return rewriteResponse(await fetch(originRequest), cfg, new URL(request.url).origin);
  },
};

export default crawlspaceProxy;
