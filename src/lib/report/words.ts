/**
 * Display words shared by the report page and the PDF (design pass, D-48..D-63). Presentation only.
 */
export const SITE_TYPE_WORD: Record<string, string> = { ecommerce: "Ecommerce", event: "Events and ticketing", other: "Other" };

export const SITE_TYPE_SOURCE: Record<string, string> = {
  override: "set for this scan",
  "jsonld-raw": "detected from structured data",
  "jsonld-rendered": "detected from structured data",
  "page-kinds": "detected from the pages found",
  default: "nothing more specific detected",
};

export const FIX_SOURCE_TEXT = {
  llm: "Written by AI from this scan's evidence only",
  mixed: "AI-written where it passed validation, standard fixes for the rest",
  template: "Standard fixes for each failed or partial check",
} as const;

/** `Nov 18, 2026, 4:05 PM UTC`: fixed locale and zone, so server, browser and PDF render the same text. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d)} UTC`;
}

/**
 * Error codes for messages that travel in a URL after a no-JS form post (D-61). Pages show only these fixed
 * sentences, so nobody can put their own words on a branded page through a link.
 */
export const URL_ERRORS = {
  "pdf-email": "Enter a valid email address to download the PDF.",
  "pdf-busy": "Too many download requests for this report; try again later.",
  "pdf-not-ready": "This scan has not finished, so there is no report to download yet.",
  "scan-empty": "Enter a website address.",
  "scan-long": "That address is too long.",
  "scan-refused": "We only scan public websites at http:// or https:// addresses, so we didn't connect to that one.",
  "scan-busy": "The scanner is busy; try again in a minute.",
  failed: "Something went wrong; try again.",
} as const;
export type UrlErrorCode = keyof typeof URL_ERRORS;

export function urlErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return (URL_ERRORS as Record<string, string>)[code] ?? URL_ERRORS.failed;
}

/** Code for a gate/scan failure (status from the service; message only used to tell refusals apart). */
export function pdfErrorCode(status: number): UrlErrorCode {
  return status === 400 ? "pdf-email" : status === 429 ? "pdf-busy" : status === 409 ? "pdf-not-ready" : "failed";
}

export function scanErrorCode(status: number, message: string): UrlErrorCode {
  if (status === 429) return "scan-busy";
  if (/^refused:/i.test(message)) return "scan-refused";
  if (/too long/i.test(message)) return "scan-long";
  if (/enter a website address/i.test(message)) return "scan-empty";
  return "failed";
}
