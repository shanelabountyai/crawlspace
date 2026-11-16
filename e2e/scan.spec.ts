import { expect, test } from "@playwright/test";

const SITES = 7911;
const site = (host: string) => `http://${host}:${SITES}/`;

async function startScan(page: import("@playwright/test").Page, url: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Crawlspace" })).toBeVisible();
  await page.getByLabel("Website address").fill(url);
  await page.getByRole("button", { name: "Scan site" }).click();
  await expect(page).toHaveURL(/\/scans\/[A-Za-z0-9_-]{16}$/);
}

test("scans a good fixture shop end to end: crawl → score → report, nothing to fix", async ({ page }) => {
  await startScan(page, site("goodshop.test"));
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("site-type")).toHaveText("ecommerce");
  await expect(page.getByTestId("final-url")).toHaveText(site("goodshop.test"));
  const rows = page.getByTestId("checks").locator("tbody tr");
  await expect(rows).toHaveCount(18);
  for (const id of ["A1", "A4", "B1", "B2", "C1", "C2", "C4", "D1", "D2", "E1", "E2", "E3", "E4", "F2"]) {
    await expect(rows.and(page.locator(`[data-check="${id}"]`)), id).toHaveAttribute("data-status", "pass");
  }
  // real agent list is empty until verified (D-10), so A2 is N/A and does not count (CS-05)
  await expect(rows.and(page.locator('[data-check="A2"]'))).toHaveAttribute("data-status", "not-applicable");
  await expect(page.getByTestId("crawl-summary")).toContainText("all GET");
});

test("scans a walled fixture shop: failing checks get a validated fix list, invented AI suggestions are dropped", async ({ page }) => {
  await startScan(page, site("walledshop.test"));
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
  const overall = Number(await page.getByTestId("overall-score").locator(".overall-num").textContent());
  expect(overall).toBeGreaterThan(40);
  expect(overall).toBeLessThan(85);
  const rows = page.getByTestId("checks").locator("tbody tr");
  for (const [id, status] of [["A1", "partial"], ["A4", "partial"], ["B1", "partial"], ["E3", "fail"], ["D1", "fail"]] as const) {
    await expect(rows.and(page.locator(`[data-check="${id}"]`)), id).toHaveAttribute("data-status", status);
  }
  // CS-04 on the page: 3 of the recorded AI suggestions cited things not in the scan
  await expect(page.getByTestId("fix-dropped")).toContainText("3 AI suggestions were dropped");
  await expect(page.getByTestId("fix-source")).toContainText("AI-written where it passed validation");
  const fixes = page.getByTestId("fix-list").locator(":scope > li");
  await expect(fixes.first()).toHaveAttribute("data-check", "E3");
  await expect(fixes.first()).toHaveAttribute("data-source", "llm");
  const ids = await fixes.evaluateAll((els) => els.map((e) => e.getAttribute("data-check")));
  expect(ids).not.toContain("G1");
  const failing = await rows.evaluateAll((els) => els.filter((e) => ["fail", "partial"].includes(e.getAttribute("data-status") ?? "")).map((e) => e.getAttribute("data-check")));
  expect([...ids].sort()).toEqual([...failing].sort());
  await expect(page.getByTestId("fix-list")).not.toContainText("secret-sale");
});

test("refuses private addresses before scanning (CS-03 through the UI)", async ({ page }) => {
  await page.goto("/");
  for (const [target, why] of [
    ["http://127.0.0.1:7901/", "127.0.0.1 is a private"],
    ["http://169.254.169.254/latest/meta-data/", "169.254.169.254 is a private"],
    ["file:///etc/passwd", "scheme file: is not allowed"],
  ]) {
    await page.getByLabel("Website address").fill(target!);
    await page.getByRole("button", { name: "Scan site" }).click();
    await expect(page.locator("p.form-error")).toContainText(`refused: ${why}`);
    await expect(page).toHaveURL(/\/$/);
  }
});

test("a robots-closed site shows why the scan stopped", async ({ page }) => {
  await startScan(page, site("closed.test"));
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "failed");
  await expect(page.getByTestId("scan-error")).toContainText("robots.txt disallows CrawlspaceBot");
});

test("API: unknown scan ids are 404", async ({ request }) => {
  expect((await request.get("/api/scans/AAAAAAAAAAAAAAAA")).status()).toBe(404);
  expect((await request.get("/scans/nope")).status()).toBe(404);
});
