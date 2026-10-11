#!/usr/bin/env bash
# Deploy one image tag on the VM, with automatic rollback.
# Run by GitHub Actions through Azure run-command (as root, no SSH opened to GitHub), or by
# hand on the VM: sudo TAG=<commit sha> bash ops/deploy/deploy.sh
#
# 1. bring ops/ (compose, Caddyfile, backup) to the same commit as the image;
# 2. pull the image, run migrations, restart api and worker (docker compose up);
# 3. wait for the api healthcheck; on failure, start the previous tag again.
# Secrets stay in ops/deploy/.env on the VM; nothing here reads or prints them.
set -euo pipefail

: "${TAG:?TAG (commit sha of the image) is required}"
APP_USER=${APP_USER:-hsebeti}
REPO=/home/${APP_USER}/7sebeti
DEPLOY_DIR=${REPO}/ops/deploy
STATE_FILE=${DEPLOY_DIR}/.deployed-tag

as_app() { sudo -u "$APP_USER" -H "$@"; }

previous=$(cat "$STATE_FILE" 2>/dev/null || echo latest)
echo "deploying ${TAG} (previous: ${previous})"

as_app git -C "$REPO" fetch --quiet --depth 1 origin "$TAG"
as_app git -C "$REPO" checkout --quiet --detach FETCH_HEAD

compose() { (cd "$DEPLOY_DIR" && as_app env IMAGE_TAG="$1" docker compose "${@:2}"); }

wait_healthy() {
  local id status
  for _ in $(seq 1 36); do
    id=$(cd "$DEPLOY_DIR" && as_app docker compose ps -q api)
    status=$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)
    [ "$status" = healthy ] && return 0
    sleep 5
  done
  return 1
}

if compose "$TAG" pull --quiet migrate api worker && compose "$TAG" up -d --build --remove-orphans && wait_healthy; then
  echo "$TAG" | as_app tee "$STATE_FILE" > /dev/null
  docker image prune -f > /dev/null
  echo "DEPLOY_OK ${TAG}"
  exit 0
fi

echo "deploy of ${TAG} failed, rolling back to ${previous}" >&2
compose "$TAG" logs --tail 50 migrate api >&2 || true
compose "$previous" up -d --remove-orphans || true
echo "DEPLOY_FAILED ${TAG} (rolled back to ${previous})"
exit 1
