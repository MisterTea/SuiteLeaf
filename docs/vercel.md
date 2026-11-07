# SuiteLeaf on Vercel

The cloud backend runs the existing Rust/Axum server and Better Auth sidecar in a
Vercel container Function. Accounts, permissions, folders, version references,
upload progress, and collaboration updates live in Neon Postgres. Document
manifests and immutable content chunks live in a **private** Vercel Blob store.
No SQLite file or container filesystem is authoritative in cloud mode.

Cloud mode uses a central database. Desktop and browser clients connect to the
hosted server; peer replication remains a self-hosted feature. Vercel's container
runtime is currently Beta.

## Provision and configure

Create/link the `suiteleaf` Vercel project in the intended team. Connect Neon and
a private Blob store in `cle1` alongside Neon's AWS US East (Ohio) region, using separate resources for production and
testing. Never connect a preview deployment to production documents by accident.

Production requires these server-side variables:

| Variable                         | Purpose                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Pooled Neon connection string                                                             |
| `DATABASE_URL_UNPOOLED`          | Direct connection for release migrations                                                  |
| `BLOB_READ_WRITE_TOKEN`          | Private store credential; the Node SDK also supports a connected store's OIDC credentials |
| `SUITELEAF_CLOUD=1`              | Select the cloud backend                                                                  |
| `SUITELEAF_AUTH_SECRET`          | Stable random authentication secret, at least 32 characters                               |
| `SUITELEAF_BOOTSTRAP_TOKEN_HASH` | BLAKE3 digest of the initial administrator setup token                                    |
| `SUITELEAF_PUBLIC_URL`           | Canonical production HTTPS origin                                                         |
| `SUITELEAF_AI_GATEWAY_MODEL`     | Gateway model ID; defaults to `openai/gpt-5-mini`                                         |

Enable AI Gateway access for the Vercel team. The Gateway SDK uses Vercel's OIDC
credentials automatically. A Gateway API key is optional. The team may need a
valid payment method before Gateway will serve requests. Credentials must never
use a `VITE_` prefix.

`node scripts/configure-vercel-cloud.mjs` configures the Aquinas production
project using the authenticated Vercel CLI. It saves the initial setup token in
the ignored `.env.cloud.setup.local` file and sends secret values through stdin.
It preserves the generated authentication secret when rerun.

## Automatic deployments

The Aquinas `suiteleaf` project is connected to `MisterTea/SuiteLeaf` on GitHub.
Its production branch is `main`: every push starts a production deployment and
assigns the production domain after a successful build. `vercel.json` selects
the container runtime and Ohio region; `Dockerfile.vercel` builds the server,
auth sidecar, and web app together. Keep these cloud sources in main.

Production secrets remain in Vercel project settings. Do not commit environment
files. Schema changes still require a separately reviewed migration before the
new server is released; ordinary application pushes need no manual deployment.

## Release

Build the backend and auth service, then pull production variables into an ignored
file. Apply migrations separately from server startup:

```sh
cargo build -p suiteleaf-node
npm run build:auth
vercel env pull .env.cloud.production.local --environment production --scope aquinas
node scripts/migrate-cloud.mjs .env.cloud.production.local
vercel deploy --prod --skip-domain --scope aquinas
```

`Dockerfile.vercel` builds the web application with `VITE_SUITELEAF_SERVER=1`,
which keeps it in server mode even when the API is temporarily unavailable.
Validate the staged production deployment before promoting it. Set
`SUITELEAF_PUBLIC_URL` to the verified production alias and redeploy if it changes.
Keep Vercel preview protection; production sign-in must be reachable by invitees.

Open `https://<production-host>/#/?invite=<setup-token>` to create the first
administrator. Ordinary visitors cannot claim this account. After an account
exists, the setup token no longer authorizes registration. In **Admin → People →
Invite a person**, create an email-bound invitation link. Links expire after
seven days and can be used once. No email is sent automatically.

## Durability and recovery

An upload becomes a version only after its immutable blobs have been stored.
Intermediate upload chunks and offsets are persisted in Postgres. Saves check
version preconditions under cross-instance locks. Permanent deletion checks all
retained versions before removing shared chunks.

Collaboration updates are committed before acknowledgement. Active instances poll
a sequenced metadata-only change feed every 250 ms, replay stored updates, and
reconnect when Vercel closes a socket. Room generation, seed ownership, presence,
and compaction are coordinated through Postgres. Process memory is a cache.

Existing backup/restore functions accept the cloud storage adapters. A cloud
database checkpoint exports a consistent Postgres snapshot into the existing
portable SQLite backup format; this archive is not a live cloud database.
Keep backups outside the container, and back up the database and the referenced
Blob objects together. Version history alone is not a backup.

## Verification

Run `cargo test --workspace`, `npm run test:coverage`, and the focused cloud tests.
Postgres integration tests require an isolated loopback database:

```sh
# Set SUITELEAF_TEST_POSTGRES_URL to an isolated local Postgres database.
cargo test -p suitedb --test postgres -- --ignored
# Pull the testing Blob store credentials into .env.local first.
# Set SUITELEAF_CLOUD_INTEGRATION=1 and optionally SUITELEAF_TEST_GATEWAY=1.
npx vitest run services/auth/test/cloud-integration.test.ts
```

The HTTP integration tests create and remove a random Postgres schema, launch two
independent servers, use the testing Blob store, and verify invitations, versions,
conflicts, interrupted uploads, concurrent editing, restart replay, and access
revocation. They never accept a non-loopback database. Gateway tests make real
billable model requests and verify streaming and cancellation.
