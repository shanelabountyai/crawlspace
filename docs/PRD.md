# Crawlspace — PRD

Build-log item: **#25 Crawlspace** (AI track). Repo: `shanelabountyai/crawlspace` (public). Port: **7900**.
Base: **standalone** Next.js 16 app + Playwright crawler (no saas-foundation: one public tool, no accounts).

## 1. Why this exists

AI agents increasingly browse, compare, buy and register on people's behalf. Most sites were built for humans and
search engines, not agents. Crawlspace takes a URL, looks at the site the way an agent would, and returns a
scorecard plus a ranked fix list.

It turns Shane's agent-readiness research (ecommerce + event registration) into a working tool: a portfolio piece,
a LinkedIn/guide companion, and a lead magnet for Lab Intelligence.

## 2. Users

- **Visitor** (marketer, ecommerce or event owner): pastes a URL, gets a report, optionally leaves an email for the
  full PDF.
- **Shane** (operator): sees submitted scans, reruns them, exports.

## 3. What gets checked (rubric v1)

Each check is a pure function over a **site snapshot** (fetched files + rendered DOM), returning
`pass | partial | fail | not-applicable` with evidence (URL, selector or line) and a weight. Categories:

| # | Category | Checks (v1) |
|---|---|---|
| A | Access | `robots.txt` reachable; which AI user agents are allowed/blocked (list kept in `rules/agents.json`, dated, not hard-coded); sitemap present and fresh; no blanket bot wall on key pages (HTTP 403/challenge page detection) |
| B | Readable without JS | key content (product name, price, event title, date) present in raw HTML vs only after render; diff % of text |
| C | Structured data | JSON-LD parses; `Product`/`Offer` (price, currency, availability) or `Event` (startDate, location, offers) present and complete; `Organization` present |
| D | Machine guidance | `/llms.txt` present and well-formed (it is a proposed convention — scored low-weight and labelled as such); OpenGraph basics |
| E | Actionability | primary CTA (add to cart / register) is a real `button`/`a` with an accessible name; forms have labels; guest path exists without forced account (heuristic, labelled as such); CAPTCHA on first step flagged |
| F | Speed | TTFB and HTML size of the key pages (agents time out too) |

Site types: `ecommerce`, `event`, `other` (auto-detected from structured data, overridable). N/A checks drop out of
the score instead of counting as passes.

**Score:** weighted percent per category and overall; weights in `rules/weights.json` (data, not code).

**Fix list:** an LLM (Claude) turns failed/partial checks plus their evidence into a ranked, plain-English fix list.
It may only cite evidence that the engine produced; a validator rejects any fix that references a check ID or URL
not in the input. Without an API key, a template per check ID is used.

## 4. Crawl rules (be a good citizen)

Own user agent `CrawlspaceBot/0.1 (+repo URL)`; obeys `robots.txt` for itself; max 15 pages per scan (home, up to
5 product/event pages found via sitemap or links, cart/registration entry, `robots.txt`, sitemap, `llms.txt`);
1 request/second per host; no form submission, ever; no login. Private/internal IPs and non-http(s) schemes are
refused (SSRF guard).

## 5. Out of scope v1

Submitting forms or checkouts, authenticated areas, scanning more than one site per request, scheduled rescans,
a public "leaderboard" of other companies' scores.

## 6. Architecture

- `src/lib/snapshot/` — the snapshot type (zod) and loaders (from disk fixtures, from the crawler).
- `src/lib/checks/` — one file per check, pure; `registry.ts` lists them; `score.ts` aggregates.
- `src/lib/crawl/` — fetcher (undici) + Playwright renderer, politeness, SSRF guard. Produces a snapshot.
- `src/lib/fixlist/` — prompt, call, validator, template fallback.
- `src/app/` — URL form, scan progress, report page, operator page (password env var, no accounts).
- Storage: SQLite via Prisma for scans and reports (D-03). Leads: optional HubSpot form submission (D-05).
- `fixtures/sites/` — synthetic sites as static files (a good shop, a JS-only shop, a blocked shop, a good event
  page, an event page with a CAPTCHA-first registration, etc.), each with an `expected.json` scorecard.

## 7. Invariants (`tests/invariants/`)

- CS-01 Every check is deterministic over the same snapshot.
- CS-02 The crawler never sends a non-GET request and never exceeds 15 pages or 1 req/s per host.
- CS-03 Private, loopback and link-local addresses are refused before any connection.
- CS-04 A fix-list item that cites a check ID or URL not in the input is dropped (and counted).
- CS-05 N/A checks never change the score.

## 8. Phases and gates

| Phase | Scope | Gate |
|---|---|---|
| 1 | **Pure engine, no network:** snapshot type, all checks, scoring, ≥8 synthetic fixture sites with expected scorecards, CLI `npm run scan:fixture <name>` | all fixtures match expected; CS-01, CS-05 green |
| 2 | Crawler: fetch + render, politeness, SSRF guard; CLI `npm run scan <url>` | CS-02, CS-03 green against a local test server; one live scan of a Shane-owned site committed as an example (D-06) |
| 3 | Web UI, report page, fix list (LLM + validator + fallback), SQLite storage | e2e: scan a fixture site end to end; CS-04 green |
| 4 | Lead capture (HubSpot, optional), operator page, PDF export, deploy notes | demo script in README |
