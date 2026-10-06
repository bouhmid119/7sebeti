#!/usr/bin/env bash
# Nightly encrypted dump to Cloudflare R2 (EU jurisdiction).
#
# The dump is encrypted with an age PUBLIC key: this host can encrypt but never decrypt.
# The matching private key lives offline and is only used by restore-check.sh.
#
# Required env:
#   DATABASE_URL           connection string of the database to dump
#   BACKUP_AGE_RECIPIENT   age public key (age1…)
#   R2_BUCKET              bucket name (EU jurisdiction)
#   R2_ENDPOINT            https://<account>.eu.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   R2 token limited to this bucket (write only)
# Optional:
#   HEARTBEAT_URL          pinged on success (Better Stack heartbeat)
#
# Retention is enforced by R2 lifecycle rules: daily/ expires after 7 days, weekly/ after 28.
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${R2_BUCKET:?}" "${R2_ENDPOINT:?}"

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
prefix=daily
[ "$(date -u +%u)" = "7" ] && prefix=weekly   # Sunday's dump is kept 4 weeks
key="${prefix}/sebeti-${stamp}.dump.age"

# -Fc is already compressed; encryption comes after compression.
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" \
  | aws s3 cp - "s3://${R2_BUCKET}/${key}" --endpoint-url "$R2_ENDPOINT" --only-show-errors

echo "backup ok: ${key}"
[ -n "${HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$HEARTBEAT_URL" > /dev/null
