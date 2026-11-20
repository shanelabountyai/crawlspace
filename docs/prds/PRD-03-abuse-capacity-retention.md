# PRD-03 — Abuse limits, capacity and retention

Status: **Proposed** (2026-11-20). Source: `docs/REVIEW-2026-11-20.md` ranks 17, 18, 19 and the SEC-9 part of 22;
NEXT.md item 4. Owner Decision 6a: Shane sets `CRAWLSPACE_TRUSTED_PROXY_HOPS` on Render before the post.
Already done (PR #11): queue-limit race (D-92), body caps (D-95), PDF wrap cost (D-93), init retry (D-94).

## 1. Problem and evidence

| ID | Finding | Evidence | Status |
|---|---|---|---|
| SEC-3 | Scan creation has no per-client limit; only the global `QUEUE_LIMIT` = 5 (D-29). One script keeps the queue full; the app works as an anonymous crawler | `src/server/scan-service.ts:36-54` | Verified (code) |
| SEC-6 | PDF-gate limit is per scan only; anyone can file leads with anyone's email across scans; with HubSpot on, they go to the CRM | `src/server/lead-service.ts` (`LEADS_PER_SCAN_PER_HOUR`, D-38) | Verified (code) |
| NEXT 4 | PDF-gate limit is count-then-insert without a transaction; concurrent posts can exceed 10/scan/hour | `lead-service.ts` | Known, still open |
| CQ-5 | Evidence has no size cap: a 1 MB `<h1>` on 3 pages → about 4 MB per scan row (2.0 MB scorecard + 2.0 MB fix list); 1 GB disk (D-70), no retention | `scan-service.ts` → `store.markDone` | Verified |
| CQ-7 | No overall scan deadline; `markFailed` errors swallowed → row stays "running" until restart, client polls forever; the single queue chain waits on it | `scan-service.ts:57-66` | Code |
| SEC-9 | A failed scan stores raw exception text, returned by public `GET /api/scans/[id]` | `scan-service.ts:68` | Suspected |

## 2. Who it affects

Every visitor during a flood ("the scanner is busy"); people whose email someone else types into the gate; Shane
(disk full stops all writes; HubSpot filled with junk).

## 3. Goal

No single client can deny scans to others or fill the disk; one stuck scan cannot stop the queue; leads are bounded
per client.

## 4. Scope

In: `src/server/scan-service.ts`, `lead-service.ts`, `store.ts`, the client-address helper from D-78
(`clientKey`, `trustedProxyHops`), the two public POST routes, `docs/DEPLOY.md`. Out: crawler internals (the
process-wide per-host limiter, CQ-8, is PRD-02), schema changes unless requirement 6 needs one (then a migration
with the D-41 check), checks, scoring.

## 5. Requirements

1. Per-client scan limit on `POST /api/scans`, keyed by the D-78 client address (IPv6 by /64); unset
   `CRAWLSPACE_TRUSTED_PROXY_HOPS` → shared bucket, as for sign-in. Limit value: Shane decides (open question 1).
2. Global hourly cap on new scans, independent of client address.
3. Same-URL dedupe: a submit for a normalised URL that finished or is queued within a short window returns the
   existing scan id instead of crawling again.
4. PDF gate: count and insert in one transaction (NEXT item 4); add a per-client cap and a global hourly cap.
5. HubSpot submission only after consent (proposed: a checkbox, wording proposed, Shane edits); local storage
   unchanged (D-36). HubSpot stays off by default.
6. Clip each `Evidence.detail` (and fix text built from it) at the store boundary before `markDone`; the engine
   (`scanSnapshot`) and stored scores are untouched. Clip length: Shane decides (open question 3).
7. Retention: delete or prune scan rows older than a set age (scorecard/fix-list blobs), leads kept; documented in
   `DEPLOY.md`. Age: Shane decides.
8. Overall scan deadline: a scan that exceeds it is failed with a fixed reason and the queue moves on.
9. `markFailed` errors are logged, not swallowed; the page stops polling after the deadline.
10. Public API returns a fixed failure category (e.g. "could not reach the site"), not the raw exception text;
    the raw text stays in the server log only.

## 6. Acceptance criteria (tests)

| # | Check | Test |
|---|---|---|
| 1 | With hops set, client A at its limit gets 429; client B still gets 200 | new `tests/server/scan-limits.test.ts` |
| 2 | Unset hops: one shared bucket; a spoofed `X-Forwarded-For` does not buy more scans | `scan-limits.test.ts` |
| 3 | Global cap reached → 429 for everyone | `scan-limits.test.ts` |
| 4 | Two submits of the same URL in the window → same id, one crawl | `tests/server/scan-service.test.ts` |
| 5 | 20 concurrent PDF posts on one scan → never more than the per-scan limit stored | `tests/server/lead-service.test.ts` |
| 6 | No HubSpot call without consent | `tests/server/hubspot.test.ts` |
| 7 | 1 MB `<h1>` on 3 pages → stored row under the clip bound; score identical to unclipped | `tests/server/store.test.ts` |
| 8 | A scan that never resolves is failed at the deadline and the next queued scan runs | `scan-service.test.ts` (fake timers) |
| 9 | Failed scan JSON holds no exception message or stack | `tests/server/scan-service.test.ts` |
| 10 | CS-01..CS-05 and fixtures unchanged | existing |

## 7. Dependencies

- **Shane hand step:** `CRAWLSPACE_TRUSTED_PROXY_HOPS` found and set on Render (`docs/DEPLOY.md` "Finding
  `CRAWLSPACE_TRUSTED_PROXY_HOPS` on Render"; Decision 6a). Without it requirement 1 is one shared bucket.
- PRD-04 owns failure-category and consent wording (proposed, Shane edits).
- All limits stay in memory, one instance (D-29, D-70).

## 8. Size (estimate)

M.

## 9. Open questions

1. Per-client and global scan limits, PDF-gate caps, dedupe window, deadline, evidence clip length, retention age:
   no numbers exist in the repo; Shane picks them.
2. Consent before HubSpot: checkbox, or double opt-in (needs a mail provider, D-38)?
3. Should a scan row ever be deleted, or only its blobs pruned (operator history, D-40)?
