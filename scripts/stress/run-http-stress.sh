#!/usr/bin/env bash
# HTTP stress: N real node containers (image from `act -j vercel`, default
# suiteleaf-vercel:ci) on one throwaway Postgres, with the real Better Auth
# sidecar and a fake shared-directory blob bridge. No Vercel/Neon/Blob.
# Usage: scripts/stress/run-http-stress.sh   (env: STRESS_IMAGE, STRESS_INSTANCES, STRESS_SECONDS, STRESS_WORKERS)
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE=${STRESS_IMAGE:-suiteleaf-vercel:ci}
N=${STRESS_INSTANCES:-3}
TAG=stress-$$
PGPORT=${STRESS_PG_PORT:-55442}
BLOBS=$(mktemp -d /tmp/suiteleaf-fakeblobs.XXXX)
cleanup() { docker rm -f $TAG-pg $(seq -f "$TAG-node%g" 1 $N) >/dev/null 2>&1 || true; rm -rf "$BLOBS"; }
trap cleanup EXIT
docker run -d --rm --name $TAG-pg -e POSTGRES_PASSWORD=stress -e POSTGRES_DB=stress \
  -p 127.0.0.1:$PGPORT:5432 postgres:16-alpine -c max_connections=500 >/dev/null
until docker exec $TAG-pg pg_isready -U postgres -d stress >/dev/null 2>&1; do sleep 1; done; sleep 1
DB="postgresql://postgres:stress@host.docker.internal:$PGPORT/stress"
SETUP=$(docker run --rm --entrypoint suiteleaf-node "$IMAGE" setup-token)
HASH=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["hash"])' "$SETUP")
export STRESS_BOOTSTRAP=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["token"])' "$SETUP")
docker run --rm -e DATABASE_URL="$DB" --entrypoint suiteleaf-node "$IMAGE" migrate-cloud >/dev/null
SECRET=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
BASES=()
for i in $(seq 1 $N); do
  P=$((8810 + i))
  docker run -d --name $TAG-node$i -p 127.0.0.1:$P:$P -e PORT=$P -e DATABASE_URL="$DB" \
    -e SUITELEAF_AUTH_SECRET="$SECRET" -e SUITELEAF_BOOTSTRAP_TOKEN_HASH="$HASH" \
    -e VERCEL_URL=localhost:$P -e SUITELEAF_KICK_EVERY_MS=500 -e RUST_LOG=warn \
    -v "$PWD/scripts/stress:/stress:ro" -v "$BLOBS:/fakeblobs" \
    --entrypoint suiteleaf-node "$IMAGE" run --config /stress/cloud-fake.toml >/dev/null
  BASES+=("http://127.0.0.1:$P")
done
for b in "${BASES[@]}"; do
  for _ in $(seq 1 60); do curl -fsS "$b/api/auth/suiteleaf/providers" >/dev/null 2>&1 && break; sleep 1; done
done
export STRESS_BASES=$(IFS=,; echo "${BASES[*]}") STRESS_PG_CONTAINER=$TAG-pg STRESS_BLOB_DIR="$BLOBS"
set +e
python3 scripts/stress/stress_http.py
rc=$?
for i in $(seq 1 $N); do echo "--- node$i log tail"; docker logs --tail 15 $TAG-node$i 2>&1 | cut -c1-240; done
exit $rc
