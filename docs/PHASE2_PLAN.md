# Crawlspace — Phase 2 plan (crawler)

Branch `phase-2` (off `kickoff`, because PR #1 is not merged yet), PR "Crawlspace Phase 2: crawler" against `kickoff`.
Scope per `docs/KICKOFF.md` table and PRD §4, §6, §7, §8: fetch + render, politeness, SSRF guard, `npm run scan <url>`.
Gate: CS-02 and CS-03 green against a local test server; one live scan of a Shane-owned site committed (D-06).

## Modules (`src/lib/crawl/`)

| File | Job |
|---|---|
| `config.ts` | The crawl rules as constants: `CrawlspaceBot/0.1 (+repo URL)`, 15 pages, 5 key pages, 1 000 ms per host, 10 s timeout, 5 MB body cap, 5 redirects, asset caps |
| `ip.ts` | `isPublicAddress`: blocks private, loopback, link-local, CGNAT, multicast, reserved, documentation ranges (IPv4 and IPv6, including IPv4-mapped/NAT64) |
| `ssrf.ts` | `parseTarget` (http/https only, no credentials), `assertAllowed` (resolve, refuse if **any** address is non-public, before connecting), `guardedLookup` (same check again at connect time against DNS rebinding) |
| `ratelimit.ts` | per-host serialised limiter, starts never closer than 1 000 ms |
| `fetcher.ts` | the only network client: GET is hard-coded (no method parameter), each redirect hop re-checked and counted, page and asset budgets, request log |
| `discover.ts` | pure: links, sitemaps (one level of index), product/event URL patterns, site-type hint, key-page pick, cart/registration entry |
| `render.ts` | headless Chromium that never touches the network itself (see below) |
| `crawl.ts` | orchestration → a `Snapshot` the Phase 1 engine scores unchanged |

Plus `src/lib/snapshot/write.ts` (snapshot → fixture format on disk) and `scripts/scan.ts`.

## Crawl order (≤ 15 page-level requests)

1. `/robots.txt`: 5xx → refuse (RFC 9309 "disallow all"); disallowed `/` for CrawlspaceBot → refuse; 4xx → no rules.
2. Home page (redirects followed; the final origin is the site).
3. Sitemap from the robots `Sitemap:` line or `/sitemap.xml`, plus one child if it is an index.
4. `/llms.txt`.
5. Up to 5 product or event pages: links on the home page first, then the sitemap; robots-disallowed ones skipped and reported.
6. The cart or registration entry linked from those pages, fetched with GET, never submitted.
7. Render each page.

## Renderer isolation

- The page's own document is served from the bytes the fetcher already downloaded (no second request).
- Scripts, XHR and fetch go through the same fetcher (SSRF guard, rate limit, GET only), ≤ 10 per page, ≤ 40 per scan.
- Everything else is aborted: images, CSS, fonts, media, iframes, navigations away, non-GET requests, websockets.
- Backstop: Chromium's DNS is mapped to NOTFOUND and it is pointed at a dead proxy with no loopback bypass, so
  anything that slipped past interception fails.
- Service workers blocked, downloads off.

## Tests (local test server on 127.0.0.1)

Tests reach the server through `*.test` hostnames that a **test-only** policy maps to loopback (D-23). Everything
else in the tests, including every CS-03 target, uses the real public-only policy and no real DNS.

- **CS-02** (`tests/invariants/cs02-politeness.test.ts`): crawl of the good-shop fixture is GET only, uses the bot
  UA, ≤ 15 pages, starts ≥ 1 000 ms apart (client log exact; server log within 50 ms of socket jitter); a site
  with 80 product links, 500 sitemap URLs, an auto-submitting form, a POST `fetch` and `sendBeacon` is still GET
  only and capped; the 16th page request is refused unsent; robots rules for CrawlspaceBot are obeyed; a
  robots-closed site and a 5xx robots.txt stop the scan after the robots request.
- **CS-03** (`tests/invariants/cs03-ssrf.test.ts`): 14 targets (127.0.0.1, localhost, [::1], IPv4-mapped,
  0.0.0.0, decimal and hex 127.0.0.1, 169.254.169.254, 10/8, 192.168/16, fe80::, file:, ftp:, credentials) are refused
  with zero server hits; a hostname resolving to loopback; DNS rebinding caught at connect; a redirect into
  loopback not followed; the rendering browser cannot reach loopback via fetch, img, iframe or websocket.
- `tests/crawl/crawl.test.ts`: page discovery on the served fixture, scores on content checks, a JS-only shop
  whose content exists only after render, snapshot write/load round trip.
- Unit tests for IP ranges, URL normalising, limiter (including an early-firing timer), discovery helpers.

## Risks

- Live scans need direct outbound connections; the fetcher ignores `HTTPS_PROXY` (D-22), so it will not work in
  proxied sandboxes. Fine on a normal machine.
- Blocking CSS/images means layout-dependent lazy loading may not fire; content behind it shows as "render-only"
  or missing.
- The live example is not committed yet (no domain chosen, D-18).
