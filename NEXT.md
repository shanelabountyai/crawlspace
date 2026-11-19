# Crawlspace — next

## Design pass (scheduled run, 2026-11-18, branch `design/impl`)

Built the Claude Design look (`docs/design/`) into every page, designed and built the gap screens, ran three
independent reviews (design fidelity, UX, accessibility) and fixed what they found. Presentation only: scores, D-34
bands, checks, schema and JSON API contracts unchanged. One PR, not merged.

- **Built:** tokens light + dark (D-48), header/footer with the canvas mark (D-54), scan form, progress, report
  (desktop + 390 px), PDF panel, scan stopped / robots finding, not-found, operator sign-in / turned off / signed in,
  PDF restyle (D-57, D-64).
- **Gap artboards added:** Operator, OperatorSignIn, LeadStates, ScanOutcomes, PdfReport (in `canvas.json`).
- **Left out on purpose:** site-type picker (D-51, needs an API field), per-page progress (D-50), "Up to +N" gains
  (D-53), emailed PDF (D-52).
- **Review fixes:** D-60..D-64; PRD §9 DR-1..DR-12. axe: 0 violations on 9 screens in light and dark (`e2e/a11y.spec.ts`).
- **Not fixed (listed in the PR):** A2 evidence names `rules/agents.json` (engine text); operator failed rows don't
  show the reason (needs `listScans` to return `error`); px font sizes, not rem; scores keep one decimal (D-34).
- **Local gate:** npm ci, lint, typecheck, npm test 344/344, build, e2e 15/15 all exit 0. `scripts/check-migrations.sh`
  can't run here (Prisma schema engine stubbed, D-26), so CI decides it; no schema change in this pass.

**Shane's hand steps:** open the Design canvas (https://claude.ai/artifact/YWkK9NBQxuzFhvWeVhVU45) and add the five gap
artboards if you want them there; run the README demo; review the PR; merge or not.

Written at the end of the Phase 4 run (2026-11-18, branch `phase-4`, PR "Crawlspace Phase 4: lead capture, operator
page, PDF export, deploy notes"). Phases 1–4 of PRD §8 are built; nothing is deployed.

## What Phase 4 built

- Report page: overall score shown over 100, an A–F grade per category (A 90+, B 80+, C 70+, D 60+, F below), Lab
  Intelligence branding in the header and footer (D-33, D-34). Scores, weights and checks unchanged.
- PDF export (pdf-lib, no browser, D-37): branded header/footer with the business address and page numbers on every
  page, score, grades, fix list, every check with evidence, crawl summary.
- Email gate in front of the PDF only (D-35, D-38): email stored locally in SQLite (`Lead` table, new migration);
  optional HubSpot Forms submission behind `CRAWLSPACE_HUBSPOT_ENABLED=1`, off by default, tested only with a mocked
  HTTP client (D-36).
- Operator page `/operator` (password env var, no accounts, D-39): scans with score, grades and lead count; latest
  leads; rerun; CSV export of scans and leads; ungated PDF per scan (D-40).
- `docs/DEPLOY.md`: runtime needs, three options with the work each needs, a pre-launch checklist (D-43).
- README: status, env vars, demo script (the Phase 4 gate); `npm run demo`.

## Review run (scheduled, 2026-11-18)

An independent review of the PR found 0 must-fix, 7 should-fix, 7 nits (D-44). CI then exposed **1 must-fix the review
missed**, now fixed: scan ids starting with "-" (≈ 1 in 64) were exported as `'-…` by the CSV formula guard, so
`scan_id` in the CSVs matched no scan (D-46; `newScanId()` no longer emits a leading "-"; test in `csv.test.ts`). Gate re-run on
5360a42: `npm ci` (Prisma schema-engine stubbed, D-26), lint, typecheck, `npm test` 335/335 after the fix, build, e2e 7/7 — all exit 0.
CI on b200f46: pull_request run green, push run red on a CS-02 timing race in Phase 2 code (999 ms gap; D-45). Fixed
on this PR (D-47): the limiter returns the granted start time and the fetcher logs it. Should-fix, to do before any deploy:

1. Login limiter: `blocked()` runs before the body is read and `fail()` after, so concurrent requests skip the 10/15 min
   limit (`src/app/api/operator/login/route.ts:15-23`).
2. Login limiter is one global counter checked before the password: anyone can keep the operator locked out.
3. `/scans/<id>?pdf=<text>` shows arbitrary text in the alert box on the branded page (escaped, not XSS); use error codes.
   Same pattern on `/operator?error=`.
4. PDF-gate rate limit is count-then-insert without a transaction; concurrent posts can exceed 10/scan/hour.
5. Session token is HMAC keyed directly by the password: a stolen cookie allows an offline dictionary attack.
6. `single-path.test.ts` allowlist widened to include `hubspot.ts` (D-42): needs the owner's explicit OK.
7. No test drives the login route's 429 path; the PDF "deterministic bytes" test compares extracted text, not bytes.

## Owner hand steps

1. Review the PR; run the README **Demo script** locally (`npm ci && npm run demo`).
2. Merge or not. Claude does not merge.
3. Only if wanted: create a HubSpot form with an `email` field, set `CRAWLSPACE_HUBSPOT_ENABLED=1`,
   `HUBSPOT_PORTAL_ID`, `HUBSPOT_FORM_GUID`, submit one test email and confirm it lands in HubSpot (never exercised live).
4. Decide D-08 (where to deploy) using `docs/DEPLOY.md`, and the wording under the email field (privacy line).
5. Still open from earlier phases: one live scan of a Shane-owned site into `examples/` (D-18); verify AI user agents
   into `rules/agents.json` (D-10); set `ANTHROPIC_API_KEY` once to see the AI-written fix list (D-25).

## Not done / left for later

- No deploy, no Dockerfile (D-43); option A in DEPLOY.md lists the work.
- No double opt-in or emailed reports (D-38); no lead deletion UI (delete rows in SQLite if someone asks).
- The `Lead` migration is hand-written; Prisma's own check runs only in CI (D-41).
- Limiters (login, PDF gate) and the scan queue are in memory: one process only.
- Non-Latin-1 text in the PDF is replaced with `?` (standard fonts).
