import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// The core flow with a base path set (D-103): home → scan → report → PDF gate, the no-JS form posts, the operator
// redirects and cookie, the health check and the security headers, all under /agent-check. The base path is baked into
// the build, so build with it first:
//   CRAWLSPACE_BASE_PATH=/agent-check npm run build && npm run e2e:base-path
// The default suite (`npm run e2e`) needs a build WITHOUT it; rebuild before running that one.
export const E2E_BASE_PATH = "/agent-check";

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: "base-path.spec.ts",
  use: { baseURL: "http://127.0.0.1:7901", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    // Ready when the health check answers under the base path (the root is not served with a base path).
    url: `http://127.0.0.1:7901${E2E_BASE_PATH}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: { CRAWLSPACE_BASE_PATH: E2E_BASE_PATH },
  },
});
