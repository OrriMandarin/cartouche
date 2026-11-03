#!/usr/bin/env bash
# Verifies that the production API image cannot run with the test issuer and exposes no test
# routes. Builds the API image WITHOUT any Cargo feature, then checks:
#   1. APP_ENV=production + AUTH_ISSUER=cartouche-test-issuer exits non-zero in < 20 s and logs
#      TestIssuerInProduction;
#   2. APP_ENV=test with an arbitrary issuer answers 404 on POST /api/test/token (routes are
#      not compiled in).
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="cartouche-api:prod-guard"
SUFFIX="$$"
CONTAINERS=()
cleanup() {
  for c in "${CONTAINERS[@]:-}"; do
    [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

fail() {
  echo "prod guard FAILED: $*" >&2
  exit 1
}

# 1. No feature: the production build.
echo "==> Building the API image without features"
docker build -f apps/api/Dockerfile --build-arg FEATURES="" -t "$IMAGE" .

# 2. The test issuer is refused in production.
echo "==> Checking that the test issuer is refused in production"
NAME="cartouche-guard-prod-$SUFFIX"
CONTAINERS+=("$NAME")
docker create --name "$NAME" \
  -e APP_ENV=production \
  -e AUTH_ISSUER=cartouche-test-issuer \
  -e AUTH_JWKS_URL=http://localhost:8080/jwks.json \
  -e DATABASE_URL=postgres://u:p@127.0.0.1:1/db \
  -e PUBLIC_BASE_URL=http://localhost:3000 \
  "$IMAGE" >/dev/null
START=$SECONDS
docker start "$NAME" >/dev/null
# `timeout`-free wait: poll the container state for at most 20 s.
STATUS=""
while [ $((SECONDS - START)) -lt 20 ]; do
  STATUS=$(docker inspect -f '{{.State.Status}}' "$NAME")
  [ "$STATUS" = "exited" ] && break
  sleep 0.5
done
[ "$STATUS" = "exited" ] || fail "container still running after 20 s with the test issuer in production"
CODE=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")
[ "$CODE" != "0" ] || fail "container exited with code 0 in production with the test issuer"
LOGS=$(docker logs "$NAME" 2>&1 || true)
# The tracing event carries the error text; accept the variant name or its message.
echo "$LOGS" | grep -Eq 'TestIssuerInProduction|AUTH_ISSUER is the test issuer' \
  || fail "logs do not mention TestIssuerInProduction: $LOGS"
echo "    exit code $CODE after $((SECONDS - START)) s"

# 3. No test routes in the binary, even with APP_ENV=test.
echo "==> Checking that /api/test/* routes are absent from the binary"
PG="cartouche-guard-pg-$SUFFIX"
API="cartouche-guard-api-$SUFFIX"
NET="cartouche-guard-net-$SUFFIX"
CONTAINERS+=("$API" "$PG")
docker network create "$NET" >/dev/null
trap 'cleanup; docker network rm "$NET" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=cartouche -e POSTGRES_PASSWORD=cartouche -e POSTGRES_DB=cartouche \
  postgres:17 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$PG" pg_isready -U cartouche -d cartouche >/dev/null 2>&1 && break
  sleep 1
done
docker run -d --name "$API" --network "$NET" \
  -e APP_ENV=test \
  -e AUTH_ISSUER=https://issuer.example.com \
  -e AUTH_JWKS_URL=http://localhost:8080/jwks.json \
  -e DATABASE_URL=postgres://cartouche:cartouche@"$PG":5432/cartouche \
  -e PUBLIC_BASE_URL=http://localhost:3000 \
  "$IMAGE" >/dev/null
READY=0
for _ in $(seq 1 30); do
  if docker exec "$API" curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[ "$READY" = "1" ] || fail "API did not become healthy: $(docker logs "$API" 2>&1 | tail -n 20)"
STATUS_CODE=$(docker exec "$API" curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'content-type: application/json' -d '{}' http://localhost:8080/api/test/token)
[ "$STATUS_CODE" = "404" ] || fail "POST /api/test/token returned $STATUS_CODE instead of 404"
docker exec "$API" sh -c 'command -v cartouche-seed' >/dev/null 2>&1 \
  && fail "the seed binary is present in the production image"

echo "prod guard OK"
