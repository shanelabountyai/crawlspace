import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Run with playwright.base-path.config.ts against a build made with CRAWLSPACE_BASE_PATH=/agent-check (D-103).
// Proves the core flow and every URL Next does not prefix by itself (fetch, form actions, plain links, Location
// headers, the operator cookie) work under the base path, plus the health check and the security headers.
// Scans goodshop.test only through the UI; nothing here is shared with the default suite's database.
const BP = "/agent-check";
const SITES = 7911;
const site = (host: string) => `http://${host}:${SITES}/`;
const PASSWORD = "crawlspace-demo-operator";
const SCAN_URL_RE = new RegExp(`^http://127\\.0\\.0\\.1:7901${BP}/scans/[A-Za-z0-9_-]{16}$`);

async function scanDone(page: Page, url: string): Promise<string> {
  await page.goto(BP);
  await page.getByLabel("Website address").fill(url);
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page).toHaveURL(SCAN_URL_RE);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
  return page.url().split("/").pop()!;
}

test("health check and security headers answer under the base path; the root is not served", async ({ request }) => {
  const health = await request.get(`${BP}/api/health`);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  for (const res of [health, await request.get(BP), await request.get(`${BP}/operator`)]) {
    const h = res.headers();
    expect(res.status(), res.url()).toBe(200);
    expect(h["content-security-policy"], res.url()).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toBe("max-age=31536000");
    expect(h["x-powered-by"]).toBeUndefined();
  }
  // Nothing of Crawlspace answers outside the base path (the proxy forwards only the base path).
  expect((await request.get("/api/health")).status()).toBe(404);
  expect((await request.get("/")).status()).toBe(404);
});

test("with JavaScript: home → scan → report → PDF gate, all under the base path", async ({ page }) => {
  const id = await scanDone(page, site("goodshop.test"));
  // Next-prefixed links and our own URLs both carry the base path
  await expect(page.getByTestId("brand-header").getByRole("link").first()).toHaveAttribute("href", BP);
  await expect(page.getByRole("link", { name: "Scan another site" }).first()).toHaveAttribute("href", BP);
  await expect(page.locator("form.pdf-form")).toHaveAttribute("action", `${BP}/api/scans/${id}/pdf`);
  // The panel sits after "Fix these first" here too (D-102)
  const next = await page.evaluate(() => document.getElementById("fixes-h")?.closest("section")?.nextElementSibling?.getAttribute("data-testid"));
  expect(next).toBe("pdf-gate");

  await page.getByLabel("Work email").fill("base-path-visitor@example.com");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^crawlspace-goodshop\.test-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(readFileSync((await download.path())!).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByTestId("pdf-done")).toBeVisible();

  // The progress poll (ScanProgress fetch) and the scan JSON route answer under the base path
  const json = await page.request.get(`${BP}/api/scans/${id}`);
  expect(json.status()).toBe(200);
  expect((await json.json()).status).toBe("done");
  // and not at the root
  expect((await page.request.get(`/api/scans/${id}`)).status()).toBe(404);
});

test("without JavaScript: the native form posts and every redirect stay under the base path", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: "http://127.0.0.1:7901", acceptDownloads: true });
  const page = await ctx.newPage();

  // Refused scan → back to the form with an error code, under the base path
  await page.goto(BP);
  await expect(page.locator("form.scan-form")).toHaveAttribute("action", `${BP}/api/scans`);
  await page.getByLabel("Website address").fill("http://127.0.0.1:7901/");
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:7901${BP}?error=scan-refused#url`);
  await expect(page.locator(".form-error")).toContainText("We only scan public websites");

  // Accepted scan → the report page; the no-JS progress page reloads itself into the report
  await page.getByLabel("Website address").fill(site("goodshop.test"));
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page).toHaveURL(SCAN_URL_RE);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
  const id = page.url().split("/").pop()!;

  // Bad email → 303 back to the report's panel, under the base path
  await page.getByLabel("Work email").fill("nope");
  await page.getByRole("button", { name: "Download PDF" }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:7901${BP}/scans/${id}?pdf=pdf-email#pdf-h`);
  await expect(page.getByTestId("pdf-error")).toContainText("valid email");

  // Good email → the native post returns the PDF as a download
  await page.getByLabel("Work email").fill("no-js-visitor@example.com");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloading;
  expect(readFileSync((await download.path())!).subarray(0, 5).toString()).toBe("%PDF-");
  await ctx.close();
});

test("operator: sign-in, cookie path, exports, rerun and sign-out all stay under the base path", async ({ page, context }) => {
  const id = await scanDone(page, site("goodshop.test"));

  await page.goto(`${BP}/operator`);
  await expect(page.locator(`form[action="${BP}/api/operator/login"]`)).toHaveCount(1);
  await page.getByLabel("Password").fill("wrong password!!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:7901${BP}/operator?error=wrong`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:7901${BP}/operator`);
  await expect(page.getByTestId("operator")).toBeVisible();

  // The session cookie is scoped to the base path, so it is not sent to other apps on the same host
  const cookie = (await context.cookies()).find((c) => c.name === "cs_op");
  expect(cookie?.path).toBe(BP);

  // Export links and the operator PDF carry the base path and work
  await expect(page.getByRole("link", { name: "Export leads (CSV)" })).toHaveAttribute("href", `${BP}/api/operator/export/leads`);
  await expect(page.getByRole("link", { name: "Export scans (CSV)" })).toHaveAttribute("href", `${BP}/api/operator/export/scans`);
  const leadsCsv = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export leads (CSV)" }).click();
  expect(readFileSync((await (await leadsCsv).path())!, "utf8").split("\r\n")[0]).toBe("created_at,email,scan_url,scan_id,hubspot_status,hubspot_error");
  const row = page.getByTestId("operator-scans").locator(`tr[data-scan="${id}"]`);
  await expect(row.getByRole("link", { name: /^PDF for / })).toHaveAttribute("href", `${BP}/api/operator/scans/${id}/pdf`);
  await expect(row.getByRole("link", { name: /^Report for / })).toHaveAttribute("href", `${BP}/scans/${id}`);
  const opPdf = await page.request.get(`${BP}/api/operator/scans/${id}/pdf`);
  expect(opPdf.status()).toBe(200);

  // Rerun → 303 back to the operator page with the notice, under the base path
  await row.getByRole("button", { name: "Rerun" }).click();
  await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:7901${BP}/operator\\?rerun=[A-Za-z0-9_-]{16}$`));
  await expect(page.getByTestId("rerun-notice")).toBeVisible();
  await expect(page.getByTestId("rerun-notice").getByRole("link")).toHaveAttribute("href", new RegExp(`^${BP}/scans/`));

  // Sign out → back to the sign-in page under the base path; the cookie is cleared on the same path
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:7901${BP}/operator`);
  await expect(page.getByTestId("operator-login")).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === "cs_op")).toBeUndefined();
  expect((await page.request.get(`${BP}/api/operator/export/scans`)).status()).toBe(401);
});
