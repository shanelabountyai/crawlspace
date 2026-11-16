#!/usr/bin/env bash
# CI drift check (D-26): the committed migration SQL must be what Prisma generates from prisma/schema.prisma.
# Needs Prisma's schema engine (downloads on a normal machine; blocked in the agent sandbox).
set -euo pipefail
want=$(mktemp)
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > "$want"
norm() { grep -v '^\s*--' "$1" | sed -e 's/[[:space:]]\+$//' | grep -v '^\s*$'; }
if diff <(norm "$want") <(cat prisma/migrations/*/migration.sql > /tmp/have.sql; norm /tmp/have.sql); then
  echo "migrations match prisma/schema.prisma"
else
  echo "prisma/migrations is out of date with prisma/schema.prisma (diff above: < generated, > committed)" >&2
  exit 1
fi
