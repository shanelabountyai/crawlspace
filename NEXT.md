# Crawlspace — next

## Deploy files for Render (scheduled run, 2026-11-19, branch `deploy/render`)

The owner chose Render on 2026-11-18 (D-08 settled, D-65). This run added the deploy files as one draft PR
("Crawlspace: Dockerfile and Render blueprint (not deployed)"). **Nothing was deployed**: no Render account, API or
CLI was touched, no environment variable or secret was set anywhere, and `render.yaml` holds no secret values.

- **Added:** `Dockerfile` + `.dockerignore` (Node 22 bookworm, Chromium for the locked Playwright, one process, D-66);
  `scripts/docker-entrypoint.sh` (listens on `0.0.0.0:$PORT`, 7900 when unset; the app runs as non-root `node`;
  D-67, D-68); `GET /api/health` with a unit test and an e2e (D-69); `render.yaml` (one Docker web service, one
  instance, no autoscaling, disk at `/data`, `DATABASE_FILE=/data/crawlspace.db`, health check `/api/health`,
  auto-deploy `"off"`, four secret keys without values; D-70); a `docker` job in CI plus `scripts/docker-smoke.sh`
  (D-71); `docs/DEPLOY.md` "Render" section; decisions D-65..D-73.
- **Not changed:** scoring, checks, D-34 bands, schema, SSRF guard, existing JSON API contracts, `package.json`
  scripts (`npm start` is still port 7900), the `check` job's steps. No test deleted, skipped or weakened.
- **Local gate:** `npm ci` (Prisma schema engine stubbed, D-26), lint, typecheck, `npm test` 347/347 (24 files),
  build, e2e 16/16: all exit 0. `scripts/check-migrations.sh` cannot run here (D-26); CI decides it. No schema change.
- **Docker in the sandbox:** the image could **not** be built here (a Docker daemon starts, but the sandbox proxy
  refuses pulls from Docker Hub and Prisma's engine download). The image is verified only by the new CI job. The
  entrypoint script itself was run here against the local build: port 10000 honoured, app as `node`, database created
  in a root-owned directory, health route and home page 200, health route did not create the database.
- **CI on the PR:** first push (1c6a0cf): `docker` failed at step 6 of the new smoke script (a wrong `docker top`
  call in the script; the image had built, Chromium had launched and both pages had answered 200) and `check` failed
  on one e2e, 15 of 16 passed (see the flake below). Second push (664a703): `check` success (e2e 16/16, migrations
  match), `docker` success (all 7 smoke steps). The result for the final commit is in the PR description.
- **Flake seen once, not fixed (D-74):** on 1c6a0cf `e2e/a11y.spec.ts:29` failed with axe `document-title (serious)`
  on the report in light mode. The same test passed on main (eccd4c3), locally, and on the next push with no change to
  the page or the test. It is design-pass code this run may not touch. If it comes back, look at the moment the
  report page swaps from progress to report (`generateMetadata` in `src/app/scans/[id]/page.tsx`); that cause is a
  guess, not a finding.

**Operator sign-in caveat (carry this forward).** The Phase 4 review's operator-login should-fix items below
("Review run", items 1, 2 and 5: limiter checked before the body is read, one global lockout counter, session token
keyed directly by the password) are **still open**, and D-44 says to revisit them before any deploy. They were out of
scope for this run. **Recommendation: leave `CRAWLSPACE_OPERATOR_PASSWORD` unset on Render (operator page off) until
they are fixed** (D-72). Item 3 (`?pdf=` text on the page, and `/operator?error=`) was checked: the design pass
already fixed it (D-61; codes map to fixed sentences in `src/lib/report/words.ts`, tested in
`tests/unit/present.test.ts` and `e2e/scan.spec.ts`).

**Not verified** (full list with reasons in `docs/DEPLOY.md` "Not verified", 10 items): outbound connections from
Render to arbitrary hosts and ports (D-22; Render's docs only say port 25 is blocked); the image building and running
on Render itself; who owns the disk mount; memory on any instance type; shared memory / init for Chromium on Render;
the minimum disk size; Blueprint creation details (empty `sync: false` values, first deploy with auto-deploy off);
the `x-forwarded-proto` header on Render; prices (none quoted); the migration drift check (CI only).

**Shane's hand steps, in order** (details in `docs/DEPLOY.md` "The owner's steps"):

1. Review the draft PR; merge it once both CI jobs are green. Claude does not merge.
2. In Render, create a Blueprint from this repository (`render.yaml`).
3. Pick a paid instance type (a disk needs one); check the price that day.
4. Set the secrets: leave `CRAWLSPACE_OPERATOR_PASSWORD` unset; `ANTHROPIC_API_KEY` optional; HubSpot IDs unset.
5. Start the first deploy (auto-deploy is off).
6. Check `https://<service>.onrender.com/api/health` → 200 `{"status":"ok"}`.
7. Run one scan of a site you own; restart the service; open the report again (proves Chromium, outbound, disk).
8. Sign in to `/operator` only after items 1, 2 and 5 are fixed and deployed.
9. Set up SQLite backups (the file holds lead emails).

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

- No deploy. (The Dockerfile and `render.yaml` came later: see the top section, D-65.)
- No double opt-in or emailed reports (D-38); no lead deletion UI (delete rows in SQLite if someone asks).
- The `Lead` migration is hand-written; Prisma's own check runs only in CI (D-41).
- Limiters (login, PDF gate) and the scan queue are in memory: one process only.
- Non-Latin-1 text in the PDF is replaced with `?` (standard fonts).
