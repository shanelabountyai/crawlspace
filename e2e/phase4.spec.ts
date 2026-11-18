import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Phase 4 (PRD §8 row 4): /100 + letters and branding (D-33, D-34), the PDF behind the email gate (D-35..D-38),
// the operator page (D-39, D-40). The harness turns HubSpot off and sets a demo operator password.
const SITES = 7911;
const site = (host: string) => `http://${host}:${SITES}/`;
const PASSWORD = "crawlspace-demo-operator";

async function scanDone(page: Page, url: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Website address").fill(url);
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page).toHaveURL(/\/scans\/[A-Za-z0-9_-]{16}$/);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
  return page.url().split("/").pop()!;
}

async function signIn(page: Page) {
  await page.goto("/operator");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("operator")).toBeVisible();
}

test("report shows the overall score over 100, a letter per category and Lab Intelligence branding; the report itself is not gated", async ({ page }) => {
  await scanDone(page, site("walledshop.test"));
  const overall = page.getByTestId("overall-score");
  await expect(overall.locator(".overall-outof")).toHaveText("/ 100");
  const score = Number(await overall.locator(".overall-num").textContent());
  for (const c of ["A", "B", "C", "D", "E", "F"]) {
    const cat = page.getByTestId(`category-${c}`);
    const grade = await cat.getAttribute("data-grade");
    expect(grade, c).toMatch(/^(A|B|C|D|F|N\/A)$/);
    await expect(cat.locator(".cat-grade")).toHaveText(grade!);
  }
  expect(score).toBeGreaterThan(0);
  await expect(page.getByTestId("brand-header")).toContainText("Lab Intelligence");
  await expect(page.getByTestId("brand-header")).toContainText("Crawlspace");
  await expect(page.getByTestId("brand-footer")).toContainText("9905 S Pennsylvania Ave, Oklahoma City, OK 73159");
  // free report: checks and fixes are on the page with no email asked
  await expect(page.getByTestId("checks").locator("tbody tr")).toHaveCount(18);
  await expect(page.getByTestId("fix-list")).toBeVisible();
  await expect(page.getByTestId("pdf-gate")).toContainText("free either way");
});

test("PDF download goes through the email gate and stores the lead; the operator sees it, reruns and exports", async ({ page, request }) => {
  const id = await scanDone(page, site("goodshop.test"));

  // No ungated public PDF; bad emails are refused (JSON and no-JS form posts)
  expect((await request.get(`/api/scans/${id}/pdf`)).status()).toBe(405);
  const bad = await request.post(`/api/scans/${id}/pdf`, { data: { email: "not-an-email" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toContain("valid email");
  const badForm = await request.post(`/api/scans/${id}/pdf`, { form: { email: "nope" }, maxRedirects: 0 });
  expect(badForm.status()).toBe(303);
  expect(badForm.headers().location).toContain(`/scans/${id}?pdf=`);
  await page.goto(badForm.headers().location!);
  await expect(page.getByTestId("pdf-error")).toContainText("valid email");

  // The gate in the UI
  await page.getByLabel("Work email").fill("demo-visitor@example.com");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^crawlspace-goodshop\.test-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = readFileSync((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByTestId("pdf-done")).toBeVisible();

  // No-JS form post also returns the PDF
  const formPdf = await request.post(`/api/scans/${id}/pdf`, { form: { email: "form-visitor@example.com" } });
  expect(formPdf.status()).toBe(200);
  expect(formPdf.headers()["content-type"]).toBe("application/pdf");
  expect(formPdf.headers()["content-disposition"]).toMatch(/^attachment; filename="crawlspace-goodshop\.test-/);

  // Operator APIs are closed without a session
  expect((await request.get("/api/operator/export/leads")).status()).toBe(401);
  expect((await request.get(`/api/operator/scans/${id}/pdf`)).status()).toBe(401);
  expect((await request.post(`/api/operator/scans/${id}/rerun`)).status()).toBe(401);

  // Wrong password, then sign in
  await page.goto("/operator");
  await expect(page.getByTestId("operator-login")).toBeVisible();
  await page.getByLabel("Password").fill("wrong password!!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".form-error")).toContainText("Wrong password");
  await signIn(page);

  // See the scan with its two leads, and the leads with HubSpot off
  const row = page.getByTestId("operator-scans").locator(`tr[data-scan="${id}"]`);
  await expect(row).toContainText(site("goodshop.test"));
  await expect(row).toContainText("/100");
  await expect(row.getByTestId("lead-count")).toHaveText("2");
  await expect(page.getByTestId("operator-leads")).toContainText("demo-visitor@example.com");
  await expect(page.getByTestId("operator-leads")).toContainText("Off");
  await expect(page.getByTestId("operator")).toContainText("HubSpot lead capture: off");

  // Export: leads CSV, scans CSV, the operator's ungated PDF
  const leadsCsv = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export leads (CSV)" }).click();
  const leads = readFileSync((await (await leadsCsv).path())!, "utf8");
  expect(leads.split("\r\n")[0]).toBe("created_at,email,scan_url,scan_id,hubspot_status,hubspot_error");
  expect(leads).toContain(`demo-visitor@example.com,${site("goodshop.test")},${id},off,`);
  const scansCsv = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export scans (CSV)" }).click();
  const scans = readFileSync((await (await scansCsv).path())!, "utf8");
  expect(scans).toContain(`${id},${site("goodshop.test")},done,`);
  const opPdf = await page.request.get(`/api/operator/scans/${id}/pdf`);
  expect(opPdf.status()).toBe(200);
  expect((await opPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Rerun: a new scan of the same URL; the old one stays
  await row.getByRole("button", { name: "Rerun" }).click();
  await expect(page.getByTestId("rerun-notice")).toBeVisible();
  await page.getByTestId("rerun-notice").getByRole("link").click();
  await expect(page).toHaveURL(/\/scans\/[A-Za-z0-9_-]{16}$/);
  expect(page.url()).not.toContain(id);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("final-url")).toHaveText(site("goodshop.test"));
  await page.goto("/operator");
  await expect(page.getByTestId("operator-scans").locator("tbody tr").filter({ hasText: site("goodshop.test") })).toHaveCount(2);

  // Cross-origin POST refused even with the session cookie
  const cross = await page.request.post(`/api/operator/scans/${id}/rerun`, { headers: { origin: "https://evil.example" } });
  expect(cross.status()).toBe(403);

  // Sign out
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("operator-login")).toBeVisible();
  expect((await page.request.get("/api/operator/export/scans")).status()).toBe(401);
});
