#!/usr/bin/env bash
# CI drift check (D-26, D-41): the committed migration SQL must hold exactly the statements Prisma generates from
# prisma/schema.prisma (order-insensitive: a from-empty script lists every table before every index).
# Needs Prisma's schema engine (downloads on a normal machine; blocked in the agent sandbox).
set -euo pipefail
want=$(mktemp)
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > "$want"
npx tsx scripts/compare-migrations.ts "$want" prisma/migrations/*/migration.sql
