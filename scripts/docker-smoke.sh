#!/usr/bin/env bash
# Smoke test for the Docker image (the `docker` job in .github/workflows/ci.yml; D-71). Usage:
#   docker build -t crawlspace:ci . && bash scripts/docker-smoke.sh crawlspace:ci
# Starts the container the way Render does (PORT set by the platform, a volume mounted at /data,
# DATABASE_FILE on it), then fails unless the health route and the home page both answer 200.
# It makes no outbound request: the only scan it submits is one the SSRF guard refuses.
# Step 8 is PRD-01 Phase A (browser isolation): /app is read-only for `node`.
set -euo pipefail

image="${1:?usage: docker-smoke.sh <image>}"
port=10000 # Render's default PORT (https://render.com/docs/web-services); any value other than 7900 proves PORT is honoured
name="crawlspace-smoke-$$"
data="$(mktemp -d)"
base="http://127.0.0.1:${port}"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- container logs ---"
    docker logs "$name" 2>&1 | tail -n 100 || true
  fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

echo "1. Chromium starts inside the image as the app user (no network)"
docker run --rm --user node --entrypoint node "$image" -e '
  const { chromium } = require("playwright");
  (async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent("<h1>ok</h1>");
    const text = await page.textContent("h1");
    const version = browser.version();
    await browser.close();
    if (text !== "ok") throw new Error("unexpected page text: " + text);
    console.log("chromium " + version + " on node " + process.version);
  })().catch((e) => { console.error(e); process.exit(1); });
'

echo "2. Node in the image satisfies engines (>=22 <23)"
docker run --rm --entrypoint node "$image" -e '
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== 22) { console.error("node " + process.version); process.exit(1); }
'

echo "3. Start the container: PORT=${port}, DATABASE_FILE on a mounted volume"
docker run -d --name "$name" -e PORT="$port" -e DATABASE_FILE=/data/crawlspace.db -v "$data:/data" -p "127.0.0.1:${port}:${port}" "$image" >/dev/null

echo "4. Wait for the health route"
code=000
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$base/api/health" || true)"
  [ "$code" = "200" ] && break
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then echo "container exited"; exit 1; fi
  sleep 1
done
[ "$code" = "200" ] || { echo "health route answered $code, wanted 200"; exit 1; }
body="$(curl -s "$base/api/health")"
[ "$body" = '{"status":"ok"}' ] || { echo "unexpected health body: $body"; exit 1; }
echo "   /api/health -> 200 $body"

echo "5. Home page"
code="$(curl -s -o /dev/null -w '%{http_code}' "$base/")"
[ "$code" = "200" ] || { echo "home page answered $code, wanted 200"; exit 1; }
echo "   / -> 200"

echo "6. The app runs as a non-root user"
procs="$(docker top "$name" -eo pid,uid,args | grep -E 'next' || true)" # docker top needs the pid column
echo "$procs"
[ -n "$procs" ] || { echo "no next process found"; exit 1; }
if echo "$procs" | awk '{ if ($2 == 0) found = 1 } END { exit found ? 0 : 1 }'; then echo "the app is running as root"; exit 1; fi

echo "7. The database lands on the mounted volume (a refused scan opens it; nothing is fetched)"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"url":"http://127.0.0.1/"}' "$base/api/scans")"
[ "$code" = "400" ] || { echo "a loopback scan answered $code, wanted 400 (SSRF guard)"; exit 1; }
docker exec "$name" test -s /data/crawlspace.db || { echo "/data/crawlspace.db was not created on the volume"; exit 1; }
echo "   POST /api/scans (loopback) -> 400, /data/crawlspace.db exists"

echo "8. The app user cannot create or modify a file under /app (PRD-01 acceptance 2)"
docker exec -u node "$name" sh -c '
  fail=0
  for d in /app /app/.next /app/.next/server /app/.next/static /app/.next/cache /app/node_modules /app/node_modules/next /app/node_modules/playwright /app/src /app/scripts /app/prisma; do
    [ -d "$d" ] || continue
    if touch "$d/.smoke-write-test" 2>/dev/null; then echo "   node created $d/.smoke-write-test"; fail=1; else echo "   create in $d: refused"; fi
  done
  for f in /app/package.json /app/.next/BUILD_ID /app/scripts/docker-entrypoint.sh /app/node_modules/next/package.json; do
    [ -f "$f" ] || continue
    if ( : >> "$f" ) 2>/dev/null; then echo "   node opened $f for writing"; fail=1; else echo "   write to $f: refused"; fi
  done
  writable="$(find /app -xdev ! -type l \( -user node -o -perm -o+w \) 2>/dev/null | head -n 5)"
  if [ -n "$writable" ]; then echo "   owned by node or world-writable under /app:"; echo "$writable"; fail=1; fi
  exit $fail
' || { echo "node can write under /app"; exit 1; }
if docker logs "$name" 2>&1 | grep -E "EACCES|EROFS"; then echo "the app tried to write somewhere it may not (above)"; exit 1; fi
echo "   no write error in the app log after the requests above"

echo "docker smoke: ok"
