# Crawlspace — Claude Code kickoff

`main` holds this kit. Phase 1 builds on `kickoff` (PR #1, never merged by Claude); later phases on `phase-N`.

## Session prompt — Phase 1

```text
You are building Crawlspace (build-log #25), an agent-readiness scanner. Repo shanelabountyai/crawlspace; `main`
holds docs/PRD.md, docs/DECISIONS.md, docs/KICKOFF.md. Read all three first. DECISIONS.md rows are in force; when
you hit a new decision, pick the option you'd recommend, append a row (problem, options, decision, how to change
it) and keep going. Never stop to ask.

Phase 1 only — pure engine, no network, no database (branch `kickoff` off main):
  1. Scaffold: Next.js 16 (App Router, TypeScript strict), vitest, eslint, Node 22, port 7900 in package.json
     scripts. GitHub Actions CI: lint, typecheck, test.
  2. Write docs/PHASE1_PLAN.md first (snapshot shape, check list with IDs and weights, fixture sites and their
     expected scores, risks). Commit it and open PR #1 "Crawlspace Phase 1: pure engine" against main. Keep it
     unmerged.
  3. Build per PRD §3 and §6: src/lib/snapshot (zod type + disk loader), src/lib/checks (one file per check, pure,
     each returns status + evidence + weight; registry.ts), src/lib/score.ts, rules/weights.json, rules/agents.json
     (each user agent with the date you last verified it and a source URL; if you cannot verify one from an
     official source, leave it out and note that in the PR).
  4. fixtures/sites/: at least 8 synthetic sites as static files (raw HTML + rendered HTML + robots.txt etc., i.e.
     a snapshot on disk), each with expected.json. Cover: good shop, JS-only shop, AI-bot-blocking shop, shop with
     broken JSON-LD, good event page, event page with CAPTCHA-first registration, event page missing startDate,
     "other" site where ecommerce/event checks are N/A.
  5. CLI: npm run scan:fixture <name> prints the scorecard as a table and JSON.
  6. Tests: every fixture matches expected.json; CS-01 (run each check twice, identical output), CS-05.
  7. Gate: lint, typecheck, test green. PR body: checks built, fixture results, new DECISIONS rows, anything you
     could not verify. Then stop. Do not start Phase 2.

Rules: no network calls in Phase 1 code or tests; no real company names in fixtures; never print a secret; if a
gate fails, stop and report rather than loosen the gate.
```

## Later phases

| Session | Scope | Stop condition |
|---|---|---|
| Phase 2 | crawler, politeness, SSRF guard, `npm run scan <url>` | PRD §8 Phase 2 gate |
| Phase 3 | web UI, report, fix list + validator, SQLite | Phase 3 gate |
| Phase 4 | lead capture flag, operator page, PDF, deploy notes | Phase 4 gate |
