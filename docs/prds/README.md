# Crawlspace — PRDs from the 2026-11-20 review

Source: `docs/REVIEW-2026-11-20.md` (PO ranking, approved by Shane with his 11 decisions). Priority order. Sizes are
estimates. Not covered by a PRD: ranks 3, 4, 5, 6, 11, 12, 13 (fixed on PR #11, D-92..D-97), rank 2 (fixed on PR #12,
D-100), rank 1 (Shane's live smoke test), ranks 32-34 (SEC-7, CQ-11, NEXT 7b: chores).

| PRD | Title | Review items (rank: lens IDs) | Size | Depends on | Status |
|---|---|---|---|---|---|
| [PRD-01](PRD-01-browser-isolation.md) | Headless browser isolation | 14: SEC-2 (SEC-1 done in PR #12) | M (A) / L (B) | PR #12 merged; rank 1 smoke test; CI `docker` job | Proposed |
| [PRD-02](PRD-02-crawl-correctness.md) | Crawl correctness and politeness | 15: CQ-2, CQ-9; 16: CQ-3, UX-1 (crawler); 17 (part): CQ-8; 27: UX-5; 28: SEC-8 | M | Shane's OK on scoring-adjacent behaviour; PR #12 / PRD-01 (`render.ts`); rank 1 | Proposed |
| [PRD-03](PRD-03-abuse-capacity-retention.md) | Abuse limits, capacity and retention | 17: SEC-3, SEC-6, NEXT 4; 18: CQ-5; 19: CQ-7; 22 (part): SEC-9 | M | `CRAWLSPACE_TRUSTED_PROXY_HOPS` set on Render (Shane, Decision 6a); limit numbers from Shane; PRD-04 wording | Proposed |
| [PRD-04](PRD-04-report-copy.md) | Report and fix-list copy | 7: UX-2, DS-6; 8: UX-1 (note); 22: UX-4, UX-6, UX-11, A11Y-6; 23: UX-8; 24: CQ-10 | M | Shane's wording; Shane's OK for evidence pass/fail in checks; `ANTHROPIC_API_KEY` (Decision 1a) | Proposed |
| [PRD-05](PRD-05-visual-a11y-polish.md) | Visual and accessibility polish | 21: DS-1, UX-7, A11Y-5; 25: DS-3, DS-4; 26: A11Y-4; 29: DS-5, DS-8, DS-9, DS-10; 30: DS-7; 31: A11Y-3 | M | PRD-04 (shared elements); D-60 amendment for A11Y-3 | Proposed |
| [PRD-06](PRD-06-demo-dogfood.md) | Demo script and dogfood assets | 10 (restructure): UX-9; 20: UX-10 | S-M | Shane-owned domain for the example scan (D-18); Shane's robots/llms text; rank 1 | Proposed |

Rank 9 (PDF gate moved after "Fix these first", Decision 4b, no new copy): built on branch `leadmagnet/2026-11-21`
(draft PR, D-102), not merged.
