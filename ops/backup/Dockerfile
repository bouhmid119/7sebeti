# Nightly encrypted backup runner: pg_dump 17 + age, uploads to Azure Blob (curl + managed identity) or S3 (aws-cli).
FROM postgres:17-alpine
RUN apk add --no-cache age aws-cli bash curl jq
COPY backup.sh restore-check.sh compare-counts.sh run-nightly.sh /ops/
USER postgres
ENTRYPOINT ["/ops/run-nightly.sh"]
