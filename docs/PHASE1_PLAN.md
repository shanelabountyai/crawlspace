# Crawlspace — Phase 1 plan (pure engine)

Branch `kickoff`, PR #1 "Crawlspace Phase 1: pure engine" (never merged by Claude). Scope per `docs/KICKOFF.md`
Phase 1 block and PRD §3, §6, §7, §8. **No network, no database.** Phase 2 (crawler) is out of scope.

## 1. Snapshot shape

A snapshot is everything the engine needs, captured once. Checks never fetch anything; they only read it.

On disk (`fixtures/sites/<name>/`):

```
snapshot.json        manifest (below)
robots.txt           optional
sitemap.xml          optional
llms.txt             optional
pages/<id>.raw.html       HTML as served (what a no-JS agent sees)
pages/<id>.rendered.html  DOM after JS (what a browser agent sees)
expected.json        the scorecard this fixture must produce
```

`snapshot.json` (validated by zod in `src/lib/snapshot/schema.ts`):

```jsonc
{
  "url": "https://good-shop.example",          // .example / .test TLDs only in fixtures
  "fetchedAt": "2026-11-01T12:00:00Z",          // all time-relative checks use this, never Date.now()
  "siteTypeOverride": null,                     // "ecommerce" | "event" | "other" | null
  "robots":  { "status": 200, "file": "robots.txt" },   // file null when status != 200; whole entry null = not fetched
  "sitemap": { "status": 200, "file": "sitemap.xml" },
  "llms":    { "status": 404, "file": null },
  "pages": [
    { "id": "home", "url": "https://good-shop.example/", "kind": "home",
      "status": 200, "ttfbMs": 180, "raw": "pages/home.raw.html", "rendered": "pages/home.rendered.html" }
  ]
}
```

Page `kind`: `home | product | event | cart | registration | other`. "Key pages" = `product`/`event` pages (or home
for `other` sites); "action pages" = `cart`/`registration`. The loader inlines file contents, so the in-memory
`Snapshot` is plain data (strings + numbers) and can be deep-cloned / compared — this is what CS-01 relies on.
The Phase 2 crawler will produce the same in-memory type.

**Site type**: override → JSON-LD types (Product/Offer → ecommerce, Event → event; raw first, then rendered) →
page kinds (product/cart → ecommerce, event/registration → event) → `other`.

## 2. Checks (rubric v1)

Each check is one file in `src/lib/checks/`, pure: `(ctx) → { status, evidence[] }`; the registry adds `id`,
`category`, `title`, `weight` (from `rules/weights.json`) and turns non-matching site types into
`not-applicable`. Evidence = `{ url?, selector?, line?, detail }`.

| ID | Cat | Check | Applies to | Weight | pass / partial / fail |
|---|---|---|---|---|---|
| A1 | Access | robots.txt reachable | all | 2 | 200 / 404 / missing or 5xx |
| A2 | Access | AI user agents allowed (list from `rules/agents.json`) | all | 3 | none blocked / some / all blocked from `/` or a key page. Empty list → N/A |
| A3 | Access | sitemap present and fresh | all | 1 | newest `lastmod` ≤ 90 days before `fetchedAt` / present but stale or no lastmod / missing |
| A4 | Access | no bot wall on key pages (403/429/503 or challenge-page markers) | all | 3 | none / some non-home page walled / home walled |
| B1 | Readable w/o JS | key content (name+price, or title+date; h1 for `other`) in raw HTML | all | 4 | all fields / some / none |
| B2 | Readable w/o JS | raw vs rendered visible-text ratio | all | 2 | ≥ 90% / ≥ 50% / < 50% |
| C1 | Structured data | JSON-LD parses (raw HTML) | all | 2 | all blocks parse / some, or only after render / none parse or none present |
| C2 | Structured data | Product + Offer (name, price, priceCurrency, availability) | ecommerce | 4 | complete in raw on every product page / incomplete or render-only / no Product |
| C3 | Structured data | Event (name, startDate, location, offers) | event | 4 | same rule as C2 |
| C4 | Structured data | Organization present | all | 1 | in raw / render-only / absent |
| D1 | Machine guidance | `/llms.txt` well-formed — *proposed convention, low weight (D-04)* | all | 0.5 | H1 + ≥1 link / present but malformed / missing |
| D2 | Machine guidance | OpenGraph basics on home (og:title, og:type, og:image, og:url) | all | 1 | 4 / 1–3 / 0 |
| E1 | Actionability | primary CTA is a real `button`/`a`/submit with accessible name (rendered DOM) | ecommerce, event | 3 | every key page / some / none |
| E2 | Actionability | form fields have labels | all (N/A if no fields) | 2 | 100% / ≥ 50% / < 50% |
| E3 | Actionability | guest path without forced account — *heuristic* | ecommerce, event (N/A without action page) | 2 | no password wall or explicit guest option / – / password required, no guest option |
| E4 | Actionability | CAPTCHA on first step of cart/registration | ecommerce, event (N/A without action page) | 2 | none / – / CAPTCHA found |
| F1 | Speed | worst TTFB of home + key pages | all | 1 | ≤ 800 ms / ≤ 1800 ms / slower |
| F2 | Speed | largest raw HTML of home + key pages | all | 1 | ≤ 500 KB / ≤ 1.5 MB / larger |

**Score**: pass = 1, partial = 0.5, fail = 0; N/A dropped from numerator *and* denominator (CS-05). Category
score and overall score = weighted percent over applicable checks, rounded to 0.1. Categories with no
applicable checks are `null`. Overall is weighted over all applicable checks (not an average of categories).
Weights and status values live in `rules/weights.json`.

## 3. Fixture sites and expected scores

All synthetic, `.example` domains, no real company names. AI-agent tokens in fixtures come from
`fixtures/agents.fixture.json` (synthetic names), so fixture results never depend on the real agent list.
Expected scores below were computed independently from the status matrix × weights (not by the engine).

| Fixture | Type | Point | Overall | A | B | C | D | E | F |
|---|---|---|---|---|---|---|---|---|---|
| good-shop | ecommerce | everything right | 100.0 | 100 | 100 | 100 | 100 | 100 | 100 |
| js-only-shop | ecommerce | empty shell until JS; div "button" | 59.4 | 100 | 0 | 50 | 0 | 66.7 | 100 |
| ai-blocking-shop | ecommerce | robots.txt disallows every AI agent | 89.9 | 66.7 | 100 | 100 | 66.7 | 100 | 100 |
| broken-jsonld-shop | ecommerce | Product JSON-LD has a syntax error | 79.0 | 94.4 | 100 | 28.6 | 50 | 88.9 | 100 |
| walled-shop | ecommerce | one product page behind a challenge wall, forced account, slow | 66.7 | 66.7 | 66.7 | 71.4 | 66.7 | 61.1 | 75 |
| good-event | event | everything right | 100.0 | 100 | 100 | 100 | 100 | 100 | 100 |
| captcha-event | event | CAPTCHA on registration step 1; one agent blocked | 89.9 | 83.3 | 100 | 100 | 100 | 77.8 | 100 |
| event-missing-startdate | event | Event JSON-LD lacks startDate; slowish | 92.8 | 100 | 100 | 71.4 | 100 | 100 | 75 |
| other-site | other | consultancy site; C2/C3/E1/E3/E4 are N/A | 97.9 | 100 | 100 | 100 | 66.7 | 100 | 100 |

Per-check expected statuses are in each `expected.json`.

## 4. CLI and tests

- `npm run scan:fixture <name>` → scorecard table + JSON on stdout.
- `tests/fixtures.test.ts`: every fixture's scorecard matches `expected.json` (site type, every check status,
  category and overall scores).
- `tests/invariants/cs01-determinism.test.ts`: each check run twice (and on a deep clone) gives identical output.
- `tests/invariants/cs05-na-neutral.test.ts`: N/A results never change the score (inflate their weights, drop
  them, flip them — score unchanged).
- Unit tests for robots parsing, JSON-LD extraction, snapshot validation.
- No network in code or tests (a test asserts `src/lib` imports no network modules).

## 5. Risks

- **Agent list can't be verified offline.** Phase 1 is offline by design, so no user agent can be checked against
  an official source in this run. Per the kickoff rule, `rules/agents.json` ships with an **empty verified list**
  and an unverified `pendingVerification` list the engine ignores; A2 is N/A on real scans until a human (or a
  networked session) verifies entries. See D-10.
- Heuristics (CTA text, guest path, challenge markers) are English-only and regex-based; labelled as heuristics.
- Synthetic fixtures are tidier than real sites; Phase 2's live example will surface parser gaps.
- Next.js 16 / eslint flat config churn; kept the app shell minimal.
