import AxeBuilder from "@axe-core/playwright";
// Review 2026-11-20 rank 9, Decision 4b (D-101): the PDF panel ("Take this report to your team") sits just after
// "Fix these first", before "Every check" (D-102). Scans walledshop only: e2e/phase4.spec.ts counts goodshop rows.
import { expect, test, type Page } from "@playwright/test";

async function walledReport(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Website address").fill("http://walledshop.test:7911/");
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page).toHaveURL(/\/scans\/[A-Za-z0-9_-]{16}$/);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
  return page.url().split("/").pop()!;
}

test("rank 9 / Decision 4b: the PDF panel comes right after 'Fix these first' in the page, the heading order and the keyboard order", async ({ page }) => {
  await walledReport(page);
  const main = page.getByRole("main");

  // Heading order: the panel's h2 is between "Fix these first" and "Every check", all inside <main>.
  const h2s = (await main.locator("h2").allTextContents()).map((t) => t.trim());
  expect(h2s).toEqual(["Score by category", "Fix these first", "Take this report to your team", "Every check", "How this site was read"]);
  await expect(main.getByTestId("pdf-gate")).toHaveCount(1);

  // Document order: the panel is the next sibling after the "Fix these first" section.
  const order = await page.evaluate(() => {
    const fixes = document.getElementById("fixes-h")?.closest("section");
    const panel = document.querySelector('[data-testid="pdf-gate"]');
    const checks = document.getElementById("checks-h")?.closest("section");
    return { nextAfterFixes: fixes?.nextElementSibling === panel, nextAfterPanel: panel?.nextElementSibling === checks };
  });
  expect(order).toEqual({ nextAfterFixes: true, nextAfterPanel: true });

  // On screen: below the fix list, above the checks table (1280 px and 390 px).
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const fixes = await page.getByTestId("fix-list").boundingBox();
    const panel = await page.getByTestId("pdf-gate").boundingBox();
    const checks = await page.getByRole("heading", { name: "Every check" }).boundingBox();
    expect(panel!.y, `${width} px`).toBeGreaterThan(fixes!.y + fixes!.height - 1);
    expect(panel!.y + panel!.height, `${width} px`).toBeLessThan(checks!.y);
  }

  // Keyboard order follows: email → Download PDF → the "Every check" scroll box (D-97).
  await page.getByLabel("Work email").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("group", { name: "Every check" })).toBeFocused();

  // No new axe findings with the panel in its new place (light and dark).
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.impact})`), colorScheme).toEqual([]);
  }
});

test("rank 9: a refused no-JS PDF request still lands on the panel's heading in its new place", async ({ page, request }) => {
  const id = await walledReport(page);
  const res = await request.post(`/api/scans/${id}/pdf`, { form: { email: "nope" }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers().location).toMatch(/#pdf-h$/);
  await page.goto(res.headers().location!);
  await expect(page.getByTestId("pdf-error")).toContainText("valid email");
  // The #pdf-h fragment scrolls the panel's heading into view (browsers skip autofocus when the URL has a fragment
  // target, on main too; noted in D-102, not changed here).
  await expect(page.getByRole("heading", { name: "Take this report to your team" })).toBeInViewport();
  const next = await page.evaluate(() => document.getElementById("fixes-h")?.closest("section")?.nextElementSibling?.getAttribute("data-testid"));
  expect(next).toBe("pdf-gate");
});
