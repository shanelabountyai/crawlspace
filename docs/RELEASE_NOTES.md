# Crawlspace — release notes

## 2026-11-19: first public release (closeout)

Crawlspace went live at https://crawlspace.onrender.com on 2026-11-19, deployed on Render by the owner (D-65). This
is the first closeout for this repo; there is no earlier one. Written by the scheduled closeout run on branch
`closeout/2026-11-19`, which changed documentation only.

### The pack

| Item | Where |
|---|---|
| Exec brief (non-technical) | https://claude.ai/artifact/FDRk4Cu9K2U8o6usqr3iKH (private Claude Docs document, "Crawlspace: exec brief (2026-11-19 launch)") |
| Demo walk-through | `docs/DEMO.md` |
| LinkedIn drafts (two) | `docs/LINKEDIN_DRAFTS.md`. Not posted, not added to the Lab Intelligence Ledger: that is an owner step |
| Five-lens review | `docs/REVIEW-2026-11-20.md` (run 2026-11-20; the 2026-11-19 run stopped on its usage limit before the review, D-98) |
| Cost review | below, and D-85 |
| Hand-off and owner steps | `NEXT.md`, top section |

### What is live

Main at 0d27886 (merge of PR #10) holds: the scan form, progress, report (score out of 100, A to F per category,
ranked fix list, all 18 checks with evidence), the PDF behind an email field, the operator page (off unless a password
is set), `GET /api/health`, the Dockerfile and `render.yaml`. **Which commit Render is serving was not verified**: the
dashboard was not read and auto-deploy is off in `render.yaml`.

### Live verification

Read-only GETs through the session's web-fetch tool, between 02:06 and 02:08 UTC on 2026-11-20 (8:06 to 8:08 PM
Central on 2026-11-19). One attempt each; no retry was needed. The tool converts pages to text and, for a refused
request, reports only "client error" (a 4xx answer) without the exact code or body. No form was submitted, no scan
started, no sign-in attempted.

| Route | Expected | Result |
|---|---|---|
| `/` | 200, the scan form | **200.** Title "Crawlspace". Heading "Can AI agents shop, book or buy on your site?", field "Website address", button "Scan my site", cards "What the scan does" and "What it never does". Header "Lab Intelligence / Crawlspace" |
| `/api/health` | 200 `{"status":"ok"}` | **200**, body exactly `{"status":"ok"}` |
| `/operator` | the "turned off" page (no password set) | **200.** Heading "Operator page turned off"; text "Set CRAWLSPACE_OPERATOR_PASSWORD (at least 12 characters) and restart to use it."; robots meta "noindex, nofollow" |
| `/this-route-should-not-exist-closeout` | 404 | **Client error (4xx).** Exact code and page body not shown by the tool |
| `/scans/closeout-no-such-scan` | 404, the not-found screen | **Client error (4xx).** Exact code and body not shown. The screen itself was seen locally only |
| `/api/scans/closeout-no-such-scan` | 404 | **Client error (4xx).** Exact code and body not shown |
| `/api/operator/client-address` | 404 while the operator page is off (D-39) | **Client error (4xx).** Exact code and body not shown |
| `/robots.txt` | not known (the app defines none) | **Client error (4xx).** The live site serves no robots.txt |

Not verified on the live site, and why:

- A full scan, the report, the email gate and the PDF: each needs a POST, and this run was read-only on the live
  site. All four were exercised locally (gate below).
- The report surviving a restart (`docs/DEPLOY.md` step 7): needs the Render dashboard.
- The footer text: it did not appear in the fetch tool's text version of the pages.
- The exact status codes of the refused routes: the tool does not show them.
- A phone, an in-app browser, a PDF opened from an inbox: owner steps.

### Local gate (main at 0d27886 plus this branch's documents)

Run in the agent sandbox on 2026-11-20 UTC, Node 22.23.5.

| Step | Result |
|---|---|
| `npm ci` | exit 0 with the Prisma schema engine stubbed (D-26). Without the stub the postinstall fails: `binaries.prisma.sh` is refused by the sandbox proxy |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0: 405 of 405 tests passed, 26 files |
| `npm run build` | exit 0 |
| `npm run e2e` | exit 0: 18 of 18 passed. axe reported 0 violations on every screen it checks, in light and dark |
| `scripts/check-migrations.sh` | not run here (D-26); CI runs it. No schema change on this branch |
| Docker image | not built here (D-71); the `docker` CI job decides it |

### Cost review (D-85)

**No bill was read and no figure was measured.** This run has no access to the Render account, so nothing below is an
amount. Date range that applies: 2026-11-19 (launch day) onward.

| Billable service | What the repo says exists | Measured figure |
|---|---|---|
| Render web service | `render.yaml`: one `type: web`, `runtime: docker` service named `crawlspace`, `numInstances: 1`, no scaling block. `plan` is left out on purpose: a new service gets the Blueprint spec's default `0.5c-512mb` unless the owner picked another in the dashboard (D-70). The instance type actually in use: not read | not read |
| Render disk | `render.yaml`: disk `crawlspace-data` at `/data`, `sizeGB: 1`. A disk needs a paid instance type (`docs/DEPLOY.md`) | not read |
| Anthropic API | Used only when `ANTHROPIC_API_KEY` is set (D-25; D-31 caps a reply at 2,000 tokens). Whether the key is set on Render: not read | not read |
| HubSpot | Off unless `CRAWLSPACE_HUBSPOT_ENABLED=1`, which `render.yaml` does not declare (D-36) | not read; no usage expected |
| GitHub Actions | `.github/workflows/ci.yml`: two jobs (`check`, `docker`) on every pull request and on pushes to main | not read |
| Domain | The service uses Render's `onrender.com` address; no custom domain is in the repo | none found |

New billable pieces this launch added: the Render web service and its disk. **You:** read the Render billing page and
write the instance type and the month-to-date charge here.

### References

- Decisions made by this run: `docs/DECISIONS.md` D-82 onward.
- Earlier work: `NEXT.md` (operator-login fixes, report title fix, deploy files, design pass, Phase 4).
