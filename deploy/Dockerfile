# A SuiteLeaf node: suiteleaf-node, the better-auth sidecar, and the web app.
# Build from the repository root: docker build -f deploy/Dockerfile -t suiteleaf-node .

FROM rust:1-bookworm AS node
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY services/auth/schema.json services/auth/schema.json
RUN cargo build --release -p suiteleaf-node

FROM node:24-bookworm AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps apps
COPY packages packages
COPY services services
RUN npm ci --no-audit --no-fund && npm run build:web && npm run build:auth

FROM node:24-bookworm-slim
COPY --from=node /src/target/release/suiteleaf-node /usr/local/bin/suiteleaf-node
COPY --from=web /src/apps/web/dist /opt/suiteleaf/web
COPY --from=web /src/services/auth/dist/server.mjs /opt/suiteleaf/auth/server.mjs
COPY deploy/node.toml /etc/suiteleaf/node.toml
VOLUME /data
EXPOSE 8787 4001
ENTRYPOINT ["suiteleaf-node", "run", "--config", "/etc/suiteleaf/node.toml"]
