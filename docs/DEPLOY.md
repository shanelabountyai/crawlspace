# Crawlspace — deploy notes

Status: **not deployed**. The host is decided: **Render**, chosen by the owner on 2026-11-18 (D-08, D-65). The deploy
files exist (`Dockerfile`, `.dockerignore`, `scripts/docker-entrypoint.sh`, `render.yaml`) and CI builds and
smoke-tests the image, but nothing here has been run against a hosting provider; no account, domain, environment
variable or secret was created. Prices and plan limits are not listed because they change: check them on the day.
The owner's steps are under [Render](#render-chosen-host-d-65).

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
| A health check path | `GET /api/health` → 200 `{"status":"ok"}`; never opens the database or starts a scan (D-69) | `src/app/api/health/route.ts` |

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_FILE` | `./data/crawlspace.db` | point at the persistent volume (`/data/crawlspace.db` in `render.yaml`) |
| `PORT` | unset → 7900 | read only by the container entrypoint (D-68); Render sets it. `npm start` and `npm run dev` still use 7900 |
| `CRAWLSPACE_OPERATOR_PASSWORD` | unset → operator page off | at least 12 characters; changing it, restarting or deploying signs everyone out (D-39, D-79) |
| `CRAWLSPACE_TRUSTED_PROXY_HOPS` | unset → no forwarded address is trusted | not a secret. How many proxies in front of the app write to `X-Forwarded-For`, 1 to 5; anything else counts as unset. Makes the sign-in limit per client address (D-78). Find the number on the running service first: see [Operator sign-in](#operator-sign-in-read-before-step-4) |
| `ANTHROPIC_API_KEY` | unset → template fix list | optional (D-25) |
| `CRAWLSPACE_FIXLIST_MODEL` | `claude-sonnet-4-5` | optional (D-31) |
| `CRAWLSPACE_HUBSPOT_ENABLED` | unset → off | `1` turns on the HubSpot form submission (D-05, D-36) |
| `HUBSPOT_PORTAL_ID`, `HUBSPOT_FORM_GUID` | unset | both needed when the flag is `1`; the form must have an `email` field |

Nothing in the environment can relax the SSRF guard (D-23, D-27).

## Options

### A. One container on a host with a persistent volume (chosen: Render, D-65)

A small VM or a container platform that keeps one long-running process and mounts a disk (for example Fly.io,
Render, Railway, or any VPS with Docker).

Work it needs (items 1–3 are now in the repo, see [Render](#render-chosen-host-d-65); 4–7 are the owner's):

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

## Render (chosen host, D-65)

Nothing below has been done. The files were written from Render's public docs, read on 2026-11-19:
[Blueprint spec](https://render.com/docs/blueprint-spec), [disks](https://render.com/docs/disks),
[Docker](https://render.com/docs/docker), [web services](https://render.com/docs/web-services),
[health checks](https://render.com/docs/health-checks), [environment variables](https://render.com/docs/environment-variables),
[free plan limits](https://render.com/docs/free).

### What is in the repo

| File | What it does |
|---|---|
| `Dockerfile` | `node:22-bookworm`, `npm ci`, Chromium and its libraries for the locked Playwright version, `npm run build` (D-66) |
| `scripts/docker-entrypoint.sh` | starts `next start` on `0.0.0.0:$PORT` (7900 if `PORT` is unset); makes the directory of `DATABASE_FILE` writable and runs the app as the non-root `node` user (D-67, D-68) |
| `.dockerignore` | keeps `data/`, `.env*`, `node_modules`, `.next`, test output and `docs/` out of the image |
| `render.yaml` | one Docker web service, one instance, no autoscaling, disk at `/data`, `DATABASE_FILE=/data/crawlspace.db`, health check `/api/health`, auto-deploy off, four secret keys with no values (D-70) and `CRAWLSPACE_TRUSTED_PROXY_HOPS` with no value (D-80) |
| `scripts/docker-smoke.sh` + the `docker` job in CI | builds the image, starts it with `PORT=10000` and a mounted `/data`, fails unless `/api/health` and `/` answer 200 (D-71) |

To try the image on a machine with Docker (the agent sandbox could not build it, D-71):

```bash
docker build -t crawlspace:ci . && bash scripts/docker-smoke.sh crawlspace:ci
```

### What Render's docs say (the parts the files rely on)

- A web service must bind host `0.0.0.0`; Render recommends the port in `PORT`, whose default is `10000` (web services).
- A disk needs a **paid** web service; Free web services cannot have one. A service with a disk cannot scale past one
  instance and loses zero-downtime deploys. Only files under the mount path survive deploys and restarts. The disk is
  not available during the build (disks, free plan limits).
- With `healthCheckPath` set, Render sends HTTP GET requests to it; any 2xx or 3xx within five seconds is healthy. A
  deploy whose instances do not become healthy within 15 minutes is cancelled (health checks).
- `sync: false` variables: "Render prompts you for these values only during the initial Blueprint creation"; later
  syncs ignore them, so later changes are made in the dashboard (Blueprint spec).
- Environment variables are also passed to the image build as Docker build arguments (Docker). The `Dockerfile`
  declares no `ARG`, so no secret reaches a build layer.
- Render snapshots a disk once every 24 hours and keeps snapshots seven days, and its disk page says not to rely on a
  disk restore for database recovery (disks). Hence step 9.
- Render blocks outbound port 25 for all services (free plan limits). Nothing else about outbound limits was found.

### Operator sign-in (read before step 4)

The three operator-login weaknesses from the Phase 4 review that kept `/operator` off (D-44, D-72) are fixed on the
branch `fix/operator-login` (D-76 to D-81). **It is safe to set `CRAWLSPACE_OPERATOR_PASSWORD` once that pull request
is merged and deployed.** Use a long random password (at least 12 characters; the app keeps the page off for anything
shorter). What holds now, each with a test in `tests/server/operator-login-route.test.ts` or
`tests/server/operator-login-gate.test.ts`:

- **The limit holds for requests that arrive together** (D-76). No more than 10 wrong passwords per address are
  compared in 15 minutes; an address that is full is refused without its password being looked at.
- **A stolen cookie gives no way to test password guesses offline** (D-79). The cookie is signed with a random key
  that exists only in the running process, not with the password. Consequences you will notice: every restart or
  deploy signs you out, and so does changing the password. Signing out ends the session everywhere, so a copy of the
  cookie stops working.
- **Other people's wrong passwords lock only their own address, once the app knows the address** (D-77, D-78). This
  part needs one setting, below. Until it is set, sign-in behaves as before in this one respect: all addresses share
  one limit, so anyone who sends 10 wrong passwords every 15 minutes keeps you locked out. Guessing stays bounded
  either way, and restarting the service clears the counts.
- **A flood slows sign-in instead of stopping it** (D-77). After 50 wrong passwords in 15 minutes from all addresses
  together, passwords are checked one at a time, one second apart. A new address goes ahead of addresses and blocks
  that have already guessed. At most 30 requests wait, none longer than 30 seconds.

What does **not** hold (residual risk, D-77 to D-79):

1. With `CRAWLSPACE_TRUSTED_PROXY_HOPS` unset, set too low, or with the header missing: lockout by anyone, as above.
2. With it set **too high**, the attacker chooses which address is counted: they can lock any address they name and
   are no longer held to 10 per address. That is worse than unset. Only the one-per-second bound still applies.
3. During a flood, if 30 requests from different networks are already waiting, the next one, yours included, is
   answered "Sign-in is busy. Try again in a minute." Nothing is counted against it.
4. Someone on your own address (same office or home connection) shares your 10 attempts; someone flooding from your
   own block (IPv4 /24, IPv6 /56) is ahead of you in the line.
5. A cookie copied from your browser works until it expires (12 hours), you sign out, or the service restarts.
6. Not verified on Render: what `X-Forwarded-For` contains there, and that the app's port cannot be reached around
   Render's proxy ("Not verified" 11).

#### Finding `CRAWLSPACE_TRUSTED_PROXY_HOPS` on Render (step 8)

Do not guess the number. Render's docs do not state it (D-78).

1. Leave the variable empty. Set the password, deploy, sign in at `https://<your-service>.onrender.com/operator`.
2. In the same browser open `https://<your-service>.onrender.com/api/operator/client-address`. `forwardedFor` is the
   list of addresses as the app received it; `countedAs` is `shared` for now.
3. Look up your own public address (any "what is my IP" page). Find it in `forwardedFor` and count its place **from
   the right**: the last entry is 1. If your address is not in the list, stop here and leave the variable empty.
4. Set `CRAWLSPACE_TRUSTED_PROXY_HOPS` to that number in the dashboard and redeploy (this signs you out). Sign in.
5. Open the address page again: `perAddress` must be `true` and `countedAs` must be your address (for IPv6, its first
   four groups followed by `::/64`).
6. Check that the number is not too high, from a terminal (the first command prints a `set-cookie` line; copy the
   `cs_op=...` part up to the first `;`):
   ```bash
   curl -si -X POST https://<your-service>.onrender.com/api/operator/login \
     -H 'content-type: application/json' -d '{"password":"<your password>"}' | grep -i set-cookie
   curl -s https://<your-service>.onrender.com/api/operator/client-address \
     -H 'cookie: cs_op=<value>' -H 'X-Forwarded-For: 198.51.100.77'
   ```
   `countedAs` must still be **your** address, with `198.51.100.77` somewhere to its left in `forwardedFor`. If
   `countedAs` is `198.51.100.77`, the number is too high: lower it by one and repeat. If you cannot get both checks
   to pass, empty the variable again.

### The owner's steps, in order

1. **Merge the pull request** once CI is green (both jobs: `check` and `docker`). Render reads `render.yaml` from
   the repository.
2. **Create the service from the Blueprint**: in the Render dashboard, create a new Blueprint from the
   `shanelabountyai/crawlspace` repository; it finds `render.yaml` at the repo root and proposes one web service,
   `crawlspace`, with a disk. (The exact button names were not read in this run.)
3. **Pick an instance type that supports a persistent disk**: any paid type; Free does not. `render.yaml` leaves
   `plan` out, so a new service gets the spec's default (`0.5c-512mb`) unless you choose another; a type you pick in
   the dashboard is kept on later syncs. Whether that default has enough memory for Chromium is not verified: if scans
   fail or the service restarts during a scan, move up one size. Check the price on Render's pricing page that day.
   The region defaults to `oregon` and cannot be changed later; add `region:` to `render.yaml` first if you want another.
4. **Set the secrets** when Render asks for the `sync: false` values:
   - `CRAWLSPACE_OPERATOR_PASSWORD`: a long random password, at least 12 characters, **only if the deployed commit
     includes the operator-login fixes** (the `fix/operator-login` pull request; see "Operator sign-in" above). On any
     earlier commit leave it unset. To keep the page off: leave it empty, or, if the form will not accept an empty
     value (not verified), enter a placeholder shorter than 12 characters (`MIN_PASSWORD_LENGTH` in
     `src/server/operator-auth.ts`) and delete the variable afterwards.
   - `CRAWLSPACE_TRUSTED_PROXY_HOPS`: leave it empty for now (step 8). If the form will not accept an empty value
     (not verified), enter `0`: it means the same.
   - `ANTHROPIC_API_KEY`: optional. Unset means the template fix list (D-25).
   - `HUBSPOT_PORTAL_ID`, `HUBSPOT_FORM_GUID`: leave unset. They are read only when `CRAWLSPACE_HUBSPOT_ENABLED=1`,
     which `render.yaml` does not set (D-36).
5. **First deploy**: auto-deploy is `"off"` in `render.yaml`, so if creating the Blueprint does not start a deploy by
   itself (not verified), start one by hand in the dashboard. The image build downloads Chromium, so it is not quick
   (not timed on Render). Render then waits for `/api/health`.
6. **Check the health route**: `curl -i https://<your-service>.onrender.com/api/health` → `200` and `{"status":"ok"}`.
7. **Run one scan** of a site you own (D-06) from the home page and read the report. This is the first real test of
   three things CI cannot show: Chromium rendering on Render, outbound connections from Render, and the disk. Then
   restart the service in the dashboard and open the same report link again: it must still be there (the database is
   on the disk).
8. **Sign in to `/operator`** once over HTTPS (with the operator-login fixes deployed and the password set). Check
   in the browser's developer tools that the `cs_op` cookie is marked `Secure` and `HttpOnly` ("Not verified" 8).
   Then follow "Finding `CRAWLSPACE_TRUSTED_PROXY_HOPS` on Render" above. Expect to sign in again after every deploy
   or restart.
9. **Set up SQLite backups**: the file holds lead emails. Render's daily disk snapshots are a fallback, not a
   database backup (see above). The database runs in WAL mode, so a plain copy of `crawlspace.db` alone can miss
   recent writes: use SQLite's own backup (the `sqlite3` tool's `.backup` command, or `VACUUM INTO`) and keep the copy
   somewhere other than the disk. Whether the `sqlite3` tool is in the image was not checked, and how to schedule a
   backup on Render was not worked out in this run.
10. Later, if wanted: a custom domain; `autoDeployTrigger: checksPass` to deploy main automatically after CI passes.

### Not verified

Each of these is a "check it on the day" item, not a known problem.

1. **Outbound connections to arbitrary hosts and ports.** The crawler connects directly and ignores proxies by design
   (D-22). Render's docs state only that port 25 is blocked for all services; no page read in this run says whether
   other ports are open or whether traffic is proxied. Step 7 is the test; also try a site on a non-standard port if
   you have one.
2. **The image on Render.** CI builds and starts it on GitHub's runners; no Render build was run. The sandbox could
   not build it at all (D-71).
3. **Disk ownership.** Render's disk page does not say which user owns the mount path. The entrypoint handles a
   root-owned mount (D-67); a platform that forbids `chown` or starts the container as an arbitrary user was not tested.
4. **Memory.** No measurement of the app plus Chromium against any Render instance type.
5. **Chromium's runtime needs.** Playwright's Docker page recommends `--init` and `--ipc=host` (shared memory) for
   Chromium; Render's docs mention neither. `tini` covers the first inside the image; the second is not addressed.
6. **Minimum disk size.** `sizeGB: 1` was chosen as the smallest; the spec states only the default (10).
7. **Blueprint creation details.** Whether a `sync: false` value may be left empty, whether creation starts the first
   deploy when auto-deploy is off, and the dashboard's button names.
8. **`x-forwarded-proto` on Render.** The web-services page says Render terminates TLS and redirects HTTP to HTTPS; it
   does not name the header the app reads for the `Secure` cookie flag. Check the cookie at step 8.
9. **Prices.** None read, none quoted.
10. **A scan inside the image.** CI proves Chromium launches in the image and the app answers; no full crawl has been
    run in it. Step 7 is the first one. (`scripts/check-migrations.sh` cannot run in the agent sandbox, D-26, but CI
    runs it and it passed on this branch; there is no schema change.)
11. **`X-Forwarded-For` on Render.** How many proxies write to it, whether a client-sent value is kept, and whether
    the app's port can be reached without passing Render's proxy. Render's docs read in these runs do not say (D-78).
    Until step 8's check is done, `CRAWLSPACE_TRUSTED_PROXY_HOPS` stays empty and the sign-in limit is shared by all
    addresses.

## Before going public (any option)

- [x] Decide on D-08: Render (owner, 2026-11-18; D-65). The domain is still open.
- [ ] Confirm Render allows direct outbound connections to arbitrary hosts and ports (the crawler ignores proxies by
      design, D-22). **Not verified**: Render's docs do not state it (see "Not verified" 1).
- [x] Fix the operator-login should-fix items (`NEXT.md` "Review run" 1, 2, 5; D-44, D-72): done on
      `fix/operator-login` (D-76, D-77, D-79). Merge and deploy that before turning `/operator` on.
- [ ] Then set `CRAWLSPACE_OPERATOR_PASSWORD` (long, random) and sign in once over HTTPS.
- [ ] Find and set `CRAWLSPACE_TRUSTED_PROXY_HOPS` (step 8). Until then anyone can keep the operator locked out with
      10 wrong passwords every 15 minutes (D-78).
- [ ] Decide whether to flip HubSpot on; if so create the form (with an `email` field), set the three variables,
      submit one test email and check it arrives in HubSpot (never tested live in the build runs).
- [ ] Decide what the gate note under the email field should say about privacy, and link a privacy page if one
      exists (the current line is in `src/app/components/PdfGate.tsx`).
- [ ] Back up the SQLite file on a schedule; it holds lead emails.
- [ ] Optional: set `ANTHROPIC_API_KEY` and run one scan to see the AI-written fix list (D-25).
- [ ] Optional: verify AI user agents into `rules/agents.json` (D-10); until then check A2 is N/A on real scans.
- [ ] Load test lightly: the queue takes one scan at a time and refuses beyond 5 waiting (HTTP 429).
