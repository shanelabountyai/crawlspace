# PRD-02 — Crawl correctness and politeness

Status: **Built (draft PR)** (2026-11-23, branch `prd-02/crawl-correctness`; decisions D-115..D-124). Proposed 2026-11-20. Source: `docs/REVIEW-2026-11-20.md` ranks 15, 16, 27, 28 and the per-host part
of 17. Owner decisions: 3b + 3c (start at the origin, refuse a 4xx/5xx start page), 10a (robots network error =
disallow).

**Needed Shane's OK on scoring-adjacent behaviour before building: given 2026-11-23 (D-115).** Requirements 4-6 change which pages and which
view the checks see, so scores for some sites will change. Kept unchanged: CS-01..CS-05, the D-34 bands, weights in
`rules/weights.json`, every fixture's `expected.json` (any fixture whose result changes needs a new fixture instead).

## 1. Problem and evidence

| ID | Finding | Evidence | Status |
|---|---|---|---|
| CQ-2 | After a cross-origin home redirect, the new host's robots.txt is fetched but `Disallow: /` and 5xx (D-24) are not enforced; the new home is fetched before its robots.txt is read | `src/lib/crawl/crawl.ts:107-112` vs `:96-99`. Probe: a→b with b `Disallow: /` → scan completed and fetched `/`, robots, sitemap, llms; d→c with c robots 503 → completed | Verified |
| CQ-9 | robots.txt unreachable (network error) → allow all; RFC 9309 says treat as disallow; D-24 covers 4xx/5xx only | `crawl.ts:94-97` | Code |
| CQ-3 | A Chromium failure silently falls back to `renderedHtml = rawHtml`; the scan is stored as done | `crawl.ts:162-167`. JS-only shop: 42.1 (B 0) with a working renderer vs 38.6 (B 33.3, B2 pass, E1 fail) with a throwing one | Verified |
| UX-1 | A deep link or wrong path is crawled and scored as the home page | `crawl.ts:37-39`; walledshop `/nope-404-page` → 58.7 "Not ready" vs 65.1 for `/`; D2 and F1 judged on the 404 page | Verified |
| CQ-8 | 1 req/s per host holds only within one scan | `src/lib/crawl/fetcher.ts:173`; back-to-back scans of one host 37 ms apart (`render: false`); CS-02 tests per scan only | Verified |
| UX-5 | `goodshop.test:7911` (host:port, no scheme) refused as a wrong scheme | `normaliseStartUrl`, `crawl.ts:39` | Verified |
| SEC-8 | `isPublicAddress` allows `::ffff:0:0/96` and `64:ff9b:1::/48` | `src/lib/crawl/ip.ts:9-24`; matters only behind a NAT64 translator | Suspected |

## 2. Who it affects

Site owners who disallow crawlers (PRD §4 "be a good citizen"); every visitor who pastes a deep link; every
JS-heavy site if Chromium fails on Render (review rank 1 checks whether it does).

## 3. Goal

Crawlspace never reads a site whose robots.txt says no, never scores a page it did not render as if it had, and
always scores the site from its home page.

## 4. Scope

In: `src/lib/crawl/crawl.ts`, `fetcher.ts`, `ratelimit.ts`, `ip.ts`, the snapshot type (a `rendered` flag), the
checks' N/A rule for B and E when not rendered, report/PDF text for the new stop reasons. Out: new checks, weights,
bands, the UI note for deep links (PRD-04), abuse limits (PRD-03).

## 5. Requirements

1. After a cross-origin home redirect, read the new origin's robots.txt **before** fetching anything else there and
   apply D-24 to it (5xx → stop; `/` disallowed → stop) with `CrawlRefused` and a reason naming the host.
2. robots.txt network error (DNS, connect, timeout, TLS) → stop with `CrawlRefused` (Decision 10a; extends D-24).
3. The per-host 1 req/s limit is process-wide: one `HostRateLimiter` shared by every scan (still in memory, one
   process, D-29).
4. Start at the origin root: the crawl's home is `https://host/` whatever path was pasted; the pasted URL is kept on
   the scan as entered (Decision 3b).
5. If the home page answers 4xx/5xx (after redirects), stop with a reason instead of scoring it (Decision 3c).
   A 403/challenge stays an A4 finding (D-15), not a stop.
6. Snapshot gains `rendered: boolean`. When rendering failed, the checks that read the rendered view (D-14: E, and
   B's raw-vs-rendered comparison) return N/A with evidence "page could not be rendered" (CS-05 keeps the score
   neutral), and the report and crawl summary say rendering failed.
7. `normaliseStartUrl`: treat input as having a scheme only if it contains `://` or starts with `http:`/`https:`;
   `host:port` gets `https://` (UX-5).
8. `ip.ts`: refuse `::ffff:0:0/96` and `64:ff9b:1::/48` (D-22 extended).

## 6. Acceptance criteria (tests)

| # | Check | Test |
|---|---|---|
| 1 | a→b, b `Disallow: /` → `CrawlRefused`; no request to b other than `/robots.txt` | new cases in `tests/crawl/crawl.test.ts` |
| 2 | d→c, c robots 503 → refused; robots network error → refused | `tests/crawl/crawl.test.ts`, `tests/unit/robots.test.ts` |
| 3 | Two scans of one host started together: logged starts ≥ 1,000 ms apart across scans | extend `tests/invariants/cs02-politeness.test.ts` |
| 4 | Pasting `/nope-404-page` on walledshop gives the same scorecard as `/` | `tests/crawl/crawl.test.ts` |
| 5 | A home answering 404/500 → stopped scan with a reason | `tests/crawl/crawl.test.ts` |
| 6 | Throwing renderer → `rendered: false`, B/E rendered-view checks N/A, overall score unaffected by them (CS-05) | new `tests/crawl/render-failure.test.ts` |
| 7 | `goodshop.test:7911` normalises to `https://goodshop.test:7911/` | `tests/unit/crawl-units.test.ts` |
| 8 | The two IPv6 ranges are refused before any connection | `tests/invariants/cs03-ssrf.test.ts` |
| 9 | All fixture scorecards unchanged; CS-01..CS-05 green | existing |

## 7. Dependencies

- Shane's OK on scoring-adjacent behaviour (requirements 4-6). **Met:** given 2026-11-23 in chat (D-115).
- Review rank 1 (live smoke test) shows whether requirement 6 already affects live reports.
- PRD-01 and PR #12 also touch `render.ts`: merge order PR #12 → PRD-01 → PRD-02, or one branch.
- PRD-04 owns the wording of the new stop reasons (proposed, Shane edits).

## 8. Size (estimate)

M overall (requirements 1-3, 7, 8: S each; 4-6: M).

## 9. Open questions

Answered for the build as below; each is a default Shane can change (see the D-row).

1. Requirement 6: N/A (score unaffected) or fail the whole scan? N/A is proposed so a report still appears; Shane
   decides. **Built: N/A (D-122).**
2. Requirement 5: should a 401 home (login wall) stop too, or stay a finding? **Built: stays an A4 finding, like
   403, 429 and 503 (D-121).**
3. Requirement 4: if the visitor deliberately pasted a product page, should it be counted among the key pages?
   **Built: no (D-120).**

Requirement 8 names `::ffff:0:0/96`; the range refused is the IPv4-translated `::ffff:0:0:0/96` (D-117).
