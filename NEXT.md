# Crawlspace — next

## Backlog from the 2026-11-20 review (approved 2026-11-20, D-101)

In order. Each PRD is in `docs/prds/` (index: `docs/prds/README.md`), status Proposed; none is started.

1. You: rank 1, the live smoke test (scan a site you own that needs JavaScript, PDF, restart, reopen).
2. You: Decision 6a, set `CRAWLSPACE_TRUSTED_PROXY_HOPS` (`docs/DEPLOY.md`); PRD-03 depends on it.
3. Rank 9 (Decision 4b): move the PDF panel to just after "Fix these first" (no new copy; small).
4. PRD-01 Headless browser isolation (SEC-2; SEC-1 is done in PR #12).
5. PRD-02 Crawl correctness and politeness (needs your OK on scoring-adjacent behaviour).
6. PRD-03 Abuse limits, capacity and retention (limit numbers are yours).
7. PRD-04 Report and fix-list copy (wording is yours).
8. PRD-05 Visual and accessibility polish.
9. PRD-06 Demo script and dogfood assets.
10. Chores: SEC-7 (`prisma` CLI to devDependencies), CQ-11, NEXT item 7b.

## Closeout follow-up: five-lens review and must-fix fixes (scheduled run, 2026-11-20, branch `closeout/2026-11-19`)

One draft PR ("Crawlspace: closeout pack + five-lens review (docs)"), not merged. **Nothing was deployed**; no hosting
account, environment variable or secret was touched. Last night's run wrote the closeout docs (D-82..D-87) and stopped
on its usage limit before the review; this run did the review and the PR.

- **Review:** five lenses (UX/demo, design, accessibility, security, code/tests) by agents that had not seen the
  closeout work, then a product-owner agent ranked everything: `docs/REVIEW-2026-11-20.md`. 48 findings (0 Blocker,
  15 Major, 33 Minor) → 34 work items: **13 must-fix, 12 should-fix, 9 later**. No PRDs written (they need your OK).
- **Fixed here (7 must-fix, each with a test that failed first):** scan queue race (D-92), cubic PDF line wrapping
  (D-93), start-up failure cached until restart (D-94), unbounded POST bodies (D-95), security headers without a
  script CSP (D-96), evidence glued to its URL and the "Every check" scroll box unreachable by keyboard at 200% zoom
  (D-97). Links to the missing review file in `docs/DEMO.md` and `docs/RELEASE_NOTES.md` now point at the review (D-98).
- **Not changed:** scoring, checks, D-34 bands, SSRF guard, crawler, schema. No test deleted, skipped or weakened.
- **Local gate (D-99):** `npm ci` (Prisma schema engine stubbed, D-26), lint, typecheck, `npm test` 412/412 (27 files;
  was 405 in 26), build, e2e 21/21 (was 18): all exit 0. The same gate on the branch before the fixes: all exit 0,
  405/405 and 18/18, so nothing was already failing. `scripts/check-migrations.sh` and the Docker image cannot run
  here (D-26, D-71); CI decides them.
- **Not verified:** anything on the live site beyond read-only GETs (no scan, PDF or operator flow; no live headers);
  which commit Render serves; Chromium on Render; the exec brief's contents (D-98); real fonts, Safari, a screen reader.
- **Still open, highest first:** rank 2 (WebRTC can reach private addresses from the scanner's browser; crawler code,
  so not done here), ranks 7-9 (copy), rank 10 restructure, then the should-fix list in the review.

**Your hand steps, in order:**

1. You: review the draft PR; merge it once both CI jobs are green. Claude does not merge.
2. You: deploy that commit on Render, then run one full scan of a site you own that needs JavaScript on
   https://crawlspace.onrender.com, download its PDF, restart the service and reopen the report (review rank 1).
   Check that B and E results look rendered.
3. You: check `curl -sI https://crawlspace.onrender.com/` shows the new headers and no `X-Powered-By`.
4. You: answer the 11 decisions in `docs/REVIEW-2026-11-20.md`, at least 2, 3, 4 and 8 before the demo or the post;
   then ask for the rank 2 fix as its own small run, and for the PRDs.
5. You: open the exec brief (https://claude.ai/artifact/FDRk4Cu9K2U8o6usqr3iKH) and check its verdict matches the
   review (D-98).
6. You: still open from the closeout: click through `docs/DEMO.md` and change its marks (D-87); edit the LinkedIn drafts;
   read the Render bill into `docs/RELEASE_NOTES.md` (D-85); the `CRAWLSPACE_TRUSTED_PROXY_HOPS` step (`docs/DEPLOY.md`).

## Operator-login fixes (scheduled run, 2026-11-19, branch `fix/operator-login`)

One draft PR ("Crawlspace: operator-login fixes (limiter race, lockout, session token)"), not merged. **Nothing was
deployed**; no hosting account, environment variable or secret was touched. It fixes the three operator-login items
that kept `/operator` off (D-44, D-72), so the page can be turned on once this is merged and deployed.

- **Item 1, limiter race (D-76):** "is this address full?", the password comparison and the count are now one
  synchronous step after the body is read. 40 wrong passwords sent at once: 10 compared, 30 refused unchecked.
- **Item 2, lockout (D-77, D-78):** one limit per client address instead of one for everybody; after 50 wrong
  passwords from all addresses in 15 minutes, checks slow to one a second in an ordered, bounded line. **This needs
  `CRAWLSPACE_TRUSTED_PROXY_HOPS`, which is unset by default** because the right number for Render is not documented
  and a number that is too high is worse than none. Until Shane sets it (hand step 3), anyone can still keep the
  operator locked out with 10 wrong passwords every 15 minutes; guessing stays bounded either way.
- **Item 5, session token (D-79):** signed with a random key that lives only in the running process, not with the
  password. A restart or deploy signs the operator out; signing out ends the session everywhere. No new secret.
- **Item 7, first half:** tests drive the login route's 429 path (JSON and form).
- **Also in the PR:** sign-in bodies over 8,192 bytes refused unread; a malformed cookie is 401 instead of an error;
  `GET /api/operator/client-address` (signed in only) to find the proxy number; the sign-in page has a fixed
  "Sign-in is busy" sentence (D-80).
- **Security review (D-81):** two passes by agents that had not seen the work. Pass 1: 3 must-fix, all fixed by a
  redesign with tests. Pass 2: 0 must-fix. The rest is listed in the PR.
- **Not changed:** scoring, checks, D-34 bands, the SSRF guard, the crawler, the public scan/report/PDF flow,
  the schema (no migration), `tests/unit/single-path.test.ts`. No test deleted, skipped or weakened; the existing
  operator tests are untouched.
- **Local gate:** `npm ci` (Prisma schema engine stubbed, D-26), lint, typecheck, `npm test` 405/405 (26 files; was
  347 in 24), build, e2e 18/18 (was 17): all exit 0. `scripts/check-migrations.sh` cannot run here (D-26); CI decides
  it. Docker cannot build here (D-71); the `docker` CI job decides the image. CI results are in the PR description.
- **Residual risk:** `docs/DEPLOY.md` "Operator sign-in" lists six items; D-77 to D-79 have the reasoning.
- **Still open from the review list below:** item 4 (PDF-gate rate limit), item 6 (`single-path.test.ts` allowlist,
  needs the owner's OK), item 7 second half (PDF "deterministic bytes" test).

**Shane's hand steps for this PR:**

1. Review the draft PR; merge it once both CI jobs are green. Claude does not merge.
2. Deploy that commit on Render, then set a long random `CRAWLSPACE_OPERATOR_PASSWORD` (12 characters or more) and
   sign in once over HTTPS; check the `cs_op` cookie is `Secure` and `HttpOnly`.
3. Follow `docs/DEPLOY.md` "Finding `CRAWLSPACE_TRUSTED_PROXY_HOPS` on Render" (about ten minutes, signed in). Until
   then the sign-in limit is shared by all addresses.
4. Expect to sign in again after every deploy or restart.

## Report title fix (2026-11-19, branch `fix/report-title-race`)

PR #7 (deploy files) was merged by Claude on the owner's instruction on 2026-11-19; nothing is deployed. CI on the merge
commit (1536017) was red on `check`: the a11y e2e noted as a flake in D-74 failed again. Diagnosed and fixed (D-75):
with Next's streaming metadata, the report appeared for about 300 ms with no page title when progress refreshed into
the report. `next.config.ts` now turns streaming metadata off; the old test is unchanged and a new e2e watches for a
title-less moment. Left alone: a 2 to 5 ms moment without a title when the form navigates to the progress page.

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

**Operator sign-in (was: caveat).** The Phase 4 review's operator-login items 1, 2 and 5 are fixed on
`fix/operator-login` (D-76, D-77, D-79; see the top section). What is true now: the limit holds for requests that
arrive together; a stolen cookie gives no way to test password guesses offline; a restart, a deploy, a password change
or signing out ends the session. What remains: per-address limiting, and with it protection against being locked out
by someone else, starts only when `CRAWLSPACE_TRUSTED_PROXY_HOPS` is set after a check on Render (D-78); during a
flood from many networks sign-in can answer "busy"; a copied cookie works until it expires (12 h), sign-out or a
restart. **`CRAWLSPACE_OPERATOR_PASSWORD` may be set once that PR is merged and deployed, not before.** Item 3
(`?pdf=` text on the page, and `/operator?error=`) was already fixed by the design pass (D-61; codes map to fixed
sentences in `src/lib/report/words.ts`, tested in `tests/unit/present.test.ts` and `e2e/scan.spec.ts`).

**Not verified** (full list with reasons in `docs/DEPLOY.md` "Not verified", 10 items): outbound connections from
Render to arbitrary hosts and ports (D-22; Render's docs only say port 25 is blocked); the image building and running
on Render itself; who owns the disk mount; memory on any instance type; shared memory / init for Chromium on Render;
the minimum disk size; Blueprint creation details (empty `sync: false` values, first deploy with auto-deploy off);
the `x-forwarded-proto` header on Render; prices (none quoted); a full scan inside the image (CI only proves Chromium
launches there). Item 11, added by the operator-login run: what `X-Forwarded-For` holds on Render.

**Shane's hand steps, in order** (details in `docs/DEPLOY.md` "The owner's steps"):

1. Review the draft PR; merge it once both CI jobs are green. Claude does not merge.
2. In Render, create a Blueprint from this repository (`render.yaml`).
3. Pick a paid instance type (a disk needs one); check the price that day.
4. Set the secrets: `CRAWLSPACE_OPERATOR_PASSWORD` only if the deployed commit has the operator-login fixes (else
   leave it unset); `CRAWLSPACE_TRUSTED_PROXY_HOPS` empty; `ANTHROPIC_API_KEY` optional; HubSpot IDs unset.
5. Start the first deploy (auto-deploy is off).
6. Check `https://<service>.onrender.com/api/health` → 200 `{"status":"ok"}`.
7. Run one scan of a site you own; restart the service; open the report again (proves Chromium, outbound, disk).
8. Sign in to `/operator` (items 1, 2 and 5 are fixed on `fix/operator-login`: deploy that first), then find and set
   `CRAWLSPACE_TRUSTED_PROXY_HOPS` (`docs/DEPLOY.md`).
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
on this PR (D-47): the limiter returns the granted start time and the fetcher logs it. Should-fix, to do before any deploy
(status as of the operator-login run, 2026-11-19: 1, 2, 5 and the first half of 7 **done** on `fix/operator-login`;
3 **done** earlier; 4, 6 and the second half of 7 **still open**):

1. Login limiter: `blocked()` runs before the body is read and `fail()` after, so concurrent requests skip the 10/15 min
   limit (`src/app/api/operator/login/route.ts:15-23`). **Done: D-76.**
2. Login limiter is one global counter checked before the password: anyone can keep the operator locked out.
   **Done: D-77, D-78** (per-address limiting takes effect once `CRAWLSPACE_TRUSTED_PROXY_HOPS` is set).
3. `/scans/<id>?pdf=<text>` shows arbitrary text in the alert box on the branded page (escaped, not XSS); use error codes.
   Same pattern on `/operator?error=`. **Done earlier: D-61.**
4. PDF-gate rate limit is count-then-insert without a transaction; concurrent posts can exceed 10/scan/hour. **Still open.**
5. Session token is HMAC keyed directly by the password: a stolen cookie allows an offline dictionary attack. **Done: D-79.**
6. `single-path.test.ts` allowlist widened to include `hubspot.ts` (D-42): needs the owner's explicit OK. **Still open.**
7. No test drives the login route's 429 path; the PDF "deterministic bytes" test compares extracted text, not bytes.
   **First half done** (`tests/server/operator-login-route.test.ts`); **second half still open.**

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
