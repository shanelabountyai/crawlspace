import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native / browser-driving packages stay out of the server bundle.
  serverExternalPackages: ["playwright", "playwright-core", "better-sqlite3", "@prisma/adapter-better-sqlite3", "undici"],
};

export default nextConfig;
