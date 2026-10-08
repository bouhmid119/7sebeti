#!/usr/bin/env bash
# Runs backup.sh every day at BACKUP_AT_UTC (HH:MM, default 02:30). No cron daemon needed,
# and the container environment reaches the script as is.
set -uo pipefail
at="${BACKUP_AT_UTC:-02:30}"
target=$(( 10#${at%:*} * 3600 + 10#${at#*:} * 60 ))
while true; do
  now=$(( $(date -u +%s) % 86400 ))
  wait=$(( (target - now + 86400) % 86400 ))
  [ "$wait" -eq 0 ] && wait=86400
  echo "next backup in ${wait}s"
  sleep "$wait"
  /ops/backup.sh || echo "backup FAILED (the missing heartbeat will alert)"
done
