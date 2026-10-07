#!/bin/sh
set -e
case "$1" in
  api) exec node /app/api/server.js ;;
  worker) exec node /app/worker/main.js ;;
  migrate) exec node /app/migrate/migrate.js ;;
  *) exec "$@" ;;
esac
