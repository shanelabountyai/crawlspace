# PRD-05 — Visual and accessibility polish

Status: **Proposed** (2026-11-20). Source: `docs/REVIEW-2026-11-20.md` ranks 21, 25, 26, 29, 30, 31. Owner
Decision 5b: the operator page is not in this demo, so rank 21 stays should-fix. Presentation only: scores, checks,
D-34 bands, schema and JSON contracts unchanged. Design source: `docs/design/` (D-48, D-54).

## 1. Problem and evidence

| ID | Finding | Evidence | Status |
|---|---|---|---|
| DS-1, UX-7 | Operator scans table: Report/PDF/Rerun off-screen at 1280 and 1440 (`.op-table` min-width 860, `.grades` min-width 220; scrollWidth 1335 vs 1070); Rerun misaligned on a failed row; 390 shows 2 columns | `src/app/operator/page.tsx:206`, `globals.css` (D-63) | Verified |
| A11Y-5 | Operator "Latest leads" links 19 px tall with identical text (passes 2.1 AA; breaks the project's 44 px rule, DR-5) | operator page | Verified |
| DS-3 | "Partial" ◐ renders as a 3-4 px sliver with system fonts | `src/app/components/present.ts:12,20` | Verified |
| DS-4 | Six category cards wrap 5 + 1 on desktop (Speed alone); "A · Access" over "Access" | report, `globals.css` (faithful to a `Main.dc.html` flaw) | Verified |
| DS-5 | Phone header button wraps to a second row (~125 px header) vs the artboard's one 68 px row; primary button widths inconsistent at phone | header at 390 px | Verified |
| DS-8 | PDF gate panel `align-items: flex-end`; an error drops the left heading ~90 px | `PdfGate.tsx`, `globals.css` | Verified |
| DS-9 | PDF: stray divider at top of page 3; "Fix:" not bold; "65.1/100" vs web "65.1 / 100"; heading colours differ | `src/lib/report/pdf.ts` | Verified |
| DS-10 | Phone scan meta wraps awkwardly; a wrapped chip keeps its pill radius; progress page 1120 wide vs 760 in `Progress.dc.html` | report / progress at 390 and 1280 | Verified |
| DS-7 | 15 font sizes incl. off-scale 12/14/16/18/26; radii 3/4/5/6/8/12; ~30 of 110 spacing values off the 4 px grid vs `Tokens.dc.html`; px not rem (known) | `globals.css` | Verified |
| A11Y-4 | Two live regions both announce the progress change (`scan-announce` + `ScanProgress` `role=status`) | `src/app/scans/[id]/page.tsx`, `ScanProgress.tsx` | Suspected |
| A11Y-3 | No-JS progress page meta-refreshes every 3 s (W3C F41 / 2.2.1) | `ScanProgress.tsx` (D-60) | Inspection |

## 2. Who it affects

Desktop and phone visitors (DS-3/4/5/10), keyboard and screen-reader users (A11Y-3/4), PDF readers (DS-9), Shane on
the operator page (DS-1, A11Y-5).

## 3. Goal

The report, PDF and operator page match the design tokens and artboards at 390, 1280 and 1440 px, with no new axe
violations.

## 4. Scope

In: `globals.css`, `present.ts`, `Report.tsx`, `PdfGate.tsx`, `ScanProgress.tsx`, `BrandBar.tsx`, operator page,
`pdf.ts` layout only. Out: wording (PRD-04), web fonts (D-48 stands), scoring, D-34 bands.

## 5. Requirements

1. Operator table: compact grades, actions directly after Site, stacked rows at phone width; no action column off
   screen at 1280 and 1440. Leads links ≥ 44 px and named with email + time.
2. Status glyphs as inline SVG (pass, partial, fail, N/A) with the word kept (DR-2).
3. Category cards `repeat(6, 1fr)` at ≥ 1000 px; drop the repeated category name.
4. Phone header fits one row as on the artboard; one primary-button width rule at phone.
5. PDF gate panel `align-items: flex-start`.
6. PDF: remove the stray divider, bold "Fix:", score formatted as on the web, heading colours from the tokens. D-37
   determinism kept.
7. Phone meta and chip wrapping; progress page max width as in `Progress.dc.html`.
8. Size, radius and spacing tokens from `Tokens.dc.html` as CSS variables; font sizes in rem.
9. One live region announces progress (remove `role=status` from the `ScanProgress` paragraph, if a screen-reader
   check confirms the double announcement).
10. No-JS refresh: revisit D-60 — 10-15 s plus a "Check again" link (wording proposed, Shane edits).

## 6. Acceptance criteria (tests)

| # | Check | Test |
|---|---|---|
| 1 | Operator table: every row's actions inside the viewport at 1280 and 1440; no sideways scroll at 390 | new `e2e/visual-polish.spec.ts` |
| 2 | Leads links ≥ 44 px tall | `e2e/a11y.spec.ts` 44 px test |
| 3 | Partial glyph's bounding box ≥ the pass glyph's width | `e2e/visual-polish.spec.ts` |
| 4 | Six category cards on one row at 1280 | `e2e/visual-polish.spec.ts` |
| 5 | Header height at 390 ≤ the artboard row height | `e2e/visual-polish.spec.ts` |
| 6 | PDF heading block does not move when the gate shows an error | `e2e/visual-polish.spec.ts` |
| 7 | PDF text unchanged apart from the listed fixes; same report → same output | `tests/unit/report-pdf.test.ts` |
| 8 | Only one `aria-live`/`role=status` region changes on progress | `e2e/a11y.spec.ts` |
| 9 | axe 0 violations, light and dark, 320/700/1280 (DR-3) | `e2e/a11y.spec.ts`, `e2e/review-2026-11-20.spec.ts` |

## 7. Dependencies

PRD-04 first where the same elements change words (report header, robots finding). Rank 21 becomes must-fix if
Shane decides to show the operator page later (Decision 5).

## 8. Size (estimate)

M overall (requirement 8: M; the rest S each).

## 9. Open questions

1. Requirement 10 changes D-60: OK to amend it?
2. Requirement 8: rem conversion may shift layouts slightly at 390 px; accept small differences from the artboards?
