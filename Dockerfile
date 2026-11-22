# Crawlspace: one container, one app process (docs/DEPLOY.md option A; D-66, D-67, D-68).
# Not deployed by this file. Built and smoke-tested by the `docker` job in .github/workflows/ci.yml.
# Build arguments: CRAWLSPACE_BASE_PATH only (optional, not a secret; see below and docs/DEPLOY.md "Serving at a path").
#
# Base: Node 22 on Debian bookworm, so `engines` (">=22 <23") holds. The official Playwright image was not used
# because its docs do not say which Node version it ships (https://playwright.dev/docs/docker, read 2026-11-19).
FROM node:22-bookworm

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# tini reaps the browser's child processes (Playwright's Docker page recommends an init process as PID 1).
# /app stays owned by root: the runtime user `node` can read and run the app but not change it (PRD-01 Phase A,
# requirement 2). Only /data, the database's directory, belongs to `node` (the entrypoint re-checks it, D-67).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app /ms-playwright /data \
 && chown node:node /data

WORKDIR /app

# Dependencies first, so this layer is reused until package files or the Prisma schema change.
# `npm ci` runs the postinstall (`prisma generate`), which reads prisma/schema.prisma and downloads Prisma's engines.
# --include=dev: the build needs TypeScript and friends, and NODE_ENV=production would otherwise leave them out.
# Installed and built as root, so every file under /app is root-owned (umask 022: read/execute for `node`).
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --include=dev

# Chromium and its system libraries for the Playwright version in package-lock.json.
RUN npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY . .
# Optional: serve under a path of another site, e.g. --build-arg CRAWLSPACE_BASE_PATH=/agent-check (D-103). Empty (the
# default) = served at the root exactly as before. Next bakes it into the build; `next build` refuses a bad value.
# Kept as ENV too so the running server sees the same value the build used. Not a secret. Render passes service
# environment variables to the Docker build as build arguments, so setting it on the service reaches this ARG.
ARG CRAWLSPACE_BASE_PATH=""
ENV CRAWLSPACE_BASE_PATH=${CRAWLSPACE_BASE_PATH}
RUN npm run build \
 && find /app -xdev ! -type l -perm -o+w -exec chmod o-w {} + \
 && if find /app -xdev ! -type l \( -user node -o -perm -o+w \) | grep -q .; then echo "/app has files node can write" >&2; exit 1; fi

# The container starts as root only so the entrypoint can make the mounted disk writable, then drops to `node`
# before the app starts (scripts/docker-entrypoint.sh, D-67). `node` cannot write under /app (checked above and by
# scripts/docker-smoke.sh).
EXPOSE 7900
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/app/scripts/docker-entrypoint.sh"]
