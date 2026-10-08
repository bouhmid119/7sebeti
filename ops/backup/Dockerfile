# Nightly encrypted backup runner: pg_dump 17 + age + aws-cli (for R2).
FROM postgres:17-alpine
RUN apk add --no-cache age aws-cli bash curl
COPY backup.sh restore-check.sh compare-counts.sh run-nightly.sh /ops/
USER postgres
ENTRYPOINT ["/ops/run-nightly.sh"]
