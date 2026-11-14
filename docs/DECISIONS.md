# Crawlspace — decisions

Made by Claude on 2026-11-13 while Shane was away. Each is a default he can change.

| ID | Problem | Options | Decision | Change it |
|---|---|---|---|---|
| D-01 | Base | (a) standalone Next.js, (b) saas-foundation clone | **(a)** — public tool, no accounts or orgs | (b) only if it becomes a multi-client product |
| D-02 | Rendering JS pages | (a) Playwright Chromium, (b) fetch only | **(a)** — the "readable without JS" check needs both views | none |
| D-03 | Storage | (a) SQLite via Prisma, (b) Postgres | **(a)** — single-node tool; swap the Prisma provider later | change `datasource` |
| D-04 | `llms.txt` weight | (a) low weight, labelled "proposed convention", (b) full weight, (c) omit | **(a)** — honest about adoption being unsettled | `rules/weights.json` |
| D-05 | Lead capture | (a) HubSpot form submission, demo-only, (b) none, (c) own table | **(a)** in Phase 4, behind an env flag, off by default | flip the flag |
| D-06 | Real-site examples in the repo | (a) only Shane-owned domains committed, (b) any public sites | **(a)** — publishing scores of other companies' sites is a reputational call for you to make | add sites to `examples/` |
| D-07 | AI user-agent list | (a) data file with a "last verified" date, (b) hard-coded | **(a)** — names change; the file is the thing to update | edit `rules/agents.json` |
| D-08 | Deploy target | (a) not deployed in v1, (b) Vercel (Playwright needs a separate worker) | **(a)** — Phase 4 writes the deploy notes | decide at Phase 4 |
| D-09 | How far the first unattended run goes | (a) stop after plan, (b) build Phase 1, stop at the Phase 2 gate | **(b)** — Phase 1 has no network or DB; cheap to redo | tell next session to redo |
| D-10 | AI agent list can't be verified in an offline run (kickoff: unverifiable agents are left out) | (a) ship `agents: []` plus an unverified `pendingVerification` list the engine ignores, (b) ship names from memory as verified, (c) web-search them despite "offline by design" | **(a)** — A2 returns N/A on real scans until entries are verified; fixtures use synthetic agents in `fixtures/agents.fixture.json` | move entries from `pendingVerification` to `agents` with `verifiedOn` + `source` (Phase 2, networked) |
| D-11 | How partial results and the overall score are computed | (a) pass 1 / partial 0.5 / fail 0, overall weighted over all applicable checks, rounded to 0.1, (b) overall = mean of category scores | **(a)** — a category with one check would otherwise weigh as much as Access; N/A dropped from numerator and denominator (CS-05) | `statusValues` in `rules/weights.json`; aggregation in `src/lib/score.ts` |
| D-12 | Thresholds for v1 checks (no PRD numbers) | pick defaults now vs. leave TBD | **Defaults:** sitemap fresh ≤ 90 days; B2 text in raw ≥ 90% pass / ≥ 50% partial; TTFB ≤ 800 ms / ≤ 1800 ms; HTML ≤ 500 KB / ≤ 1.5 MB; forms 100% / ≥ 50% labelled | constants at the top of each check file |
| D-13 | Time-relative checks (sitemap freshness) vs. determinism (CS-01) | (a) measure against the snapshot's `fetchedAt`, (b) against `Date.now()` | **(a)** — same snapshot, same answer, forever | none expected |
| D-14 | Which view each check reads | (a) B/C/D read raw HTML (no-JS agents), E reads the rendered DOM (browser agents act there), render-only data scores partial, (b) everything on rendered | **(a)** — matches how the two kinds of agent actually see the site | per check file |
| D-15 | Key pages behind a bot wall (403/challenge) | (a) count as "nothing found" in B1/C2/E1 as well as failing A4, (b) exclude them from content checks | **(a)** — that is what an agent experiences; double-counting is bounded because A4 is partial unless the home page is walled | `buildContext` in `src/lib/checks/types.ts` |
| D-16 | HTML parser for the engine | (a) cheerio, (b) node-html-parser, (c) jsdom | **(a)** — mature, fast, no JS execution (rendering is Phase 2's Playwright job) | swap in `src/lib/html.ts` |
