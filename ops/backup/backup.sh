#!/usr/bin/env bash
# Nightly encrypted dump, uploaded to the storage of the current stage:
#   BACKUP_TARGET=azure  Azure Blob Storage (beta), authenticated by the VM's managed identity;
#   BACKUP_TARGET=s3     any S3 storage (stage 1 on Scaleway), with access keys.
#
# The dump is encrypted with an age PUBLIC key: this host can encrypt but never decrypt,
# and the storage provider never holds the key. The matching private key lives offline
# and is only used by restore-check.sh. Retention: the storage keeps each dump immutable
# for 7 days (WORM / object lock), then lifecycle rules expire daily/ after 8 days and
# weekly/ after 29.
#
# Required env:
#   DATABASE_URL, BACKUP_AGE_RECIPIENT (age1…), BACKUP_TARGET (azure | s3)
#   azure: AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_CONTAINER
#   s3:    S3_BUCKET, S3_ENDPOINT, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# Optional:
#   HEARTBEAT_URL   pinged on success (Better Stack heartbeat)
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_TARGET:?}"
case "$BACKUP_TARGET" in azure | s3) ;; *) echo "BACKUP_TARGET must be azure or s3" >&2; exit 1 ;; esac

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
prefix=daily
[ "$(date -u +%u)" = "7" ] && prefix=weekly   # Sunday's dump is kept 4 weeks
key="${prefix}/hsebeti-${stamp}.dump.age"

file=$(mktemp)
trap 'rm -f "$file"' EXIT

# -Fc is already compressed; encryption comes after compression.
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$file"

case "$BACKUP_TARGET" in
  azure)
    : "${AZURE_STORAGE_ACCOUNT:?}" "${AZURE_STORAGE_CONTAINER:?}"
    # Token from the VM's managed identity (instance metadata service), valid ~24 h.
    token=$(curl -fsS -m 10 -H 'Metadata: true' \
      "${AZURE_IMDS_URL:-http://169.254.169.254}/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://storage.azure.com/" \
      | jq -r .access_token)
    # Single Put Blob: fine up to 5000 MiB, far above the beta's dumps.
    curl -fsS -m 600 -X PUT -T "$file" \
      -H "Authorization: Bearer ${token}" \
      -H 'x-ms-version: 2023-11-03' \
      -H 'x-ms-blob-type: BlockBlob' \
      "${AZURE_BLOB_URL:-https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net}/${AZURE_STORAGE_CONTAINER}/${key}" > /dev/null
    ;;
  s3)
    : "${S3_BUCKET:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}"
    # Most non-AWS S3 (OVH, Scaleway) reject the newer default checksums of aws-cli v2.
    export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
    export AWS_DEFAULT_REGION="$S3_REGION"
    aws s3 cp "$file" "s3://${S3_BUCKET}/${key}" --endpoint-url "$S3_ENDPOINT" --only-show-errors
    ;;
  *)
    echo "BACKUP_TARGET must be azure or s3" >&2
    exit 1
    ;;
esac

echo "backup ok: ${BACKUP_TARGET} ${key}"
[ -n "${HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$HEARTBEAT_URL" > /dev/null
exit 0
