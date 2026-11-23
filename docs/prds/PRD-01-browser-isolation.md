# PRD-01 — Headless browser isolation

Status: **Phase A built (draft PR)** (2026-11-22, branch `prd-01/browser-isolation`, D-108 to D-113; proposed 2026-11-20). Phase B not started. Source: `docs/REVIEW-2026-11-20.md` rank 14 (SEC-2); owner Decision 9: (a) now,
(b) only if (a)'s sandbox cannot run on Render. Rank 2 (SEC-1, WebRTC/UDP) is **done** in draft PR #12
(`fix/webrtc-guard`, D-100: `disable_non_proxied_udp` + init script removing the RTC constructors, test
`tests/invariants/cs03-webrtc.test.ts`); it is not part of this PRD.

## 1. Problem and evidence

| ID | Finding | Evidence | Status |
|---|---|---|---|
| SEC-2 | Chromium runs with `--no-sandbox` (Playwright default) as the same uid as the Next server | `src/lib/crawl/render.ts:47-48` (launch args); `scripts/docker-entrypoint.sh` drops to `node` for the whole app (D-67) | Config verified; exploit suspected |

Chromium renders pages chosen by anonymous visitors. A renderer that is compromised (needs a working Chromium
exploit against the pinned Playwright 1.63 build; none was shown in the review) would run as `node`, the same user that:

- reads and writes `/data/crawlspace.db` (lead emails, D-36);
- can read `/proc/<server pid>/environ`: `ANTHROPIC_API_KEY`, `CRAWLSPACE_OPERATOR_PASSWORD`, HubSpot IDs;
- owns `/app` (the built app and its code).

## 2. Who it affects

Visitors whose emails sit in the `Lead` table; Shane (API key, operator password); Lab Intelligence's reputation on
a tool marketed for its safety rules (D-20, D-22).

## 3. Goal

A compromised renderer gets no secret, cannot read or write the database, and cannot change the app's code.

## 4. Scope

In: Chromium launch environment and flags (`render.ts`), the Dockerfile, `scripts/docker-entrypoint.sh`,
`scripts/docker-smoke.sh`, CI `docker` job. Out: the network guard (D-20, D-22; unchanged), WebRTC (PR #12), checks,
scoring, schema, the crawler's fetch logic.

## 5. Requirements

Phase A (Decision 9a, next crawler run):

1. Launch Chromium with an explicit `env` holding only what it needs (e.g. `HOME`, `PATH`, the Playwright browsers
   path, `TZ`); no app secret in it. `ANTHROPIC_API_KEY`, `CRAWLSPACE_OPERATOR_PASSWORD`, `CRAWLSPACE_*`,
   `HUBSPOT_*` and `DATABASE_FILE` are never passed.
2. `/app` is not writable by the runtime user: files owned by root, mode read/execute for `node` (the entrypoint keeps
   chowning only the directory of `DATABASE_FILE`, D-67).
3. Try `chromiumSandbox: true` in the image. If it launches in CI's `docker` job, keep it and drop `--no-sandbox`;
   if it needs user namespaces the host lacks, record which error and keep `--no-sandbox` (Phase B then decides).
4. A fix-forward note: keep Playwright (and so Chromium) on a current release; record the version in `DEPLOY.md`.

Phase B (Decision 9b, only if requirement 3 fails on Render):

5. Run the renderer as a separate process under its own uid with no read access to `/data` and no access to the
   server's `/proc`; the server talks to it over a local pipe/socket. Rendering stays behind the guarded fetcher
   (D-20): the renderer process still has no network of its own.

## 6. Acceptance criteria (tests)

| # | Check | Test |
|---|---|---|
| 1 | The env passed to `chromium.launch` contains none of the secret names above, even when they are set in `process.env` | new `tests/crawl/render-env.test.ts` (unit, launch options captured via injection) |
| 2 | Inside the image, the `node` user cannot create or modify a file under `/app` | new step in `scripts/docker-smoke.sh` (CI `docker` job) |
| 3 | Inside the image, page JS reading `/proc/self/environ` or the server's environ through Chromium yields no secret (test sets a dummy secret) | new step in `scripts/docker-smoke.sh` |
| 4 | Sandbox outcome is recorded: either Chromium launches with the sandbox in the image, or the smoke job logs the refusal | `scripts/docker-smoke.sh` |
| 5 | CS-02, CS-03 (incl. `cs03-webrtc.test.ts`) and `tests/crawl/crawl.test.ts` still pass; fixture scorecards unchanged (CS-01) | existing |

## 7. Dependencies

- PR #12 merged first (same file, `render.ts`).
- The live smoke test (review rank 1, Shane's hand step) proves Chromium runs on Render before the launch changes.
- Docker cannot build in the agent sandbox (D-71): the `docker` CI job is the gate.
- Phase B needs Render to allow a second uid inside the container (not verified, D-73).

## 8. Size (estimate)

Phase A: M. Phase B: L.

## 9. Open questions

1. Does Render's container runtime allow the user namespaces Chromium's sandbox needs? Not verified (D-73).
2. Is a read-only `/app` compatible with Next writing its cache under `.next/cache` at runtime? Check in the
   smoke job; if not, point the cache at a writable temp directory.
3. Memory: does Phase B's second process fit the instance type Shane chose? Not measured (D-85).
