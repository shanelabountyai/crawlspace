# Crawlspace — Phase 4 plan (lead capture, operator page, PDF export, deploy notes)

Branch `phase-4` (off `main` at 98bff33, which holds Phases 1–3), PR "Crawlspace Phase 4: lead capture, operator page,
PDF export, deploy notes" against `main`, never merged by Claude.
Scope is exactly PRD §8 row 4: **Lead capture (HubSpot, optional), operator page, PDF export, deploy notes**.
Gate: **demo script in README** — plus lint, typecheck, unit tests, CS-01..CS-05, build, e2e and green CI.

Owner decisions of 2026-11-17 (D-33, D-34, D-35): Lab Intelligence branding on the report page and the PDF; overall
score shown over 100 and an A–F letter per category; the email gate sits only in front of the PDF download.

Not in this phase: deploying anything (D-08, D-43), emailing reports, double opt-in, accounts, scheduled rescans,
any change to checks, weights or fixture scorecards.

## 1. Presentation (`src/lib/report/`, pure)

| File | Job |
|---|---|
| `grade.ts` | `GRADE_BANDS` (A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below; D-34), `letterFor(score)` → `A..F` or `N/A`, `formatOutOf100(score)` → `72.5/100` or `n/a`, `gradeTone(letter)` → `good / mid / bad / na` |
| `brand.ts` | `BRAND` constants: product name, "by Lab Intelligence", public business address (D-33). No logo, no claims |
| `pdf.ts` | `renderReportPdf(view) → Uint8Array` with pdf-lib (D-37): branded header, URL, scan date, site type, overall /100, category letters, fix list, every check with status and evidence, crawl summary, footer with brand, address and page numbers. Text wrapped to the page; non-Latin-1 characters replaced; metadata dates from the scan so the same report gives the same bytes |

The report page (`Report.tsx`) shows `72.5/100` and a letter per category, with a branded header and footer.

## 2. Lead capture and the PDF gate

- Prisma: new `Lead` model (id, scanId → Scan cascade, email, createdAt, hubspotStatus `off|sent|failed`,
  hubspotError) + hand-written migration `prisma/migrations/20261118000000_leads` (D-26, D-41).
- `src/server/lead-service.ts`: `LeadService.capture(scanId, email)` — scan must exist and be done, email syntax
  check (≤ 254 chars, lower-cased), ≤ 10 per scan per hour (D-38), store the lead, then the optional HubSpot submit;
  returns the stored lead. `listLeads()` for the operator.
- `src/server/hubspot.ts`: `hubspotFromEnv(env, http?)` → `null` unless `CRAWLSPACE_HUBSPOT_ENABLED=1` and portal ID
  + form GUID are set; `HubSpotForms.submit(email, context)` → POST to the Forms submission endpoint through an
  injected HTTP function (default: `fetch`), 5 s timeout, never throws (D-36). Tests use a mock; nothing live.
- `POST /api/scans/<id>/pdf` (form or JSON `{ email }`) → 200 `application/pdf` attachment, or 400/404/409/429 with a
  plain message. There is no ungated public PDF route (D-35, D-38).
- `PdfGate.tsx` on the report page: one email field, a line saying what the email is used for, "Download PDF".
  Works as a plain form post without JS.

## 3. Operator page (PRD §2, §6: password env var, no accounts)

- `src/server/operator-auth.ts`: `operatorConfig(env)` (disabled unless `CRAWLSPACE_OPERATOR_PASSWORD` has ≥ 12
  characters), `issueToken / verifyToken` (expiry + HMAC-SHA256 keyed by the password, 12 h), constant-time password
  check, failed-login limiter (10 per 15 min), same-origin check for POSTs (D-39).
- Routes: `POST /api/operator/login`, `POST /api/operator/logout`, `POST /api/operator/scans/<id>/rerun`,
  `GET /api/operator/export/scans.csv`, `GET /api/operator/export/leads.csv`, `GET /api/operator/scans/<id>/pdf`.
  All answer 404 when the password is not configured and 401 without a valid cookie.
- `/operator`: login form when signed out; signed in: scans table (URL, status, created, /100, lead count, links to
  report, rerun, PDF), recent leads, export links, sign out (D-40). `noindex`.
- `src/server/csv.ts`: CSV writer with formula-injection guard.

## 4. Deploy notes and README

- `docs/DEPLOY.md` (D-43): what the app needs at runtime (Node 22, Chromium for Playwright, a writable SQLite file,
  one process because the queue is in memory), the env vars, the options (single container host with a volume;
  Vercel UI + separate crawl worker + hosted DB; a home Mac behind a tunnel) and the work each needs, a
  recommendation, and a pre-launch checklist. Nothing deployed, no account touched.
- README: status line → Phase 4; env table gains the operator and HubSpot variables; **demo script** a reviewer can
  follow locally (start the app, scan a local fixture site, read /100 + letters, download the PDF through the email
  gate, sign in to the operator page, see the lead, rerun, export CSV).
- `npm run demo` = `next build` + the e2e harness (`scripts/e2e-server.ts`): the production app on port 7901 with
  synthetic fixture sites on `*.test` hostnames (test crawl policy injected in-process, D-27), a temp DB and a demo
  operator password printed on start, so the demo needs no internet, no keys and scans no third-party site.

## 5. Tasks

1. Plan (this file) + DECISIONS rows D-33..D-43.
2. `grade.ts`, `brand.ts` + unit tests; report page shows /100, letters, branding.
3. `pdf.ts` + unit tests (text content, page count, determinism, character replacement).
4. Prisma `Lead` + migration + drift-check comparator (+ test); `LeadService`, `hubspot.ts` + tests with a mocked
   HTTP client; PDF gate route and component.
5. Operator auth + routes + page + CSV + tests.
6. e2e: report shows /100 and letters; PDF download through the gate; gate refuses a bad email; operator page
   (disabled without the cookie, login, sees the scan and its lead, rerun, CSV export, per-scan PDF).
7. DEPLOY.md, README demo script + status, NEXT.md, PR.

## 6. Acceptance → tests

| Acceptance item | Proof |
|---|---|
| /100 overall + A–F per category (D-34), presentation only | `tests/unit/report-grade.test.ts` (bands, edges, N/A); e2e `e2e/phase4.spec.ts` reads `/100` and each category letter; `tests/fixtures.test.ts` unchanged and green |
| Lab Intelligence branding on report and PDF (D-33) | e2e checks the header/footer text; `tests/unit/report-pdf.test.ts` finds the brand and address on every page |
| PDF export of the report | `tests/unit/report-pdf.test.ts`: valid PDF, contains URL, overall, every category letter, every fix title, every check ID; deterministic; long reports paginate; non-Latin-1 text does not throw |
| Email gate only before the PDF (D-35) | `tests/server/lead-service.test.ts` (bad email, unknown scan, unfinished scan, rate limit); e2e: report visible with no email; PDF only after an email; no GET PDF route without operator cookie |
| Lead stored locally in SQLite | `tests/server/lead-service.test.ts` on a temp DB; e2e sees the lead on the operator page and in leads.csv |
| HubSpot optional, off by default, never live (D-36) | `tests/server/hubspot.test.ts`: flag unset/0 → null and the mock is never called; flag on → exact URL and JSON body to the mock; HTTP error and timeout → `failed`, PDF still served; e2e runs with the flag off |
| Operator page: password env, see scans, rerun, export (D-39, D-40) | `tests/server/operator-auth.test.ts` (token round trip, expiry, tamper, password change, short password disables, limiter, origin check); `tests/server/csv.test.ts`; e2e operator flow |
| Deploy notes | `docs/DEPLOY.md` present; README links it |
| Gate: demo script in README | README section "Demo script"; its commands are the ones the e2e harness uses |
| CS-01..CS-05 and the Phase 3 e2e still green | existing tests, unchanged |

## 7. Gate

`npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`; migration drift check runs in
CI only (Prisma engines cannot be downloaded in the build sandbox, D-26); GitHub CI green.

## 8. Risks

- The `Lead` migration is hand-written and only checked against Prisma in CI (D-41).
- The HubSpot Forms endpoint and payload follow HubSpot's documented v3 submission API but are not exercised against
  a live portal in this run (owner hand step, only if wanted).
- Standard PDF fonts cover Latin-1 only; other scripts in evidence text are replaced with `?` (D-37).
- In-memory login and gate limiters reset on restart; fine for one process (D-29), noted in DEPLOY.md.
