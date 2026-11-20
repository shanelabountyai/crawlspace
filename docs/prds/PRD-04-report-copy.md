# PRD-04 — Report and fix-list copy

Status: **Proposed** (2026-11-20). Source: `docs/REVIEW-2026-11-20.md` ranks 7, 8 (note), 22, 23, 24. Owner
decisions: 1a (set `ANTHROPIC_API_KEY` with a spend limit), 2a now + 2b here, 3a (deep-link note).

**Copy on the live product is Shane's.** Every sentence below in quotes is **proposed, Shane edits**. Requirement 2
(2b) adds pass/fail per evidence item in the checks: **needs Shane's OK on scoring-adjacent behaviour**; it must not
change any status or score, and keeps CS-01..CS-05 and the D-34 bands.

## 1. Problem and evidence

| ID | Finding | Evidence | Status |
|---|---|---|---|
| UX-2, DS-6 | Template fixes contradict themselves: "Found:" joins passing and failing evidence, e.g. "Found: CTA is `<button>` "Add to cart"; no add-to-cart / register control found." then advises a `<button>`; "(partly passing)" | `src/lib/fixlist/templates.ts:106-113`; `Evidence` has no per-item pass/fail | Verified |
| UX-1 | Deep link scored as home with no warning (walledshop `/nope-404-page` 58.7 vs 65.1) | `Report.tsx:28-39` | Verified |
| UX-4 | Jargon on the public page: raw error codes (ENOTFOUND), "private, loopback, link-local or reserved address", "(rules/agents.json)", CSS selectors, TTFB, "raw HTML", "rubric v1", "1 script requests", "block(s)" | report and stopped-scan screens | Verified |
| UX-6 | "This site asks crawlers not to read it" also shown for robots 5xx, a path-only disallow, or only CrawlspaceBot named; operator shows a bare red "Failed" | `src/app/scans/[id]/page.tsx:296-308`; `crawl.ts:76,79` | Verified |
| UX-11 | Stopped scan says "Check the address and try again" with no prefilled form; any unknown id says "Report links are private and hard to guess"; "Fix these first" heading above "Nothing to fix" at 100/100 | stopped / not-found / good report screens | Verified |
| A11Y-6 | Report h1 is "Agent-readiness score"; the site name is in no heading | `Report.tsx` | Verified |
| UX-8, DS-6 | "3 AI suggestions were dropped" amber callout shown to every visitor, styled like a site problem | `Report.tsx:126-136` | Verified |
| CQ-10 | CS-04 validator keeps scheme-less URLs (`evil.example/guide`, `//evil.example/x`) and lowercase check IDs | `src/lib/fixlist/validate.ts:8` | Verified |

## 2. Who it affects

Every visitor reading a fix list (the product's main output); hiring managers who paste a deep link; screen-reader
users; Shane, whose name is on every sentence.

## 3. Goal

Every sentence on the report is true for this site, plain to a marketer, and never contradicts itself.

## 4. Scope

In: `templates.ts`, `validate.ts`, `Report.tsx`, `present.ts`, `src/lib/report/words.ts`, `src/app/scans/[id]/page.tsx`,
`src/app/operator/page.tsx`, the PDF text that mirrors them (`pdf.ts`), and (requirement 2 only) an optional
`passed` flag on `Evidence` set by the checks. Out: scores, statuses, weights, bands, the deep-link crawler change
(PRD-02).

## 5. Requirements

1. (2a, now) Templates drop the "Found: …" clause; "(partly passing)" becomes "Partly passing: see the evidence in
   Every check." (proposed, Shane edits).
2. (2b) Checks mark each evidence item `passed: true|false`; templates quote only failing items and say "Passed on
   N of M pages" for partial checks. No status or score changes (CS-01, CS-05; fixture `expected.json` statuses equal).
3. (3a) When the entered path is not `/`: "You entered /path. Crawlspace scores a site from its home page, so this
   report is for https://host/." (proposed, Shane edits). Stored URL as entered is already on the scan.
4. Plain text first, technical reason in a "Details" toggle (keeps D-62's verbatim reason); remove "rules/agents.json",
   "rubric v1" from visitor text; pluralise counts correctly.
5. Separate robots wording for: whole site disallowed; robots.txt 5xx; only CrawlspaceBot named; operator status
   "Stopped: robots.txt" instead of "Failed".
6. Stopped scan: the form below is prefilled with the URL. 100/100: no "Fix these first" heading over "Nothing to fix".
7. Report h1 (or an h2 under it) includes the host.
8. The dropped-suggestions callout moves to the crawl summary in neutral tone and to the operator page.
9. Validator: a cited URL must be absolute `http(s)` and in the input evidence; check IDs match case-sensitively.
10. Public failure categories for PRD-03 requirement 10 (wording proposed, Shane edits).

## 6. Acceptance criteria (tests)

| # | Check | Test |
|---|---|---|
| 1 | No template fix contains "Found:" or "(partly passing)" | `tests/unit/fixlist.test.ts` |
| 2 | With `passed` flags, a partial E1 template names only failing items; all fixture statuses and scores unchanged | `tests/unit/fixlist.test.ts`, `tests/fixtures.test.ts` |
| 3 | Scan of `/nope-404-page` shows the deep-link note; scan of `/` does not | `e2e/scan.spec.ts` |
| 4 | Visitor report text has no `ENOTFOUND`, `rules/agents.json`, `rubric v1`, `(s)` | new `e2e/report-copy.spec.ts` |
| 5 | Each robots case gets its own title; operator row says "Stopped: robots.txt" | `tests/unit/present.test.ts`, `e2e/phase4.spec.ts` |
| 6 | Host appears in a heading; dropped callout absent from the visitor report, present in crawl summary | `e2e/report-copy.spec.ts` |
| 7 | `evil.example/guide`, `//evil.example/x`, lowercase `e1` → dropped and counted | `tests/invariants/cs04-fixlist.test.ts` |
| 8 | axe 0 violations (DR-3) | `e2e/a11y.spec.ts` |

## 7. Dependencies

Shane's wording for every quoted sentence; Shane's OK for requirement 2; PRD-02 for the deep-link crawl change
(requirement 3 ships first and stays true afterwards); `ANTHROPIC_API_KEY` set (Decision 1a) to see model fixes
next to templates (D-30).

## 8. Size (estimate)

M (requirement 1: S; requirement 2: M).

## 9. Open questions

1. Requirement 4: which technical terms stay visible (TTFB is useful to developers)?
2. Requirement 8: keep any visitor-visible trace of dropped suggestions (D-28 says "shown on the report")? Moving
   it needs D-28 amended.
