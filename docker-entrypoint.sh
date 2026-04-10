#!/bin/sh
set -e

# Sync DB schema on startup. Safe for dev / single-instance.
# For production with multiple replicas, run this as a one-off job instead.
if [ "${RUN_DB_PUSH:-1}" = "1" ]; then
  echo "[entrypoint] Running prisma db push..."
  npx prisma db push --skip-generate --accept-data-loss=false || {
    echo "[entrypoint] prisma db push failed, exiting" >&2
    exit 1
  }
fi

echo "[entrypoint] Starting: $@"
exec "$@"
