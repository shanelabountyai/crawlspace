import { defineConfig, devices } from "@playwright/test";

// e2e (PRD §8 Phase 3 gate): scan a fixture site end to end through the production build. Run `npm run build` first.
export default defineConfig({
  testDir: "e2e",
  // The base-path flow needs its own build: playwright.base-path.config.ts, `npm run e2e:base-path` (D-103).
  testIgnore: "base-path.spec.ts",
  timeout: 120_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:7901", trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: "http://127.0.0.1:7901/",
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
