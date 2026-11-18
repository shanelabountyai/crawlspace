# Crawlspace — deploy notes

Status: **not deployed** (D-08, D-43). This file lists what the app needs at runtime, the options, the work each one
needs, and a checklist. Nothing here has been run against a hosting provider; no account, domain, environment
variable or secret was created. Prices and plan limits are not listed because they change: check them on the day.

## What the app needs at runtime

| Need | Why | Where in the code |
|---|---|---|
| Node 22 | `engines` in `package.json` | — |
| Chromium for Playwright 1.63.0 (`npx playwright install --with-deps chromium`) | the "readable without JS" and actionability checks render pages (D-02); Chromium never touches the network itself (D-20) | `src/lib/crawl/render.ts` |
| Direct outbound HTTP(S) on any port | the crawler connects directly and ignores `HTTPS_PROXY`, so the SSRF guard sees the real destination (D-22) | `src/lib/crawl/fetcher.ts`, `ssrf.ts` |
| A writable, persistent file for SQLite | scans, reports and leads (D-03); migrations run on start (D-26) | `DATABASE_FILE`, `src/server/db.ts` |
| **One** app process | the scan queue, the login limiter and the PDF-gate limiter live in memory (D-29, D-38, D-39); two processes would each run their own queue against one SQLite file | `src/server/scan-service.ts` |
| Long-running requests are fine; scans run in the background | a scan takes up to roughly a minute (1 req/s, ≤ 15 pages) and runs after the POST returns | — |
| HTTPS in front | the operator cookie gets `Secure` when the request is HTTPS (`x-forwarded-proto`) | `src/server/operator-auth.ts` |

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_FILE` | `./data/crawlspace.db` | point at the persistent volume |
| `CRAWLSPACE_OPERATOR_PASSWORD` | unset → operator page off | at least 12 characters; changing it signs everyone out (D-39) |
| `ANTHROPIC_API_KEY` | unset → template fix list | optional (D-25) |
| `CRAWLSPACE_FIXLIST_MODEL` | `claude-sonnet-4-5` | optional (D-31) |
| `CRAWLSPACE_HUBSPOT_ENABLED` | unset → off | `1` turns on the HubSpot form submission (D-05, D-36) |
| `HUBSPOT_PORTAL_ID`, `HUBSPOT_FORM_GUID` | unset | both needed when the flag is `1`; the form must have an `email` field |

Nothing in the environment can relax the SSRF guard (D-23, D-27).

## Options

### A. One container on a host with a persistent volume (recommended)

A small VM or a container platform that keeps one long-running process and mounts a disk (for example Fly.io,
Render, Railway, or any VPS with Docker).

Work it needs:

1. A `Dockerfile`: start from the official Playwright image that matches 1.63.0 (it ships Chromium and its system
   libraries) or `node:22-bookworm` plus `npx playwright install --with-deps chromium`; `npm ci`; `npm run build`;
   `CMD ["npm","start"]` (port 7900). Prisma generate runs on `npm ci` (postinstall) and needs to download its
   engines during the image build.
2. A volume mounted at, say, `/data`, and `DATABASE_FILE=/data/crawlspace.db`.
3. Exactly one instance; no autoscaling to more than one machine (see "One app process").
4. Secrets set in the platform: `CRAWLSPACE_OPERATOR_PASSWORD`, optionally `ANTHROPIC_API_KEY` and the HubSpot trio.
5. A domain and TLS (the platform usually terminates TLS and sets `x-forwarded-proto`).
6. Check that the platform allows outbound connections to arbitrary hosts and ports (some block non-443 egress or
   force a proxy; the crawler does not use proxies by design).
7. Backups of the SQLite file (it holds lead emails).

Why recommended: it matches the architecture as built (one process, SQLite, Chromium next to the app) with no code
changes.

### B. Vercel for the UI, a separate crawl worker, a hosted database

Work it needs (code changes, a new phase of its own):

1. Move storage off a local SQLite file: change the Prisma `datasource` (D-03) to a hosted database (Postgres, or a
   hosted SQLite service with a driver adapter) and port the migrations.
2. Replace the in-process queue (D-29) with a job table or a queue service; serverless functions do not keep a
   background queue alive after the response.
3. Run `scanUrl` (crawler + Playwright) in a long-running worker elsewhere (a container from option A without the
   UI), because Chromium plus a minute-long crawl does not fit a serverless function well.
4. Move the login and PDF-gate limiters to the shared store.
5. The PDF already renders without a browser (D-37), so it can stay in the UI functions.

### C. Shane's Mac behind a tunnel

`npm run build && npm start` on the Mac, exposed with a tunnel (for example Cloudflare Tunnel or Tailscale Funnel).

Work it needs: install the tunnel, set the env vars in a launch agent, keep the Mac awake. Cheapest to try, fine for
a demo or a private beta; it is down whenever the Mac is, and visitors' scans come from the home IP address.

## Before going public (any option)

- [ ] Decide on D-08: which option, which domain.
- [ ] Set `CRAWLSPACE_OPERATOR_PASSWORD` (long, random) and sign in once over HTTPS.
- [ ] Decide whether to flip HubSpot on; if so create the form (with an `email` field), set the three variables,
      submit one test email and check it arrives in HubSpot (never tested live in the build runs).
- [ ] Decide what the gate note under the email field should say about privacy, and link a privacy page if one
      exists (the current line is in `src/app/components/PdfGate.tsx`).
- [ ] Back up the SQLite file on a schedule; it holds lead emails.
- [ ] Optional: set `ANTHROPIC_API_KEY` and run one scan to see the AI-written fix list (D-25).
- [ ] Optional: verify AI user agents into `rules/agents.json` (D-10); until then check A2 is N/A on real scans.
- [ ] Load test lightly: the queue takes one scan at a time and refuses beyond 5 waiting (HTTP 429).
