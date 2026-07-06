#!/bin/sh
set -e

INIT_MIGRATION="20260706120000_init"
MIGRATE_ERR="/tmp/prisma-migrate.err"

echo "[api] Running Prisma migrations..."
if ! npx prisma migrate deploy 2> "$MIGRATE_ERR"; then
  if grep -q "P3009" "$MIGRATE_ERR" && grep -q "$INIT_MIGRATION" "$MIGRATE_ERR"; then
    echo "[api] Migration $INIT_MIGRATION marcada como failed. Recuperacao automatica no deploy..."
    npx prisma migrate resolve --rolled-back "$INIT_MIGRATION"
    echo "[api] Reaplicando migrations..."
    npx prisma migrate deploy
  else
    cat "$MIGRATE_ERR" >&2
    exit 1
  fi
fi

echo "[api] Starting NestJS..."
exec node apps/api/dist/main.js
