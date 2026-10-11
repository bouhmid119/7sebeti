# One image, three roles: `api`, `worker`, `migrate` (see ops/docker/entrypoint.sh).
# The apps are fully bundled at build time, so the runtime stage has no node_modules.

FROM node:25-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @7sebeti/api --filter @7sebeti/worker --filter @7sebeti/db build

FROM node:25-slim AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /src/apps/api/dist ./api
COPY --from=build /src/apps/worker/dist ./worker
COPY --from=build /src/packages/db/dist ./migrate
COPY --from=build /src/packages/db/migrations ./migrations
COPY ops/docker/entrypoint.sh /usr/local/bin/entrypoint
USER node
EXPOSE 4000
ENTRYPOINT ["entrypoint"]
CMD ["api"]
