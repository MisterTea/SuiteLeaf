#!/usr/bin/env bash
# Rust stress tests for cloud locking against a throwaway local Postgres.
# Fake environment: Docker postgres:16-alpine on loopback, in-process server
# instances, local-filesystem blob store. Never touches Neon or Vercel.
# Usage: scripts/stress/run-rust-stress.sh [test-name-filter (default: stress)]
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=suiteleaf-stress-pg-$$
PORT=${STRESS_PG_PORT:-55441}
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=stress -e POSTGRES_DB=stress \
  -p 127.0.0.1:$PORT:5432 postgres:16-alpine -c max_connections=500 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres -d stress >/dev/null 2>&1; do sleep 1; done
sleep 1
export SUITELEAF_TEST_POSTGRES_URL="postgres://postgres:stress@127.0.0.1:$PORT/stress?sslmode=disable"
cargo test -p suiteleaf-node --bin suiteleaf-node -- --ignored --nocapture --test-threads=1 "${1:-stress}"
