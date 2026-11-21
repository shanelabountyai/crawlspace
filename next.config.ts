import type { NextConfig } from "next";
import { parseBasePath } from "./src/lib/base-path";

// Opt-in: serve the app under a path of another site, e.g. CRAWLSPACE_BASE_PATH=/agent-check (D-103). Read at build
// time; unset or empty = served at the root exactly as before. A bad value throws here, so `next build` refuses it.
const basePath = parseBasePath(process.env.CRAWLSPACE_BASE_PATH);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Only set when a base path is given, so the unset build is the same config as before.
  ...(basePath ? { basePath } : {}),
  // The same value for src/lib/base-path.ts in the browser bundle (fetch, form actions, plain links) and the server.
  env: { CRAWLSPACE_BASE_PATH: basePath },
  // Native / browser-driving packages stay out of the server bundle.
  // Metadata is sent with the page, never streamed in afterwards (Next's documented switch for turning streaming
  // metadata off). With streaming, a client-side refresh showed the new page for up to ~300 ms with no <title> at
  // all: the report was on screen while the tab had no name (D-75; caught by axe "document-title" in e2e/a11y.spec.ts).
  htmlLimitedBots: /.*/,
  // Basic response headers (review 2026-11-20, SEC-4). No full script CSP yet: Next's inline scripts would need nonces
  // (listed as later work in docs/REVIEW-2026-11-20.md). HSTS is ignored by browsers on plain-http localhost.
  poweredByHeader: false,
  // With a base path, Next prefixes `source` by itself (basePath is not set to false), so these headers cover every
  // route under it, the health check included (e2e/base-path.spec.ts).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  serverExternalPackages: ["playwright", "playwright-core", "better-sqlite3", "@prisma/adapter-better-sqlite3", "undici"],
};

export default nextConfig;
