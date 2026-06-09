#!/usr/bin/env bash
set -euo pipefail

# Env vars are supplied either by a host .env file (loaded with --env-file at
# `docker run` time) or by exported shell variables. Exported vars override the
# .env file. The .env file is read by Docker at run time, so it does NOT need to
# be inside the image (and is correctly excluded by .dockerignore/.gitignore).
#
# Optional overrides:
#   IMAGE (default myntra-oms-backend:latest), PORT (default 3000),
#   CONTAINER_NAME (default myntra-oms-backend), DATA_DIR, ENV_FILE

IMAGE="${IMAGE:-myntra-oms-backend:latest}"
PORT="${PORT:-3000}"
CONTAINER_NAME="${CONTAINER_NAME:-myntra-oms-backend}"
DATA_DIR="${DATA_DIR:-/var/lib/myntra-oms/data}"
# Default to the repository-root .env (this script lives in deploy/ec2/).
ENV_FILE="${ENV_FILE:-$(cd "$(dirname "$0")/../.." && pwd)/.env}"

mkdir -p "$DATA_DIR"

ENV_FILE_ARGS=()
if [ -f "$ENV_FILE" ]; then
  echo "Loading environment from: $ENV_FILE"
  ENV_FILE_ARGS=(--env-file "$ENV_FILE")
else
  echo "No env file at $ENV_FILE; relying on exported shell environment."
  : "${MYNTRA_WEBHOOK_TOKEN:?MYNTRA_WEBHOOK_TOKEN is required (set it, or create $ENV_FILE)}"
fi

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# `-e VAR` (no value) forwards the host's value only when it is set, so it never
# clobbers a value coming from --env-file. App-level defaults in src/config/env.js
# cover anything left unset.
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${PORT}:3000" \
  -v "${DATA_DIR}:/app/data" \
  "${ENV_FILE_ARGS[@]}" \
  -e PORT=3000 \
  -e MYNTRA_WEBHOOK_TOKEN \
  -e MYNTRA_WEBHOOK_TOKEN_EXPIRY \
  -e MYNTRA_ACCESS_TOKENS_JSON \
  -e MYNTRA_TOKEN_SIGNING_SECRET \
  -e MYNTRA_TOKEN_ISSUER \
  -e MYNTRA_TOKEN_CLOCK_SKEW_SEC \
  -e REQUEST_TIMEOUT_MS \
  -e IDEMPOTENCY_TTL_MS \
  -e LOG_BODY \
  -e MYNTRA_API_BASE \
  -e MYNTRA_MERCHANT_ID \
  -e MYNTRA_SECRET_KEY \
  -e MYNTRA_PARTNER_STORE \
  -e DASHBOARD_KEY \
  "$IMAGE"

echo "Container started: $CONTAINER_NAME on port $PORT"
