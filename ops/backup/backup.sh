#!/usr/bin/env bash
# Nightly encrypted dump to OVH Object Storage (France, S3 API, object lock).
#
# The dump is encrypted with an age PUBLIC key: this host can encrypt but never decrypt,
# and OVH never holds the key. The matching private key lives offline and is only used
# by restore-check.sh.
#
# Required env:
#   DATABASE_URL           connection string of the database to dump
#   BACKUP_AGE_RECIPIENT   age public key (age1…)
#   S3_BUCKET              bucket created with object lock (default retention in COMPLIANCE mode)
#   S3_ENDPOINT            https://s3.<region>.io.cloud.ovh.net (e.g. eu-west-par, gra, sbg)
#   S3_REGION              matching region name (e.g. eu-west-par)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   S3 user limited to this bucket (write only)
# Optional:
#   HEARTBEAT_URL          pinged on success (Better Stack heartbeat)
#
# Retention: object lock keeps every dump undeletable for its locked period; bucket
# lifecycle rules then expire daily/ after 8 days and weekly/ after 29.
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${S3_BUCKET:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}"
# OVH (like most non-AWS S3) rejects the newer default checksums of aws-cli v2.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_DEFAULT_REGION="$S3_REGION"

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
prefix=daily
[ "$(date -u +%u)" = "7" ] && prefix=weekly   # Sunday's dump is kept 4 weeks
key="${prefix}/sebeti-${stamp}.dump.age"

# -Fc is already compressed; encryption comes after compression.
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" \
  | aws s3 cp - "s3://${S3_BUCKET}/${key}" --endpoint-url "$S3_ENDPOINT" --only-show-errors

echo "backup ok: ${key}"
[ -n "${HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$HEARTBEAT_URL" > /dev/null
