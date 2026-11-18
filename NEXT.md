# Crawlspace — next

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
