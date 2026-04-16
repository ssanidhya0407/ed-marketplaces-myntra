#!/usr/bin/env bash
set -euo pipefail

# Required env vars:
# MYNTRA_WEBHOOK_TOKEN
# Optional:
# IMAGE (default local), PORT (default 3000), CONTAINER_NAME (default myntra-oms-backend)

IMAGE="${IMAGE:-myntra-oms-backend:latest}"
PORT="${PORT:-3000}"
CONTAINER_NAME="${CONTAINER_NAME:-myntra-oms-backend}"
DATA_DIR="${DATA_DIR:-/var/lib/myntra-oms/data}"

: "${MYNTRA_WEBHOOK_TOKEN:?MYNTRA_WEBHOOK_TOKEN is required}"
mkdir -p "$DATA_DIR"

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${PORT}:3000" \
  -v "${DATA_DIR}:/app/data" \
  -e PORT=3000 \
  -e MYNTRA_WEBHOOK_TOKEN="$MYNTRA_WEBHOOK_TOKEN" \
  -e MYNTRA_WEBHOOK_TOKEN_EXPIRY="${MYNTRA_WEBHOOK_TOKEN_EXPIRY:-}" \
  -e MYNTRA_ACCESS_TOKENS_JSON="${MYNTRA_ACCESS_TOKENS_JSON:-}" \
  -e MYNTRA_TOKEN_SIGNING_SECRET="${MYNTRA_TOKEN_SIGNING_SECRET:-change-me-in-prod-signing-secret}" \
  -e MYNTRA_TOKEN_ISSUER="${MYNTRA_TOKEN_ISSUER:-myntra}" \
  -e MYNTRA_TOKEN_CLOCK_SKEW_SEC="${MYNTRA_TOKEN_CLOCK_SKEW_SEC:-30}" \
  -e REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-1900}" \
  -e IDEMPOTENCY_TTL_MS="86400000" \
  -e LOG_BODY="false" \
  "$IMAGE"

echo "Container started: $CONTAINER_NAME on port $PORT"
