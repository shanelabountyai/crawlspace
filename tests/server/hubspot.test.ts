import { describe, expect, it, vi } from "vitest";
import { hubspotFromEnv, HubSpotForms, type HttpPost } from "@/server/hubspot";

const never: HttpPost = vi.fn(async () => {
  throw new Error("must not be called");
});

describe("HubSpot flag (D-05, D-36): off by default", () => {
  it.each([
    [{}],
    [{ HUBSPOT_PORTAL_ID: "1", HUBSPOT_FORM_GUID: "g" }],
    [{ CRAWLSPACE_HUBSPOT_ENABLED: "0", HUBSPOT_PORTAL_ID: "1", HUBSPOT_FORM_GUID: "g" }],
    [{ CRAWLSPACE_HUBSPOT_ENABLED: "true", HUBSPOT_PORTAL_ID: "1", HUBSPOT_FORM_GUID: "g" }],
    [{ CRAWLSPACE_HUBSPOT_ENABLED: "1" }],
    [{ CRAWLSPACE_HUBSPOT_ENABLED: "1", HUBSPOT_PORTAL_ID: "1" }],
    [{ CRAWLSPACE_HUBSPOT_ENABLED: "1", HUBSPOT_PORTAL_ID: " ", HUBSPOT_FORM_GUID: "g" }],
  ])("%j → no HubSpot", (env) => {
    expect(hubspotFromEnv(env as unknown as NodeJS.ProcessEnv, never)).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });

  it("enabled only with flag 1 + portal + form", () => {
    expect(hubspotFromEnv({ CRAWLSPACE_HUBSPOT_ENABLED: "1", HUBSPOT_PORTAL_ID: "123", HUBSPOT_FORM_GUID: "abc" } as unknown as NodeJS.ProcessEnv, never)).toBeInstanceOf(HubSpotForms);
  });

  it("the test environment has no HubSpot configured", () => {
    expect(hubspotFromEnv()).toBeNull();
  });

  it("encodes the portal and form into the path", () => {
    expect(new HubSpotForms("12/3", "a b", never).url).toBe("https://api.hsforms.com/submissions/v3/integration/submit/12%2F3/a%20b");
  });

  it("any 2xx counts as sent; never throws", async () => {
    expect(await new HubSpotForms("1", "g", async () => ({ status: 204 })).submit("a@b.co", { pageUri: "", pageName: "" })).toEqual({ status: "sent" });
    expect(await new HubSpotForms("1", "g", async () => ({ status: 500 })).submit("a@b.co", { pageUri: "", pageName: "" })).toEqual({ status: "failed", error: "HubSpot answered HTTP 500" });
  });
});
