# Crawlspace

Agent-readiness scanner: point it at a site, get a scorecard of how well AI agents can read and act on it, plus a ranked fix list.

Build-log #25. Status: **Phase 4 (lead capture, operator page, PDF export, deploy notes)** on top of Phases 1–3 (engine, crawler, web UI), plus the **design pass** (Claude Design look from `docs/design/`, gap screens, design/UX/accessibility review; PRD §9). Not deployed (see `docs/DEPLOY.md`). Spec in `docs/PRD.md`, plans in `docs/PHASE1_PLAN.md` … `docs/PHASE4_PLAN.md`, decisions in `docs/DECISIONS.md`, hand-off in `NEXT.md`.

```bash
npm install                            # also runs `prisma generate`
npm run dev                            # web UI on http://localhost:7900 (SQLite file in ./data)
npm run scan yoursite.com              # same scan from the command line
npm run scan yoursite.com -- --save examples/yoursite   # also keep the snapshot
npm run scan:fixture good-shop         # table + JSON scorecard for a synthetic site
npm run lint && npm run typecheck && npm test
npm run build && npm run e2e           # Playwright: scans local fixture sites through the production build
npm run demo                           # build + the app with local fixture sites (see "Demo script")
```

The web UI and the CLI share one path (`scanUrl` in `src/lib/crawl/pipeline.ts`): SSRF guard, polite crawl (CrawlspaceBot, robots.txt, ≤ 15 pages, 1 req/s per host, GET only), sandboxed headless Chromium, then the 18 checks and scoring. Scans run one at a time in the app process and are stored with their report in SQLite via Prisma (`prisma/schema.prisma`).

## Fix list

Failed and partial checks become a ranked fix list (`src/lib/fixlist/`). With `ANTHROPIC_API_KEY` set, Claude writes it and a validator drops any suggestion that cites a check ID or URL the scan did not produce (CS-04); the report says how many were dropped. Without a key, or if the model fails, each check gets its plain-English template.

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_FILE` | `./data/crawlspace.db` | SQLite file (created and migrated on start) |
| `ANTHROPIC_API_KEY` | unset → templates | enables the AI-written fix list |
| `CRAWLSPACE_FIXLIST_MODEL` | `claude-sonnet-4-5` | model for the fix list (D-31) |
| `CRAWLSPACE_OPERATOR_PASSWORD` | unset → `/operator` off | operator page password, at least 12 characters (D-39) |
| `CRAWLSPACE_HUBSPOT_ENABLED` | unset → off | `1` also submits PDF-gate emails to a HubSpot form (D-05, D-36) |
| `HUBSPOT_PORTAL_ID`, `HUBSPOT_FORM_GUID` | unset | the HubSpot form, needed only when the flag is `1` |

No variable can relax the SSRF guard (D-23, D-27).

Fixtures live in `fixtures/sites/<name>/` (raw + rendered HTML, robots.txt, sitemap, llms.txt, `expected.json`); recorded model replies for tests in `fixtures/llm/`. Weights are data: `rules/weights.json`. The AI user-agent list (`rules/agents.json`) only holds entries verified against official docs; it is empty until verified (D-10), so A2 shows N/A on real scans.

## Report, PDF and leads (Phase 4)

The report page shows the overall score over 100 and an A–F grade per category (A 90+, B 80+, C 70+, D 60+, F below; D-34), with Lab Intelligence branding (D-33). The report on screen is free. Downloading it as a PDF asks for an email address only (D-35): the email is stored with the scan in SQLite (`Lead` table), and, only if `CRAWLSPACE_HUBSPOT_ENABLED=1`, also sent to a HubSpot form; a HubSpot failure is recorded on the lead and never blocks the PDF (D-36). The PDF is drawn with pdf-lib from the stored report, no browser involved (D-37).

## Operator page

`/operator`, password from `CRAWLSPACE_OPERATOR_PASSWORD`, no accounts (D-39). It lists submitted scans (score, grades, lead count), the latest leads and whether HubSpot is on; each scan can be opened, rerun (a new scan of the same URL through the normal guarded path; the old one is kept) or downloaded as a PDF; scans and leads export as CSV (D-40).

## Deploy

Not deployed in v1 (D-08). `docs/DEPLOY.md` lists the options, the work each needs and a pre-launch checklist.

## Demo script

A reviewer can run this on any machine with Node 22; it needs no internet after `npm ci`, no keys, and scans only synthetic fixture sites served on 127.0.0.1 (the same harness the e2e tests use, D-27, D-32). HubSpot is forced off in the demo.

1. Install and start:
   ```bash
   npm ci
   npx playwright install chromium     # once, if Chromium for Playwright 1.63.0 is not installed yet
   npm run demo                        # builds, then serves the app on http://127.0.0.1:7901
   ```
   Wait for the line `operator page /operator, password: crawlspace-demo-operator`. The database is a fresh temp file each run.
2. Open http://127.0.0.1:7901, enter `http://walledshop.test:7911/` and press **Scan my site**. The progress box shows while the polite crawl runs (about 10 seconds).
3. Read the report: the overall score over 100 with a readiness word, a letter grade on each of the six categories, "Lab Intelligence / Crawlspace" at the top and the address in the footer. The fix list says 3 AI suggestions were dropped (a recorded model reply that invents things; CS-04).
4. At the bottom, under **Take this report to your team**, try `not-an-email` (refused: "Check the address."), then enter any address such as `reviewer@example.com` in **Work email** and press **Download PDF**. Open the file: branded header and footer on every page, the score over 100, the grades, the fix list and every check.
5. Scan `http://goodshop.test:7911/` too: every applicable check passes and the fix list says there is nothing to fix.
6. Open http://127.0.0.1:7901/operator. Try a wrong password (refused), then sign in with `crawlspace-demo-operator`. Both scans are listed (plus any earlier ones in this run) with their score, grades and lead count; your email is under **Latest leads** with HubSpot `off`.
7. Press **Rerun** on a scan, then **Open the new scan**: a new report for the same URL; back on `/operator` both scans are listed.
8. Press **Export scans (CSV)** and **Export leads (CSV)**, and **PDF** on a row (the operator's copy skips the email gate). Press **Sign out**.
9. Stop the demo with Ctrl+C.

To try a real site instead, use `npm run dev` (port 7900, file DB in `./data`) and scan a site you own (D-06); set `CRAWLSPACE_OPERATOR_PASSWORD` to use `/operator` there.
