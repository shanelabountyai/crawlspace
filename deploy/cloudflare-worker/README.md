# Crawlspace path proxy (Cloudflare Worker) — template, not deployed

Serves Crawlspace at a path of `assess.labintelligence.co` (for example `https://assess.labintelligence.co/agent-check`)
while the app keeps running on Render. Only that path goes to Render; every other path on `assess` (the Use-Case
Scorer Lite and anything else) is passed through untouched. Decisions: D-103 to D-106 in `docs/DECISIONS.md`.

Nothing here has been deployed, and no Cloudflare or Render setting has been changed. The path name is **not decided**;
`/agent-check` below is only the example used in the tests.

## Files

| File | What it is |
|---|---|
| `worker.ts` | the Worker: one file, no imports, so it can be pasted into the dashboard or deployed with Wrangler |
| `wrangler.toml.example` | a Wrangler config with the route and the two variables |
| `../../tests/unit/cloudflare-worker.test.ts` | unit tests for the Worker's logic (run by `npm test`) |

## What the Worker does

- `https://assess.labintelligence.co<BASE_PATH>` and anything under it → `<ORIGIN><BASE_PATH>…`, same path and query.
  `/agent-checkout` is **not** forwarded (exact path boundary).
- Method, headers and body pass through; redirects come back to the browser (Crawlspace's redirects are relative, so
  they stay on `assess`).
- Sets `X-Forwarded-Host: assess.labintelligence.co` and `X-Forwarded-Proto: https`.
- Replaces `X-Forwarded-For` with the address Cloudflare saw (`CF-Connecting-IP`), so a value a visitor types is
  never passed on (D-105).
- If `ORIGIN` or `BASE_PATH` is missing or invalid, it forwards **nothing** and passes every request through, so a typo
  cannot break the other apps on `assess`.

## Your steps (in this order)

1. **Pick the path name** (for example `/agent-check`). Rules: starts with `/`, no trailing slash, only letters,
   digits, `-` and `_`. The same value goes in three places: the Render build, the Worker variable and the route.
2. **Build Crawlspace with it.** In the Render dashboard, on the `crawlspace` service, add the environment variable
   `CRAWLSPACE_BASE_PATH=/agent-check` and change the health check path to `/agent-check/api/health`. Then deploy
   (auto-deploy is off). Render passes service variables to the Docker build as build arguments; the `Dockerfile`
   declares the `ARG`. After this deploy, `https://crawlspace.onrender.com/agent-check` is the app and
   `https://crawlspace.onrender.com/` answers 404. Check: `curl -i https://crawlspace.onrender.com/agent-check/api/health`
   → `200 {"status":"ok"}`.
3. **Create the Worker** (Cloudflare dashboard → Workers & Pages → Create → paste `worker.ts`, or
   `cp wrangler.toml.example wrangler.toml && npx wrangler deploy` from this folder). Set two variables (plain text,
   not secrets): `ORIGIN=https://crawlspace.onrender.com` and `BASE_PATH=/agent-check`. The dashboard editor may want
   JavaScript rather than TypeScript; if so, remove the type annotations (`: Request`, `: Env`, the `interface`
   blocks, `as Record<string, unknown>`) or deploy with Wrangler, which compiles TypeScript. Not verified in this run.
4. **Add the route** `assess.labintelligence.co/agent-check*` on the `labintelligence.co` zone, pointing at the Worker.
   `assess` must be proxied by Cloudflare (orange cloud) for a Worker route to run. Not verified: how `assess` is
   hosted today; if it is not on Cloudflare's proxy, a Worker route will not see its traffic.
5. **Smoke test at the new URL** (rank 1 again): open `https://assess.labintelligence.co/agent-check`, scan a site you
   own that needs JavaScript, download the PDF, open the report link again. Also check the Use-Case Scorer still works
   at its usual path.
6. **Check the operator page through the proxy** (only if the operator password is set): sign in at
   `https://assess.labintelligence.co/agent-check/operator`. If sign-in, rerun or sign-out answer
   "cross-origin request refused", Render is not passing `X-Forwarded-Host` on (not verified; D-104).
7. **Revisit `CRAWLSPACE_TRUSTED_PROXY_HOPS`** — read D-105 first: the proxy adds one hop, but while
   `crawlspace.onrender.com` is still reachable directly, raising the number makes it too high for direct requests.

## Rollback

Remove the Worker route (step 4). `assess` is then exactly as before. To serve Crawlspace at the root of
`crawlspace.onrender.com` again, delete `CRAWLSPACE_BASE_PATH` on Render, set the health check back to `/api/health`
and redeploy.

## Not verified

- The Worker in Cloudflare's runtime (only its logic ran, in Node, under `npm test`).
- Whether Cloudflare lets a Worker replace `X-Forwarded-For` on a request to an external origin, and what Render then
  adds to it.
- Whether Render passes `X-Forwarded-Host` from the Worker through to the app (the operator's same-origin check reads
  it, D-104).
- The dashboard's menu names.
