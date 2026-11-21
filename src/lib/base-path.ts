/**
 * Serving Crawlspace under a path of another site, e.g. https://assess.labintelligence.co/agent-check (D-103).
 *
 * `CRAWLSPACE_BASE_PATH` is read at BUILD time (Next's `basePath` is baked into the build) and passed to the client
 * bundle by `env` in next.config.ts, so this module is the single source of truth on both sides. Unset or empty means
 * the app is served at the root exactly as before: `withBasePath("/x")` is then `"/x"`.
 *
 * Next adds the base path by itself to `<Link>`, `router.push`, `redirect()` and its own assets. It does NOT add it to
 * browser requests to "/api/...", plain `<a href>`, `<form action>`, `Location` headers written by route handlers, cookie
 * paths, or absolute URLs built with `new URL(path, req.url)`. Those go through `withBasePath`.
 */
export const BASE_PATH_ENV = "CRAWLSPACE_BASE_PATH";

/** Longest base path accepted. */
export const BASE_PATH_MAX_LENGTH = 64;

// One or more segments; each starts with a letter or digit and holds only letters, digits, "-" and "_".
// So no "//", no "." or ".." segments, no "_next", no trailing slash, nothing that needs URL encoding.
const BASE_PATH_RE = /^(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)+$/;

/**
 * Validate a raw `CRAWLSPACE_BASE_PATH`. Returns "" for unset, empty or whitespace-only; the trimmed value when it is
 * valid; throws otherwise, so `next build` refuses a bad value instead of shipping a broken app.
 */
export function parseBasePath(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  if (v === "") return "";
  if (v.length > BASE_PATH_MAX_LENGTH) throw new Error(`${BASE_PATH_ENV} is longer than ${BASE_PATH_MAX_LENGTH} characters`);
  if (!v.startsWith("/")) throw new Error(`${BASE_PATH_ENV} must start with "/" (for example /agent-check); got ${JSON.stringify(v)}`);
  if (v.endsWith("/")) throw new Error(`${BASE_PATH_ENV} must not end with "/" (use /agent-check, not /agent-check/); got ${JSON.stringify(v)}`);
  if (!BASE_PATH_RE.test(v)) {
    throw new Error(
      `${BASE_PATH_ENV} may contain only "/"-separated segments of letters, digits, "-" and "_", each starting with a letter or digit; got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

/** The base path this build was made with ("" when served at the root). */
export const BASE_PATH: string = parseBasePath(process.env.CRAWLSPACE_BASE_PATH);

/**
 * Prefix an app-root-relative path ("/api/scans", "/scans/abc?pdf=x#pdf-h", "/") with the base path.
 * With no base path the input is returned unchanged. "/" (and "/?…", "/#…") become the base path itself, which is
 * the URL Next serves the home page at ("/agent-check", not "/agent-check/").
 */
export function withBasePath(path: string, basePath: string = BASE_PATH): string {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`withBasePath expects a path that starts with a single "/"; got ${JSON.stringify(path)}`);
  if (!basePath) return path;
  if (path === "/") return basePath;
  if (path.startsWith("/?") || path.startsWith("/#")) return basePath + path.slice(1);
  return basePath + path;
}

/** The `Path=` attribute for cookies the app sets: the base path, or "/" at the root. */
export function cookiePath(basePath: string = BASE_PATH): string {
  return basePath || "/";
}
