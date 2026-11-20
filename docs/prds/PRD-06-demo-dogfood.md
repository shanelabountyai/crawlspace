# PRD-06 — Demo script and dogfood assets

Status: **Proposed** (2026-11-20). Source: `docs/REVIEW-2026-11-20.md` ranks 10 (restructure) and 20. Owner
decisions: 7a (serve robots.txt and llms.txt, Shane writes them; "See an example report" from a stored scan of a site
Shane owns, closes D-18), 8a (about 6 demo stops). Links in `DEMO.md` already fixed (D-98).

## 1. Problem and evidence

| ID | Finding | Evidence | Status |
|---|---|---|---|
| UX-9 | `docs/DEMO.md` would not land: 15 stops in 10 minutes; no problem statement; stop 6 spotlights A2 (always N/A, D-10); stops 11-12 show the operator-off page and JSON health; stop 5's "3 dropped" comes from a staged recorded reply (D-86), likely not on live, and the doc does not say so; the PDF moment is buried at stop 7 | `docs/DEMO.md` | Verified (doc); flow is opinion |
| UX-10 | No sample report on the home page; the live site answers `/robots.txt` with a client error (4xx), so Crawlspace scanning itself would likely score poorly | live GET of `/robots.txt` (D-83); home page | Suspected (no self-scan run) |

## 2. Who it affects

Hiring managers in Shane's demo; LinkedIn visitors who try the tool on Crawlspace itself or want to see a report
before pasting their own URL.

## 3. Goal

A ten-minute demo that tells one story, and a site that passes its own core checks and shows a real example report.

## 4. Scope

In: `docs/DEMO.md`, `docs/LINKEDIN_DRAFTS.md` cross-references, static `robots.txt`, `llms.txt` and `sitemap.xml`
served by the app, an example report (stored scan of a Shane-owned site, D-06, D-18) linked from the home page,
`examples/`. Out: scoring or check changes to make Crawlspace score well; publishing scores of other companies (D-06).

## 5. Requirements

1. `DEMO.md` restructured to about 6 stops: problem → paste URL → score and grades → fix list → PDF gate → the
   decisions log and invariants (`docs/DECISIONS.md`, `tests/invariants/`). Drop the A2 spotlight, operator and JSON
   health stops. Each stop keeps its D-87 mark (verified live / locally / not yet clicked).
2. The "suggestions dropped" moment is shown only as "in my own demo, from a recorded reply" (D-86), or dropped.
3. The app serves `/robots.txt` (allows crawling, points at the sitemap), `/sitemap.xml`, and `/llms.txt`; text
   written by Shane (anything Claude drafts is proposed, Shane edits).
4. Shane runs one live scan of a site he owns; it is saved with `npm run scan <domain> -- --save examples/<name>`
   (D-18) and committed.
5. Home page link "See an example report" (wording proposed, Shane edits) opens that stored report; it never shows
   a third party's site (D-06) and needs no email.
6. Before the post, Shane scans `crawlspace.onrender.com` and records the score in `DEMO.md` as "verified live".

## 6. Acceptance criteria (tests)

| # | Check | Test |
|---|---|---|
| 1 | `/robots.txt`, `/sitemap.xml`, `/llms.txt` answer 200 with the right content type; robots names the sitemap | new `e2e/dogfood.spec.ts` |
| 2 | Scanning the app's own fixture-served copy passes A1 and D1 | `e2e/dogfood.spec.ts` |
| 3 | Example-report link present on home and opens a report with no email gate on screen (D-35) | `e2e/dogfood.spec.ts` |
| 4 | Every file path named in `DEMO.md` exists | new `tests/unit/docs-links.test.ts` |
| 5 | `DEMO.md` has no stop spotlighting A2, `/operator` or `/api/health` | `tests/unit/docs-links.test.ts` |

## 7. Dependencies

- **Shane hand steps:** a domain he owns for the example scan (D-18); the text of robots.txt and llms.txt; the live
  smoke test (review rank 1).
- PRD-04 lands first if the demo should show the corrected fix-list wording.

## 8. Size (estimate)

S-M.

## 9. Open questions

1. Which Shane-owned site is the example? (D-18 has waited for this since Phase 2.)
2. Should the example report be a stored DB row on live or a static file from `examples/` rendered by the app?
