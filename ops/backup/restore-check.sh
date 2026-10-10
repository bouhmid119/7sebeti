#!/usr/bin/env bash
# Monthly restore test. Run it on a throw-away database IN THE SAME EU REGION (never on a
# CI runner: the dump contains personal data). A backup that was never restored does not count.
#
# Required env:
#   SOURCE_DATABASE_URL    production database (read-only user is enough) for the comparison
#   RESTORE_DATABASE_URL   empty scratch database to restore into
#   BACKUP_AGE_IDENTITY    path to the age private key file (kept offline otherwise)
#   BACKUP_TARGET          azure | s3
#   azure: AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_CONTAINER, and `az login` as someone with
#          Storage Blob Data Reader on the container (Terraform grants it to its operator)
#   s3:    S3_BUCKET, S3_ENDPOINT, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (read)
# Optional:
#   BACKUP_KEY             object key to restore (default: latest daily/)
#   HEARTBEAT_URL          pinged when the comparison passes
set -euo pipefail

: "${SOURCE_DATABASE_URL:?}" "${RESTORE_DATABASE_URL:?}" "${BACKUP_AGE_IDENTITY:?}" "${BACKUP_TARGET:?}"

case "$BACKUP_TARGET" in
  azure)
    : "${AZURE_STORAGE_ACCOUNT:?}" "${AZURE_STORAGE_CONTAINER:?}"
    az_blob() { az storage blob "$@" --account-name "$AZURE_STORAGE_ACCOUNT" --container-name "$AZURE_STORAGE_CONTAINER" --auth-mode login --only-show-errors; }
    latest() { az_blob list --prefix daily/ --query 'sort_by([], &properties.lastModified)[-1].name' -o tsv; }
    fetch() { az_blob download --name "$1" --file /dev/stdout --no-progress; }
    ;;
  s3)
    : "${S3_BUCKET:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}"
    export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
    export AWS_DEFAULT_REGION="$S3_REGION"
    latest() { aws s3 ls "s3://${S3_BUCKET}/daily/" --endpoint-url "$S3_ENDPOINT" | sort | tail -1 | awk '{print "daily/"$4}'; }
    fetch() { aws s3 cp "s3://${S3_BUCKET}/$1" - --endpoint-url "$S3_ENDPOINT" --only-show-errors; }
    ;;
  *)
    echo "BACKUP_TARGET must be azure or s3" >&2
    exit 1
    ;;
esac

key="${BACKUP_KEY:-$(latest)}"
echo "restoring ${key}"

# Policies reference the app_rw role, which pg_dump does not carry.
psql "$RESTORE_DATABASE_URL" -qX -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'app_rw') then create role app_rw nologin; end if; end \$\$;"

fetch "$key" \
  | age --decrypt --identity "$BACKUP_AGE_IDENTITY" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_DATABASE_URL"

# Row counts of the business tables must match the source as of the dump (tables only grow
# or are purged by age, so the restored count must be <= source and close to it).
"$(dirname "$0")/compare-counts.sh" "$SOURCE_DATABASE_URL" "$RESTORE_DATABASE_URL"

[ -n "${HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$HEARTBEAT_URL" > /dev/null
echo "restore check ok"
