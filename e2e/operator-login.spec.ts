import { expect, test } from "@playwright/test";

// Operator sign-in through the production build (D-76..D-80): the cookie the login route issues is accepted by the
// page and by the operator APIs (one signing key for the whole process), and the address check reports what it sees.
const PASSWORD = "crawlspace-demo-operator";

test("sign in over HTTP: cookie flags, the session works on the page and the APIs, and the address report is for the operator only", async ({ page, request }) => {
  expect((await request.get("/api/operator/client-address")).status()).toBe(401);

  const res = await page.request.post("/api/operator/login", { data: { password: PASSWORD } });
  expect(res.status()).toBe(200);
  const cookie = res.headers()["set-cookie"] ?? "";
  // Plain HTTP on 127.0.0.1 here, so no Secure flag; the unit tests cover HTTPS.
  expect(cookie).toMatch(/^cs_op=\d+\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/);

  await page.goto("/operator");
  await expect(page.getByTestId("operator")).toBeVisible();
  expect((await page.request.get("/api/operator/export/scans")).status()).toBe(200);

  const seen = await page.request.get("/api/operator/client-address");
  expect(seen.status()).toBe(200);
  const body = (await seen.json()) as { trustedProxyHops: number; forwardedFor: string[]; countedAs: string; perAddress: boolean };
  // No proxy in front of the harness and the setting is unset: nothing is trusted, attempts share one bucket.
  expect(body.trustedProxyHops).toBe(0);
  expect(body.countedAs).toBe("shared");
  expect(body.perAddress).toBe(false);
  expect(Array.isArray(body.forwardedFor)).toBe(true);

  // A cookie that was not issued by this process is refused, whatever it looks like.
  const forged = await request.get("/api/operator/export/scans", { headers: { cookie: `cs_op=${cookie.slice(6, cookie.indexOf(".") + 1)}${"A".repeat(43)}` } });
  expect(forged.status()).toBe(401);
});
