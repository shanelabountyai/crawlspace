#!/bin/sh
# Container start (Dockerfile ENTRYPOINT; D-67, D-68). One app process: `next start`.
#
# Port: Render sends traffic to the port in PORT (default 10000, https://render.com/docs/web-services) and requires
# the server to bind host 0.0.0.0. Outside Render, PORT is unset and the app listens on 7900 like `npm start`.
#
# User: when the container starts as root, make the directory of DATABASE_FILE (the mounted disk) writable by the
# unprivileged `node` user, then drop to it. Started as any other user, run as that user.
set -eu

PORT="${PORT:-7900}"
DATABASE_FILE="${DATABASE_FILE:-/app/data/crawlspace.db}"
export PORT DATABASE_FILE
DATA_DIR="$(dirname "$DATABASE_FILE")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups \
    node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$PORT"
fi

exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$PORT"
