# Crawlspace

Agent-readiness scanner: point it at a site, get a scorecard of how well AI agents can read and act on it, plus a ranked fix list.

Build-log #25. Status: **Phase 3 (web UI, report, fix list, SQLite)** on top of the Phase 1 engine and Phase 2 crawler. Spec in `docs/PRD.md`, plans in `docs/PHASE1_PLAN.md`, `docs/PHASE2_PLAN.md`, `docs/PHASE3_PLAN.md`, decisions in `docs/DECISIONS.md`.

```bash
npm install                            # also runs `prisma generate`
npm run dev                            # web UI on http://localhost:7900 (SQLite file in ./data)
npm run scan yoursite.com              # same scan from the command line
npm run scan yoursite.com -- --save examples/yoursite   # also keep the snapshot
npm run scan:fixture good-shop         # table + JSON scorecard for a synthetic site
npm run lint && npm run typecheck && npm test
npm run build && npm run e2e           # Playwright: scans local fixture sites through the production build
```

The web UI and the CLI share one path (`scanUrl` in `src/lib/crawl/pipeline.ts`): SSRF guard, polite crawl (CrawlspaceBot, robots.txt, ≤ 15 pages, 1 req/s per host, GET only), sandboxed headless Chromium, then the 18 checks and scoring. Scans run one at a time in the app process and are stored with their report in SQLite via Prisma (`prisma/schema.prisma`).

## Fix list

Failed and partial checks become a ranked fix list (`src/lib/fixlist/`). With `ANTHROPIC_API_KEY` set, Claude writes it and a validator drops any suggestion that cites a check ID or URL the scan did not produce (CS-04); the report says how many were dropped. Without a key, or if the model fails, each check gets its plain-English template.

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_FILE` | `./data/crawlspace.db` | SQLite file (created and migrated on start) |
| `ANTHROPIC_API_KEY` | unset → templates | enables the AI-written fix list |
| `CRAWLSPACE_FIXLIST_MODEL` | `claude-sonnet-4-5` | model for the fix list (D-31) |

No variable can relax the SSRF guard (D-23, D-27).

Fixtures live in `fixtures/sites/<name>/` (raw + rendered HTML, robots.txt, sitemap, llms.txt, `expected.json`); recorded model replies for tests in `fixtures/llm/`. Weights are data: `rules/weights.json`. The AI user-agent list (`rules/agents.json`) only holds entries verified against official docs; it is empty until verified (D-10), so A2 shows N/A on real scans.
