import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Design pass (D-59): WCAG 2.1 AA checks with axe on every screen, light and dark, plus a keyboard-only pass.
const SITES = 7911;
const site = (host: string) => `http://${host}:${SITES}/`;
const PASSWORD = "crawlspace-demo-operator";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function axe(page: Page, label: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const found = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    console.log(`axe ${label} [${colorScheme}]: ${r.violations.length} violations, ${r.passes.length} rules passed`);
    expect(found, `${label} [${colorScheme}]`).toEqual([]);
  }
}

async function scan(page: Page, url: string, status: "done" | "failed") {
  await page.goto("/");
  await page.getByLabel("Website address").fill(url);
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page).toHaveURL(/\/scans\/[A-Za-z0-9_-]{16}$/);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", status);
}

test("axe: scan form, its refusal, the report, the PDF gate error, a stopped scan and not-found", async ({ page }) => {
  await page.goto("/");
  await axe(page, "form");
  await page.getByLabel("Website address").fill("http://127.0.0.1:7901/");
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page.locator(".form-error")).toBeVisible();
  await axe(page, "form refusal");

  await scan(page, site("walledshop.test"), "done");
  await axe(page, "report");
  const id = page.url().split("/").pop()!;
  await page.goto(`/scans/${id}?pdf=${encodeURIComponent("enter a valid email address to download the PDF")}`);
  await expect(page.getByTestId("pdf-error")).toBeVisible();
  await axe(page, "report with PDF gate error");

  await scan(page, site("closed.test"), "failed");
  await axe(page, "scan stopped");

  await page.goto("/scans/AAAAAAAAAAAAAAAA");
  await axe(page, "not found");
});

test("axe: operator sign-in, wrong password and the signed-in page", async ({ page }) => {
  await page.goto("/operator");
  await axe(page, "operator sign-in");
  await page.getByLabel("Password").fill("wrong password!!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".form-error")).toBeVisible();
  await axe(page, "operator wrong password");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("operator")).toBeVisible();
  await axe(page, "operator");
});

test("keyboard only: skip link, then the form, then a scan starts with Enter; focus is visible", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Website address")).toBeFocused();
  const outline = await page.getByLabel("Website address").evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.type(site("goodshop.test"));
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Scan my site" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/scans\/[A-Za-z0-9_-]{16}$/);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
});

test("touch targets: every button, link-button and text field on the report and form is at least 44 px tall", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const small = async () =>
    page.locator("button, .btn, input:not([type=hidden]), .brand, .actions a").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 80)),
    );
  expect(await small()).toEqual([]);
  await scan(page, site("goodshop.test"), "done");
  expect(await small()).toEqual([]);
});
