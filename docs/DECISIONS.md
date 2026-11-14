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
