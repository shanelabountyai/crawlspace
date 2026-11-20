# Crawlspace — demo walk-through

For a hiring-manager demo of the live product at https://crawlspace.onrender.com. Written by the closeout run of
2026-11-19 (branch `closeout/2026-11-19`). About ten minutes end to end.

Each stop carries one of three marks:

- **verified live (GET)**: this run fetched the live page with a read-only GET and saw what is described.
- **verified locally**: this run saw it on a local production build of main (0d27886) with the repo's e2e harness
  and synthetic fixture sites (`npm run demo`, port 7901). Not seen on the live site.
- **not yet clicked through by the owner**: only a person can do it on the live site (it submits a form, needs a
  phone, or needs an inbox). Nobody has done it in a recorded run.

Evidence for the live marks is the table in `docs/RELEASE_NOTES.md` "Live verification". Evidence for the local marks
is the gate in the same file (e2e 18/18) and the screenshot pass described in `docs/reviews/FIVE-LENS-2026-11-19.md`.

## Before the demo (You: do these once, the day before)

1. **You:** open https://crawlspace.onrender.com/api/health and wait for `{"status":"ok"}`. Whether the service
   sleeps when idle depends on the Render instance type, which this run could not read. It answered on the first try
   during this run.
2. **You:** run one scan of a site you own (D-06) on the live site and keep the report link. A full scan on the live
   site has never been verified by any run (README "Deploy"; `docs/DEPLOY.md` step 7). Do not find out during the demo.
3. **You:** pick the site you will scan in front of the hiring manager. Only scan sites you own or have permission to
   show; a score is a statement about someone's site (D-06).

## The walk-through

| # | Stop | What to show | What to say | Mark |
|---|---|---|---|---|
| 1 | Home page `/` | Heading "Can AI agents shop, book or buy on your site?", the one field "Website address", the button "Scan my site", and the two cards "What the scan does" / "What it never does". | One field, no account. The second card is the promise: no form submissions, no logins, no private addresses. | **verified live (GET)** 2026-11-20 02:06 to 02:08 UTC |
| 2 | Start a scan | Type the site address, press **Scan my site**. The progress screen shows while the crawl runs. | It reads up to 15 pages at one request per second and follows robots.txt, so a scan takes up to about a minute. | **verified locally** (fixture site, about 10 seconds). On the live site: **not yet clicked through by the owner** |
| 3 | The score | Top of the report: the score out of 100 with a readiness word ("Ready", "Partly ready", "Not ready") and one factual sentence counting the checks that passed, passed in part and failed. | The score is a weighted percent of the checks that apply. Checks that do not apply are left out, not counted as passes. | **verified locally** (the walled fixture shop showed 65.1 / 100, "Partly ready"). Live: **not yet clicked through by the owner** |
| 4 | Score by category | Six cards, A to F: Access, Readable without JS, Structured data, Machine guidance, Actionability, Speed, each with a letter grade. | Letter bands are A 90+, B 80+, C 70+, D 60+, F below 60 (D-34). | **verified locally**. Live: **not yet clicked through by the owner** |
| 5 | Fix these first | The ranked fix list. Each fix names the evidence URL and the check it comes from. | With an API key the list is written by AI, and a validator drops any fix that cites a check or URL the scan did not produce. Without a key, each failed check gets a standard fix. | **verified locally** with a recorded model reply: the page said 3 AI suggestions were dropped. Whether the live site has an API key set: **not verified** (Render settings not read) |
| 6 | Every check | The table of all 18 checks with Pass / Partial / Fail / Not applicable and the evidence for each. | Point at A2 "AI user agents are allowed by robots.txt": it reads "Not applicable" on real scans because the agent list is empty until each name is verified against official docs (D-10). That is a deliberate choice not to guess. | **verified locally**. Live: **not yet clicked through by the owner** |
| 7 | PDF and the email gate | Bottom panel "Take this report to your team". Type `not-an-email` (refused: "Check the address."), then a real address and press **Download PDF**. | The report on screen is free. Only the PDF asks for an email (D-35). The email is stored with the scan; HubSpot is off unless switched on (D-36). | **verified locally** (refusal shown; a 3-page PDF downloaded). Live: **not yet clicked through by the owner**. Opening the PDF from a real inbox or phone: owner step |
| 8 | A refused address | Back on the home page, enter `http://10.0.0.1/`. The form answers "Not scanned." with a plain reason. | The scanner refuses private and internal addresses before it connects (CS-03). | **verified locally**. Live: **not yet clicked through by the owner** (it is a form post) |
| 9 | A site that says no | A site whose robots.txt disallows everything shows "This site asks crawlers not to read it" as a finding, not an error. | The tool obeys robots.txt for itself. If it is told no, it stops and says so (D-24, D-62). | **verified locally** (fixture `closed.test`). Live: **not yet clicked through by the owner**; needs a site you own with such a robots.txt, optional for the demo |
| 10 | An unknown link | Open `/scans/anything-made-up`. The page reads "We can't find that page". | Report links are private and hard to guess. | Live: the GET was answered with a client error (4xx; the fetch tool did not show the exact code or the page body). The screen itself: **verified locally** |
| 11 | Operator page `/operator` | The page reads "Operator page turned off". | The operator page (scan list, leads, rerun, CSV export) is off until a password is set. Sign-in hardening is merged (PR #10, D-76 to D-81). | **verified live (GET)**: heading "Operator page turned off". The signed-in page: **verified locally** only |
| 12 | Health check `/api/health` | `{"status":"ok"}` | This is what Render polls. | **verified live (GET)**: 200, body `{"status":"ok"}` |
| 13 | Phone width | The same pages at phone width. | Nothing scrolls sideways; wide tables scroll inside their own box. | **verified locally** at 390 px in light and dark (page width measured equal to the viewport on every screen captured). On a real phone: **not yet clicked through by the owner** |
| 14 | Dark mode | Switch the device to dark. | Tokens exist for both schemes (D-48). | **verified locally** (axe: 0 violations on every screen in light and dark, e2e run of this session). Live: **not yet clicked through by the owner** |
| 15 | The repo | `docs/DECISIONS.md`, `tests/invariants/`, `docs/reviews/FIVE-LENS-2026-11-19.md`. | Every judgment call is a numbered decision; five rules are tests that cannot be skipped (CS-01 to CS-05); the review lists what is still wrong. | Files read in this run |

## What to know before showing it

- **Which commit is live was not verified.** `render.yaml` sets auto-deploy off, and this run did not read the Render
  dashboard. The live home page, health route and operator-off page match main, but that does not prove the deploy
  includes the last merges (PR #8, PR #10).
- **The live site's wording quoted above was read through a fetch tool that converts pages to text.** The footer did
  not appear in that text, so the footer on the live site is not verified.
- **Read the review first.** `docs/reviews/FIVE-LENS-2026-11-19.md` ranks what a hiring manager would hit in ten
  minutes. Anything marked "Do now" there is worth fixing or knowing about before a demo.

## Offline fallback

If the live site is slow or down, the README "Demo script" runs the same product on a laptop with no internet after
`npm ci`: `npm run demo`, then http://127.0.0.1:7901 with the fixture sites `http://walledshop.test:7911/` and
`http://goodshop.test:7911/`. Every local mark above was produced on that harness.
