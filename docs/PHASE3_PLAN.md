# Crawlspace — Phase 3 plan (web UI, report, fix list, SQLite)

Branch `phase-3` (off `main`, which holds Phases 1–2), PR "Crawlspace Phase 3: …" against `main`, never merged by Claude.
Scope is exactly PRD §8 row 3: **Web UI, report page, fix list (LLM + validator + fallback), SQLite storage**.
Gate: **e2e: scan a fixture site end to end; CS-04 green** — plus lint, typecheck, unit tests, CS-01..CS-05 and green CI.

Not in this phase (Phase 4): lead capture / HubSpot (D-05), operator page, PDF export, deploy notes.

## 1. One code path (CLI and web)

- New `src/lib/crawl/pipeline.ts` → `scanUrl(input, opts)` = `crawlSite` (SSRF guard, robots, politeness, renderer)
  + `scanSnapshot` (Phase 1 engine, `rules/weights.json`). `scripts/scan.ts` and the web scan service both call it;
  nothing else in `src/app`, `src/server` or `scripts/scan.ts` calls `crawlSite` or `scanSnapshot` directly
  (asserted by a test).
- The web service validates input with the same `normaliseStartUrl` + `assertAllowed` before it creates a row, so a
  refused URL (CS-03 targets) is answered with 400 and never queued.
- No env variable can widen the SSRF guard. The e2e harness injects test crawl options in-process (D-27).

## 2. Fix list (`src/lib/fixlist/`, pure; live adapter in `src/server/`)

| File | Job |
|---|---|
| `types.ts` | `FixInput` (failed/partial checks: id, title, category, status, weight, label, evidence), `FixItem` (checkId, title, why, how, evidenceUrls, source), `FixListModel` interface (`complete(prompt) → string`) |
| `input.ts` | scorecard → `FixInput[]` (only `fail`/`partial`; pass and N/A never reach the model) |
| `prompt.ts` | system + user prompt: the input as JSON, the allowed check IDs and URLs, the JSON output schema |
| `validate.ts` | **CS-04**: parse the model's JSON; drop any item whose `checkId` is not in the input, that cites a URL (field or free text) not in the input evidence, or that mentions a check ID not in the input; count every drop by reason |
| `templates.ts` | one plain-English template per check ID (all 18), filled from that check's evidence |
| `generate.ts` | model present → prompt → validate → fill uncovered checks from templates; model absent, failing or unparseable → templates only. Ranked (D-30). Returns items, `source` (`llm` / `template` / `mixed`), `dropped` counts |
| `recorded.ts` | `RecordedModel`: returns a committed fixture response (tests and e2e; no network) |

`src/server/anthropic-model.ts`: the live adapter (Messages API via `fetch`, key from `ANTHROPIC_API_KEY`). Never
called in this run, in tests or in CI (owner rule 2026-11-15, D-25). Without a key the template fallback is used.

Recorded responses in `fixtures/llm/`: a faithful answer, one that invents a check ID, one that invents an
evidence URL, one that names an invented check only in its prose, one that is not JSON, one wrapped in a code fence.

## 3. Storage (SQLite via Prisma, D-03)

`prisma/schema.prisma`: `Scan` (id, url, status `queued|running|done|failed`, error, timestamps) 1:1 `Report`
(final URL, site type, overall score, scorecard JSON, fix list JSON, crawl summary JSON). Prisma Client 7 with the
better-sqlite3 driver adapter; SQL migration committed in `prisma/migrations/` and applied on startup (D-26).
DB file: `DATABASE_FILE` (default `./data/crawlspace.db`, git-ignored). HTML snapshots are not stored (D-29).

## 4. Web UI (`src/app/`)

- `/` — URL form → `POST /api/scans` → redirect to `/scans/<id>`. Refusals (bad scheme, private address) shown inline.
- `/scans/<id>` — report page: progress while queued/running (polls `GET /api/scans/<id>`), then overall + category
  scores, a check table (status, weight, label such as "heuristic"/"proposed convention", evidence), and the fix
  list with its source ("AI-written, validated" or "template") and how many AI suggestions were dropped.
- Scan queue: in-process, one crawl at a time, ≤ 5 waiting (429 beyond), interrupted jobs failed on restart (D-29).

## 5. Tasks

1. Plan (this file) + DECISIONS rows.
2. `scanUrl` pipeline; CLI switched to it; single-path test.
3. Fix list: types, input, prompt, validator, templates, generate, recorded model, fixtures; CS-04 + unit tests.
4. Prisma schema, migration, migrator, repository; storage tests on a temp DB.
5. Scan service + queue + API routes; service tests against the local test server (fixture site, CS-03 refusals).
6. Pages: form, report, progress; styles.
7. Playwright e2e (`e2e/`, `@playwright/test`), `scripts/e2e-server.ts`, CI job (build + e2e + migration drift check).
8. README, NEXT steps, PR.

## 6. Acceptance → tests

| Acceptance item | Proof |
|---|---|
| CS-04: fix citing a check ID or URL not in the input is dropped and counted | `tests/invariants/cs04-fixlist.test.ts`: every recorded bad response, plus generated adversarial items over all 9 fixture scorecards; kept items only cite input IDs/URLs; drop counts exact |
| Template fallback per check ID when no key | `tests/unit/fixlist.test.ts`: all 18 IDs have a template; every failed/partial check on every fixture gets exactly one item; no model → `source: template` |
| Model behind an interface; no live calls | `generate` takes a `FixListModel`; tests use `RecordedModel`; a test asserts `src/lib` has no network imports (existing) and the service picks templates when no key |
| SQLite storage | `tests/server/store.test.ts`: migrate a temp DB, create/update/read scans and reports, restart marks interrupted scans failed |
| Web uses the same scanner + guard + scoring | `tests/server/scan-service.test.ts`: fixture site crawled through the service scores like the CLI pipeline; CS-03 targets refused with zero server hits; `tests/unit/single-path.test.ts` |
| e2e: scan a fixture site end to end | `e2e/scan.spec.ts`: production build, home page form, submit the good-shop fixture served by the local test server, progress, report shows score 100-class result, check table and fix list; js-only-shop fixture shows failures with fix items and a dropped AI suggestion |
| CS-01, CS-02, CS-03, CS-05 still green | existing invariant tests, unchanged |

## 7. Gate

`npm run lint`, `npm run typecheck`, `npm test` (unit + CS-01..CS-05), `npm run build`, `npm run e2e`, migration
drift check (CI only: Prisma's schema engine cannot be downloaded in the build sandbox), GitHub CI green.

## 8. Risks

- Prisma CLI engines cannot be downloaded in the agent sandbox (binaries.prisma.sh blocked); client generation works
  with the schema-engine path pointed at a stub, migrations are hand-written SQL checked against the schema in CI.
- The live LLM path is untested against the real API in this run (owner hand step).
- In-process queue: fine for a single-node tool (D-08: not deployed in v1); a worker is a Phase 4/deploy question.
