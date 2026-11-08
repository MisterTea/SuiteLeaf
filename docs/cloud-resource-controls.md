# Cloud resource controls

The November 2026 resource investigation found aggressive client polling and repeated container builds. The controls below reduce recurring work while retaining fallback synchronization and prompt access revocation.

## Client requests

- Polling pauses in hidden/offline pages, refreshes on return, waits for completion before scheduling again, and backs off failures up to one minute. Local save events coalesce into one follow-up request when a poll is already running.
- The author label and remote-version watcher share one item observation. Authoritative reads during conflict resolution remain fresh, separate reads.
- Cloud collaboration sockets advertise notification support. File changes invalidate metadata through the socket; connected files have a 30-second safety poll. Older servers or disconnected sockets retain the two-second fallback.
- Presence uses the authenticated socket where supported, with an eight-second response timeout and HTTP fallback. The five-second heartbeat and existing presence expiry remain intact. Hidden pages stop presence polling and close their socket after all queued edits are acknowledged. They rejoin from persisted room state on return; pending edits keep their connection/retry path until acknowledged.
- Notices refresh every 30 seconds. Lists, comments, and the admin replication panel refresh every ten seconds while visible.

An idle connected cloud file now schedules approximately 240 HTTP polls per hour (120 notices plus 120 shared metadata checks), versus 8,640 before, excluding auth, initial requests, events, comments, and other panels. This is a schedule-based estimate, not a measured billing reduction. A disconnected/older-server file keeps faster fallback behavior. Existing browser tabs need reloading to receive the client fixes.

## Server work

- Cloud mode uses an offline peer handle instead of initializing libp2p.
- A new instance captures the change-feed tip before opening its listener. Each socket join still recovers authoritative room state. Later events are replayed from that cursor, avoiding old historical replay on every cold start.
- Cloud polling backs off from 250 ms to two seconds when quiet (up to 87.5% fewer quiet queries) and resumes 250 ms polling after relevant activity. Errors back off to 30 seconds. The single change-feed SELECT avoids the generic query API's extra transaction round trips.
- Maintenance uses an atomic Postgres-clock lease, limiting sweeps to once per configured interval across the fleet. A crashed holder's lease expires. Sweeps restore only abandoned multiuser rooms and retain the existing mutation lock and compaction checks. Production maintenance remains every 30 seconds; credential/access rechecks remain every five seconds.

The lease table is additive and compatible with older application versions. Before deploying this release, run:

```powershell
cargo build -p suiteleaf-node
node scripts/migrate-cloud.mjs .env.cloud.production.local
```

## Builds

`Dockerfile.vercel` uses a cargo-chef recipe layer for Rust dependencies, and copies npm workspace manifests before installing dependencies. Source edits can reuse both dependency layers. The first build populates these caches. `.dockerignore` and `.vercelignore` exclude local coverage, temporary files, and private environment files from upload/context.

Build stages use slim base images. The npm install includes only the web, core, and auth workspaces plus root build tools, and clears the download cache in the same layer. Desktop and local AI service dependencies are not needed in the cloud image. Monitor the persisted cache against Standard's 1.5 GB limit; an oversized cache is discarded even when Docker dependency layers are correctly separated.

The web build explicitly allows a 4 GiB V8 heap. The Standard builder's container otherwise defaults to 2 GiB, which is too small for this app's bundle. This setting is scoped to the build command and leaves room for native allocations on the 8 GiB builder.

The ignored-build script compares against `VERCEL_GIT_PREVIOUS_SHA`, covering all commits since the previous deployment. Docs, tests, workflow files, and desktop source changes can skip the cloud build. Workspace manifests and unknown inputs build conservatively. Missing history and first deployments always build; `VERCEL_FORCE_BUILD=1` overrides skipping.

Git metadata must remain available in the Vercel checkout until the ignored build step runs; do not exclude `.git` in `.vercelignore`. The Docker context still excludes `.git` through `.dockerignore`. The project uses a fixed Standard build machine rather than the previous 30-core Turbo machine. Build CPU minutes count allocated cores times elapsed build minutes, so the smaller builder lowers the per-minute rate while caches limit rebuild work.

Verify with the polling/component Vitest tests, the isolated Postgres suite, the multiuser Rust suite, the cloud integration suite, and a container build. Inspect cache hits in a subsequent build and compare unique startup identities, foreground/background API rates, and project-specific CPU/memory billing after rollout. Container log copies are broadcast across in-flight requests and must not be counted as separate starts.
