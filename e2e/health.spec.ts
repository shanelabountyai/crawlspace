import { expect, test } from "@playwright/test";

// The host's health check path (render.yaml `healthCheckPath`, D-69), through the production build.
test("GET /api/health answers 200 with a small JSON body; other methods are refused", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  expect((await request.post("/api/health")).status()).toBe(405);
});
