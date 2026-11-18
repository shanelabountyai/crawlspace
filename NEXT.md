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
