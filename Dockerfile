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
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app /ms-playwright /data \
 && chown node:node /app /data

WORKDIR /app

# Dependencies first, so this layer is reused until package files or the Prisma schema change.
# `npm ci` runs the postinstall (`prisma generate`), which reads prisma/schema.prisma and downloads Prisma's engines.
# --include=dev: the build needs TypeScript and friends, and NODE_ENV=production would otherwise leave them out.
COPY --chown=node:node package.json package-lock.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
USER node
RUN npm ci --include=dev

# Chromium and its system libraries for the Playwright version in package-lock.json (apt needs root).
USER root
RUN npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

USER node
COPY --chown=node:node . .
# Optional: serve under a path of another site, e.g. --build-arg CRAWLSPACE_BASE_PATH=/agent-check (D-103). Empty (the
# default) = served at the root exactly as before. Next bakes it into the build; `next build` refuses a bad value.
# Kept as ENV too so the running server sees the same value the build used. Not a secret. Render passes service
# environment variables to the Docker build as build arguments, so setting it on the service reaches this ARG.
ARG CRAWLSPACE_BASE_PATH=""
ENV CRAWLSPACE_BASE_PATH=${CRAWLSPACE_BASE_PATH}
RUN npm run build

# The container starts as root only so the entrypoint can make the mounted disk writable, then drops to `node`
# before the app starts (scripts/docker-entrypoint.sh, D-67).
USER root
EXPOSE 7900
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/app/scripts/docker-entrypoint.sh"]
