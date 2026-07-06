#!/bin/sh
set -e

echo "[api] Running Prisma migrations..."
if ! npx prisma migrate deploy; then
  echo ""
  echo "[api] ERROR: prisma migrate deploy failed."
  echo "[api] If the log shows P3009, clear the failed migration record in Postgres:"
  echo "       DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20260706120000_init';"
  echo "[api] Then redeploy the API. See docs/EASYPANEL-DEPLOY-INICIAL.md#recuperar-migration-falha-p3009"
  exit 1
fi

echo "[api] Starting NestJS..."
exec node apps/api/dist/main.js
