#!/usr/bin/env bash
# compare-counts.sh SOURCE_URL RESTORED_URL [MAX_DRIFT_PERCENT]
# Fails if a business table is missing or empty in the restore, or drifts more than
# MAX_DRIFT_PERCENT (default 5) below the source — the dump is up to 24 h old.
set -euo pipefail
src="$1"; dst="$2"; max="${3:-5}"
tables="organization membership integration_connection product order order_line order_event external_object_state"
status=0
for t in $tables; do
  a=$(psql "$src" -qtAX -c "select count(*) from \"$t\"")
  b=$(psql "$dst" -qtAX -c "select count(*) from \"$t\"")
  if [ "$a" -gt 0 ] && { [ "$b" -eq 0 ] || [ $(( (a - b) * 100 / a )) -gt "$max" ]; }; then
    echo "FAIL ${t}: source=${a} restored=${b}"; status=1
  else
    echo "ok   ${t}: source=${a} restored=${b}"
  fi
done
exit $status
