#!/usr/bin/env bash
# Smoke-test the PRODUCTION setup (docker-compose.prod.yml) end to end, in an isolated
# compose project on another port, with throwaway secrets; everything is removed after.
#
#   npm run smoke:prod            (needs Docker)
#
# Checks: image builds, migrations run in their own step, API runs as non-root and is
# healthy, Swagger and /metrics are closed by default, sign-up/login work, the thread
# pool is sized, and weak production secrets are refused.
set -uo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=base-backend-smoke
export API_PORT="${SMOKE_PORT:-4100}"
export JWT_SECRET="$(openssl rand -base64 48)"
export POSTGRES_PASSWORD="$(openssl rand -hex 16)"
C=(docker compose -p "$COMPOSE_PROJECT_NAME" -f docker-compose.prod.yml)
B="http://localhost:$API_PORT"
failures=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 (expected $2, got $3)"; failures=$((failures + 1)); fi
}
cleanup() { echo "== cleanup"; "${C[@]}" down -v --remove-orphans >/dev/null 2>&1; }
trap cleanup EXIT

echo "== build + start"
"${C[@]}" up --build -d || { echo "RESULT: FAILED to build/start"; exit 1; }
for _ in $(seq 1 60); do curl -sf "$B/health" >/dev/null && break; sleep 2; done

echo "== checks"
check "migrate service exited 0" 0 "$(docker inspect -f '{{.State.ExitCode}}' "$("${C[@]}" ps -aq migrate)")"
check "health"           '{"status":"ok","database":"up","redis":"up"}' "$(curl -s "$B/health")"
check "runs as non-root" node "$("${C[@]}" exec -T api whoami | tr -d '\r')"
check "thread pool sized" yes "$("${C[@]}" exec -T api sh -c 'tr "\0" "\n" </proc/1/environ | grep -q "^UV_THREADPOOL_SIZE=[0-9]" && echo yes || echo no' | tr -d '\r')"
check "swagger closed"   404 "$(curl -s -o /dev/null -w '%{http_code}' "$B/docs")"
check "metrics closed"   404 "$(curl -s -o /dev/null -w '%{http_code}' "$B/metrics")"
body='{"name":"Smoke Test","email":"smoke@example.com","password":"password123"}'
check "register"         201 "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$B/auth/register" -H 'content-type: application/json' -d "$body")"
check "login"            200 "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$B/auth/login" -H 'content-type: application/json' -d '{"email":"smoke@example.com","password":"password123"}')"
weak=$("${C[@]}" run --rm --no-deps -e DATABASE_URL=postgresql://app:app@db:5432/app api node dist/main.js 2>&1 | grep -c "weak database password" || true)
check "weak DB password refused" 1 "$([ "$weak" -ge 1 ] && echo 1 || echo 0)"

if [ "$failures" -eq 0 ]; then echo "RESULT: PASSED"; else echo "RESULT: $failures FAILED"; exit 1; fi
