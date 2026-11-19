import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native / browser-driving packages stay out of the server bundle.
  // Metadata is sent with the page, never streamed in afterwards (Next's documented switch for turning streaming
  // metadata off). With streaming, a client-side refresh showed the new page for up to ~300 ms with no <title> at
  // all: the report was on screen while the tab had no name (D-75; caught by axe "document-title" in e2e/a11y.spec.ts).
  htmlLimitedBots: /.*/,
  serverExternalPackages: ["playwright", "playwright-core", "better-sqlite3", "@prisma/adapter-better-sqlite3", "undici"],
};

export default nextConfig;
