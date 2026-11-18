/**
 * Optional HubSpot lead capture (D-05, D-36): a HubSpot Forms submission, behind CRAWLSPACE_HUBSPOT_ENABLED=1, off by
 * default. The HTTP call goes through an injected function so tests use a mock; nothing here runs unless the flag,
 * the portal ID and the form GUID are all set. Never throws: the PDF download does not depend on HubSpot.
 */
export const HUBSPOT_SUBMIT_BASE = "https://api.hsforms.com/submissions/v3/integration/submit";
export const HUBSPOT_TIMEOUT_MS = 5_000;

export interface HttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}
export interface HttpResponse {
  status: number;
}
export type HttpPost = (req: HttpRequest) => Promise<HttpResponse>;

export interface SubmitContext {
  pageUri: string;
  pageName: string;
}
export type HubSpotResult = { status: "sent" } | { status: "failed"; error: string };

export interface LeadSink {
  submit(email: string, ctx: SubmitContext): Promise<HubSpotResult>;
}

/** The real transport: global fetch. Only reached when the flag is on. */
const fetchPost: HttpPost = async (req) => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: req.signal });
  await res.body?.cancel().catch(() => undefined);
  return { status: res.status };
};

export class HubSpotForms implements LeadSink {
  constructor(
    private readonly portalId: string,
    private readonly formGuid: string,
    private readonly http: HttpPost = fetchPost,
    private readonly timeoutMs = HUBSPOT_TIMEOUT_MS,
  ) {}

  get url(): string {
    return `${HUBSPOT_SUBMIT_BASE}/${encodeURIComponent(this.portalId)}/${encodeURIComponent(this.formGuid)}`;
  }

  async submit(email: string, ctx: SubmitContext): Promise<HubSpotResult> {
    try {
      const res = await this.http({
        url: this.url,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: [{ objectTypeId: "0-1", name: "email", value: email }], context: { pageUri: ctx.pageUri, pageName: ctx.pageName } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status >= 200 && res.status < 300) return { status: "sent" };
      return { status: "failed", error: `HubSpot answered HTTP ${res.status}` };
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      return { status: "failed", error: name === "TimeoutError" || name === "AbortError" ? "HubSpot did not answer in time" : "could not reach HubSpot" };
    }
  }
}

/** The configured sink, or null (flag off, the default) — then leads are only stored locally. */
export function hubspotFromEnv(env: NodeJS.ProcessEnv = process.env, http?: HttpPost): LeadSink | null {
  if (env.CRAWLSPACE_HUBSPOT_ENABLED?.trim() !== "1") return null;
  const portal = env.HUBSPOT_PORTAL_ID?.trim();
  const form = env.HUBSPOT_FORM_GUID?.trim();
  if (!portal || !form) return null;
  return new HubSpotForms(portal, form, http);
}
