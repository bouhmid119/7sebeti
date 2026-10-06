#!/usr/bin/env bash
# Monthly restore test. Run it on a throw-away database IN THE SAME EU REGION (never on a
# CI runner: the dump contains personal data). A backup that was never restored does not count.
#
# Required env:
#   SOURCE_DATABASE_URL    production database (read-only user is enough) for the comparison
#   RESTORE_DATABASE_URL   empty scratch database to restore into
#   BACKUP_AGE_IDENTITY    path to the age private key file (kept offline otherwise)
#   R2_BUCKET, R2_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (read access)
# Optional:
#   BACKUP_KEY             object key to restore (default: latest daily/)
#   HEARTBEAT_URL          pinged when the comparison passes
set -euo pipefail

: "${SOURCE_DATABASE_URL:?}" "${RESTORE_DATABASE_URL:?}" "${BACKUP_AGE_IDENTITY:?}" "${R2_BUCKET:?}" "${R2_ENDPOINT:?}"

key="${BACKUP_KEY:-$(aws s3 ls "s3://${R2_BUCKET}/daily/" --endpoint-url "$R2_ENDPOINT" | sort | tail -1 | awk '{print "daily/"$4}')}"
echo "restoring ${key}"

# Policies reference the app_rw role, which pg_dump does not carry.
psql "$RESTORE_DATABASE_URL" -qX -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'app_rw') then create role app_rw nologin; end if; end \$\$;"

aws s3 cp "s3://${R2_BUCKET}/${key}" - --endpoint-url "$R2_ENDPOINT" --only-show-errors \
  | age --decrypt --identity "$BACKUP_AGE_IDENTITY" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_DATABASE_URL"

# Row counts of the business tables must match the source as of the dump (tables only grow
# or are purged by age, so the restored count must be <= source and close to it).
"$(dirname "$0")/compare-counts.sh" "$SOURCE_DATABASE_URL" "$RESTORE_DATABASE_URL"

[ -n "${HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$HEARTBEAT_URL" > /dev/null
echo "restore check ok"
