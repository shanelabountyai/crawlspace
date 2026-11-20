# LinkedIn drafts — Crawlspace launch

Two drafts for Shane LaBounty (Principal, Lab Intelligence), written by the closeout run of 2026-11-19. They are
drafts: nothing was posted and nothing was added to the Lab Intelligence Ledger. **You:** edit them, read them out
loud, and add the ones you keep to the Ledger yourself.

Rules these drafts follow: Crawlspace is a sample build with no clients and no client results; no employer is named;
no job-search language; every number comes from a file in this repo, named under each draft.

## Draft 1 — "I let AI write the fix list, then built something to throw its answers out"

Pillar: AI integration.

> I let AI write the advice. Then I built the part that throws its advice out.
>
> I built a small tool called Crawlspace. You paste in a website, it reads the site the way an AI agent would, and it gives you a score and a ranked list of fixes.
>
> The scoring is plain code. 18 checks, the same answer every time for the same site.
>
> The fix list is where AI helps. It turns a failed check into a sentence a marketer can hand to a developer.
>
> It is also where AI makes things up. So the tool only accepts a fix if it points at evidence the scan actually found. If a fix cites a check that did not run, or a page that was never read, it gets dropped and the report says how many were dropped.
>
> In my own demo, 3 suggestions get dropped. They read fine. They were confident. They were about things that were not there.
>
> The lesson I keep relearning from running marketing operations: decide what gets checked before you decide what gets automated. The model writes. Something else decides what is allowed onto the page.
>
> This is a sample build, not client work. Every decision behind it is written down in the repo.
>
> Where in your own workflow is AI writing something that nobody checks against the source?
>
> #marketingoperations #aiagents #martech #ai

Numbers and where they come from:

| Claim | Source in this repo |
|---|---|
| 18 checks | `docs/PRD.md` §3 and `src/lib/checks/` (18 check files); `README.md` "the 18 checks" |
| Same answer every time for the same site | `docs/PRD.md` §7, invariant CS-01; `tests/invariants/cs01-determinism.test.ts` |
| A fix that cites a check or URL not in the scan is dropped and counted | `docs/PRD.md` §7, invariant CS-04; `docs/DECISIONS.md` D-28 |
| 3 suggestions dropped in the demo | `README.md` "Demo script" step 3. The demo uses a recorded model reply built to contain invented items (`scripts/e2e-server.ts`), so say "in my own demo", as the draft does |

## Draft 2 — "Your website has a third reader now"

Pillar: MarTech.

> Your website has a third reader now, and most sites were not built for it.
>
> We built sites for people. Then we tuned them for search engines. Now AI agents are showing up to compare, book and buy for someone.
>
> I wanted to see what an agent actually runs into, so I built a scanner. It reads up to 15 pages of a site, one request per second, and checks six things: can it get in, can it read the page without JavaScript, is the product or event data structured, is there guidance for machines, are the buttons and forms real, and is it fast.
>
> Two calls I made on purpose.
>
> One. llms.txt gets the lowest weight of any check. It is a proposed convention, not a standard, and the report says so.
>
> Two. The check for which AI agents a site blocks is switched off for now. I would not ship a list of agent names I had not verified against each company's own documentation. So that check reads "Not applicable" until the list is verified. A blank is better than a guess with a score attached.
>
> The failures I built the test sites around are ordinary ones. A cart that demands a password before anything else. A price that only appears after scripts run. An agent stops at the same places a hurried person does.
>
> This is a sample build on made-up test sites, not client work.
>
> If an agent tried to buy from your site today, where would it stop?
>
> #martech #aiagents #ecommerce #marketingoperations

Numbers and where they come from:

| Claim | Source in this repo |
|---|---|
| Up to 15 pages, one request per second | `src/lib/crawl/config.ts` (`MAX_PAGES = 15`, `MIN_INTERVAL_MS = 1000`); `docs/PRD.md` §4 |
| Six things checked | `docs/PRD.md` §3, categories A to F |
| llms.txt has the lowest weight | `rules/weights.json` (`D1` is 0.5; every other check is 1 or more); `docs/DECISIONS.md` D-04 |
| The AI-agent check is off until the list is verified | `rules/agents.json` (`agents` is empty); `docs/DECISIONS.md` D-10 |
| A cart that demands a password; a price only after scripts run | Fixture sites `fixtures/sites/walled-shop` and `fixtures/sites/js-only-shop`. These are synthetic test sites, not observations of real companies; the draft says "made-up test sites" |

## Not in these drafts, on purpose

- No career numbers. The brief for this run allowed only numbers this repo supports.
- No claim about how real websites score. No real site's score is in the repo (D-06, D-18).
- No link to the live site in the post text. **You:** decide whether to add https://crawlspace.onrender.com, after the
  owner steps in `NEXT.md` are done.
