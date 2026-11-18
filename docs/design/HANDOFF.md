# Design handoff

Source of truth for the UI built on branch `design/impl`. Exported 2026-11-18 from the Claude Design canvas so cloud runs don't depend on artifact access.

- Canvas: https://claude.ai/artifact/YWkK9NBQxuzFhvWeVhVU45
- Brief: https://claude.ai/artifact/GSHpV8HzhLFHJCDic32ZwV

## Artboards (`docs/design/*.dc.html`)

Each file is a self-contained Design Component: HTML with inline styles, `{{holes}}` filled by the `renderVals()` script at the bottom. Read the markup and the script together; the script holds the sample data.

| File | Screen | Frame |
| --- | --- | --- |
| `Main.dc.html` | Report — desktop | 1280×2280 |
| `Tokens.dc.html` | D1 — Tokens (light and dark) | 1280×780 |
| `Form.dc.html` | Scan form — desktop | 1280×780 |
| `Progress.dc.html` | Scan progress — desktop | 1280×780 |
| `Phone.dc.html` | Report — 390 px | 390×2600 |
| `PhoneForm.dc.html` | Scan form — 390 px | 390×844 |

## Owner calls (binding)

- Report and PDF carry Lab Intelligence branding. (Shane, 2026-11-17)
- Scores show /100 overall plus an A–F letter per category. (Shane, 2026-11-17)
- Email gate only before the PDF; the on-screen report stays free. (Shane, 2026-11-17)

## Gaps: screens the PRD needs that no artboard covers

- Operator page (password env var, scan list, rerun, export)
- PDF report layout
- Lead-capture success / error states

Design each gap as a new `docs/design/<Name>.dc.html` in the same look before building it.

### Gap designs added by the design pass (2026-11-18)

| File | Screen | Frame | Covers |
| --- | --- | --- | --- |
| `Operator.dc.html` | Operator page, signed in | 1280×1100 | scan list, status words, grades, lead count, rerun, CSV export, leads, empty states |
| `OperatorSignIn.dc.html` | Operator sign-in and states | 1280×780 | password form, wrong password, locked out, page turned off |
| `LeadStates.dc.html` | PDF email gate states | 1280×1200 | ready, preparing, done, invalid email, too many requests |
| `ScanOutcomes.dc.html` | Report URL without a report | 1280×900 | scan stopped (robots/refused), waiting in queue, unknown link, nothing to fix, form refusal |
| `PdfReport.dc.html` | PDF report, page 1 | 794×1123 (A4) | header band, score, grades, fixes, checks, footer with address and page numbers |

Found beyond the HANDOFF list: the failed/refused scan, queued scan, unknown report (404) and "nothing to fix" states (`ScanOutcomes`).


## Placeholders

The northwind-outfitters.example scan is sample data for layout only.
