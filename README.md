# Crawlspace

Agent-readiness scanner: point it at a site, get a scorecard of how well AI agents can read and act on it, plus a ranked fix list.

Build-log #25. Status: **Phase 2 (crawler)** on top of the Phase 1 engine: a polite crawler (CrawlspaceBot, robots.txt, ≤ 15 pages, 1 req/s per host, GET only), SSRF guard and sandboxed headless Chromium feed the 18 checks. Spec in `docs/PRD.md`, plans in `docs/PHASE1_PLAN.md` and `docs/PHASE2_PLAN.md`, decisions in `docs/DECISIONS.md`.

```bash
npm install
npm run scan yoursite.com             # crawl a live site and score it
npm run scan yoursite.com -- --save examples/yoursite   # also keep the snapshot
npm run scan:fixture good-shop        # table + JSON scorecard for a synthetic site
npm run scan:fixture js-only-shop -- --json
npm run lint && npm run typecheck && npm test
npm run dev                            # placeholder page on http://localhost:7900
```

Fixtures live in `fixtures/sites/<name>/` (raw + rendered HTML, robots.txt, sitemap, llms.txt, `expected.json`). Weights are data: `rules/weights.json`. The AI user-agent list (`rules/agents.json`) only holds entries verified against official docs; it is empty until verified (D-10).
