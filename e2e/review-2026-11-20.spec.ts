import AxeBuilder from "@axe-core/playwright";
// Must-fix findings of the 2026-11-20 five-lens review (docs/REVIEW-2026-11-20.md). Scans walledshop only:
// e2e/phase4.spec.ts counts the goodshop rows in the shared e2e database.
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function walledReport(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Website address").fill("http://walledshop.test:7911/");
  await page.getByRole("button", { name: "Scan my site" }).click();
  await expect(page).toHaveURL(/\/scans\/[A-Za-z0-9_-]{16}$/);
  await expect(page.getByTestId("scan-status")).toHaveAttribute("data-status", "done");
}

test("A11Y-1: the 'Every check' table has no axe violations at 700 px (200% zoom on a 1400 px laptop), light and dark", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await walledReport(page);
  const wrap = page.getByRole("group", { name: "Every check" });
  await expect(wrap).toHaveAttribute("tabindex", "0");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.impact})`), colorScheme).toEqual([]);
  }
  await wrap.focus();
  await expect(wrap).toBeFocused();
});

test("DS-2 / A11Y-2: evidence text and its URL are separated by a space in the text, not only by CSS margin", async ({ page }) => {
  await walledReport(page);
  const glued = await page.locator("ul.evidence li, p.fix-ev").evaluateAll((els) =>
    els.flatMap((el) =>
      [...el.querySelectorAll("code")].filter((c) => {
        const prev = c.previousSibling;
        const text = prev?.textContent ?? "";
        return prev !== null && text.length > 0 && !/\s$/.test(text);
      }).map((c) => `${el.textContent?.slice(0, 80)} | ${c.textContent}`),
    ),
  );
  expect(glued).toEqual([]);
  expect(await page.locator("ul.evidence li code").count()).toBeGreaterThan(0);
});

test("SEC-4: pages and API answers carry basic security headers and do not advertise the framework", async ({ request }) => {
  for (const path of ["/", "/operator", "/api/health"]) {
    const r = await request.get(path);
    const h = r.headers();
    expect(h["x-powered-by"], path).toBeUndefined();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"], path).toMatch(/max-age=\d+/);
  }
});
