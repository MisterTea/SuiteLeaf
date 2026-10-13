#!/usr/bin/env bash
# Create identities and one shared swarm key for the compose cluster, and
# write .env with the peer IDs and a shared auth secret.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo ".env already exists; delete it and ./data to start a new cluster." >&2
  exit 1
fi
docker build -q -f Dockerfile -t suiteleaf-node .. >/dev/null
init() {
  docker run --rm -v "$PWD/data:/work" --entrypoint suiteleaf-node suiteleaf-node "$@"
}
mkdir -p data
NODE1_ID=$(init init --data-dir /work/node1)
NODE2_ID=$(init init --data-dir /work/node2 --swarm-key /work/node1/swarm.key)
NODE3_ID=$(init init --data-dir /work/node3 --swarm-key /work/node1/swarm.key)
cat > .env <<EOF
NODE1_ID=$NODE1_ID
NODE2_ID=$NODE2_ID
NODE3_ID=$NODE3_ID
SUITELEAF_AUTH_SECRET=$(openssl rand -hex 32)
EOF
echo "Cluster ready: $NODE1_ID, $NODE2_ID, $NODE3_ID"
