import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native / browser-driving packages stay out of the server bundle.
  // Metadata is sent with the page, never streamed in afterwards (Next's documented switch for turning streaming
  // metadata off). With streaming, a client-side refresh showed the new page for up to ~300 ms with no <title> at
  // all: the report was on screen while the tab had no name (D-75; caught by axe "document-title" in e2e/a11y.spec.ts).
  htmlLimitedBots: /.*/,
  // Basic response headers (review 2026-11-20, SEC-4). No full script CSP yet: Next's inline scripts would need nonces
  // (listed as later work in docs/REVIEW-2026-11-20.md). HSTS is ignored by browsers on plain-http localhost.
  poweredByHeader: false,
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
