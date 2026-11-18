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

The Aquinas `suiteleaf` project stays connected to `MisterTea/SuiteLeaf` on
GitHub, and its production branch is `main`. `vercel.json` sets
`git.deploymentEnabled` to false, so a push does not start a Vercel build
machine. GitHub Actions builds `Dockerfile.vercel` on a standard runner, which
is free for this public repository, then `vercel deploy --prebuilt` uploads
that result. The container still runs in Ohio. Keep these cloud sources in main.

`.github/workflows/vercel-preview.yml` has two jobs. A pull request builds and
deploys a preview, then checks it. A push to `main` builds and deploys
production and assigns the production domain. Docs, tests, workflow files, and
desktop source changes skip both jobs. Run the workflow manually with
**workflow_dispatch** on `main` to build and deploy production anyway. The
container smoke test in `ci.yml` still runs.

Production secrets remain in Vercel project settings. Do not commit environment
files. Schema changes still require a separately reviewed migration before the
new server is released. Do not deploy with `vercel deploy --prod` without
`--prebuilt`: that command builds on Vercel again.

### PR deployment check

The preview job checks out the PR head commit, not GitHub's synthetic merge
commit. It runs `vercel pull`, `vercel build`, and `vercel deploy --prebuilt`,
then checks the web app, `/api/node/info`, and the auth providers endpoint. It
verifies cloud mode, Postgres, Blob configuration, and invite-only
authentication. Failed, canceled, blocked, missing, and unhealthy deployments
fail the check. Updates cancel the older check for that PR.

Enable it as follows:

1. Configure Vercel Preview variables with a **testing** Neon database, private
   Blob store, auth secret, and bootstrap token hash. Migrate that testing
   database separately. Do not inherit production database or storage
   credentials. Avoid a production `SUITELEAF_PUBLIC_URL` override in Preview.
2. Keep the GitHub environment `vercel-preview` with required reviewers. Review
   the exact PR revision before approving the job: it builds that revision and
   deploys it with environment credentials. Fork pull requests do not receive
   these credentials.
3. In `vercel-preview`, store secrets `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
   `VERCEL_TOKEN`, and `VERCEL_AUTOMATION_BYPASS_SECRET`. The token must be
   allowed to read project environment variables and create deployments. Store
   the same three Vercel values in the `vercel-production` environment, which
   has no reviewer gate, so pushes to `main` deploy on their own. The bypass
   secret is only needed for the preview check. Set values directly in GitHub;
   never commit them. Missing credentials fail a cloud-changing PR rather than
   silently passing it.
4. After the first successful run, require **Vercel preview smoke test** in the
   `main` branch ruleset, alongside the existing CI checks. Require branches to
   be up to date before merging. This is a preview smoke check; production-only
   configuration and full data operations need separate tests.

Creating a deployment from a Git reference in the Vercel dashboard still builds
on a Vercel machine. Use the GitHub workflow instead. Set a short Preview
retention policy in **Project Settings → Build and Deployment → Deployment
Retention Policy** to bound older deployment storage. Retention has exceptions
for recent deployments, custom aliases, and active PR branches; deletion also
has a recovery period, so it is not immediate. See [Vercel's retention policy
documentation](https://vercel.com/docs/deployment-retention).

### Database credentials

Keep Neon connection strings in the server-side `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` environment variables. The runtime and migration scripts
read these variables; there must be no connection-string fallback in source code.
For local work, copy `.env.cloud.example` to the ignored `.env.cloud.local`, fill
in the values privately, and run:

```sh
node scripts/migrate-cloud.mjs .env.cloud.local
```

In Vercel, store both variables as Secrets for each environment that uses Neon.
After rotating a Neon password, update both the pooled and direct connection
strings in Vercel and any ignored local files, then redeploy so running functions
receive the new values. Do not put connection strings in command arguments,
browser code, or variables beginning with `VITE_`.

The removed temporary `scripts/import-slides.mts` runner contained credentials in
an older Git commit, including an administrator session token. Deleting the file
does not erase that commit: rotate the database password and revoke the exposed
session in Admin. Do not restore the runner with embedded credentials.

Run `npm run check:secrets` before committing. CI runs the same check and reports
only paths and line numbers, never credential values. It scans current repository
files; it does not remove historical commits or replace credential rotation.

## Release

Build the backend and auth service, then pull production variables into an ignored
file. Apply migrations separately from server startup:

```sh
cargo build -p suiteleaf-node
npm run build:auth
vercel env pull .env.cloud.production.local --environment production --scope aquinas
node scripts/migrate-cloud.mjs .env.cloud.production.local
```

A normal push to `main` is deployed by GitHub Actions. For a staged manual
deploy, build the image locally with Docker and upload only the prebuilt output:

```sh
vercel pull --yes --environment=production --scope aquinas
vercel build --prod --yes
vercel deploy --prebuilt --prod --skip-domain --archive=tgz --scope aquinas
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
