# Vercel resource investigation, 7 November 2026

Investigated project `aquinas/suiteleaf` (`prj_kxZaPLbAIMvIp18Gob9hKTQOoyJM`). Read production logs, deployment history, billing usage, and the matching repository code. No production settings or application code were changed.

## Findings

There are two separate problems: expensive repeated container builds and excessive recurring work from open clients. The available evidence does not establish an unbounded CPU loop.

### Billing: builds dominate current costs

Project-grouped billing usage returned these approximate quantities for 5 November 22:05 UTC through 7 November 22:05 UTC (the project was created on 6 November). Billing is delayed and these are usage charges before credits, not the final invoice. Relative date ranges can produce prorated quantities.

| Resource | Quantity | Usage charge |
| --- | ---: | ---: |
| Build CPU | 2,250 CPU minutes | $7.875 |
| Runtime provisioned memory | 23.30 GB-hours | $0.247 |
| Runtime active CPU | 0.936 CPU-hours | $0.120 |
| Function invocations | about 33,197 | $0.020 |
| Fast origin transfer | 2.59 GB | $0.156 |

Build CPU is about 21 times runtime CPU plus memory cost. Do not confuse the team's totals across other projects with SuiteLeaf's usage: the team-wide current-cycle active CPU total was 6.58 hours, while this project returned about 0.94 hours for the queried window.

Deployment history showed 14 ready production deployments plus one building deployment in the latest 15 records. Most were main-branch pushes. `Dockerfile.vercel` compiles the Rust server in a clean build stage and separately installs npm dependencies and builds web/auth. Rust source changes invalidate the Cargo build layer; any source change under apps/packages/services invalidates the layer before `npm ci`. There are no explicit dependency compilation or npm cache mounts in this Dockerfile. Actual cache hit rates and the contribution of each build stage still require build-log analysis; billing alone does not identify the slow stage.

### Client polling creates continuous traffic without edits

An open signed-in cloud file can schedule this baseline:

| Source | Schedule | Requests per hour |
| --- | --- | ---: |
| `apps/web/src/drive/share-notices.tsx` | Notices GET every second | 3,600 |
| `apps/web/src/drive/LastEdited.tsx` | Item GET every two seconds | 1,800 |
| `apps/web/src/workspace/workspace-remote.ts`, remote version watcher | Same item GET every two seconds | 1,800 |
| Same file, presence | Presence POST then GET every five seconds | 1,440 |
| Total | Before comments, lists, auth, sockets, or user actions | 8,640 |

These schedules do not check document visibility. Notices, last-edited metadata, remote version checks, and presence also lack a single-in-flight guard. Slow requests can overlap subsequent ticks. Browser timer throttling may reduce hidden-tab frequency, so 8,640 is the configured visible-tab baseline rather than a measured request rate. Multiple tabs multiply the work.

Additional recurring requests: DriveBrowser refreshes every two seconds; an open comments panel refreshes every two seconds (comments already guard against overlapping loads). The server-status hook already demonstrates a visibility check, unlike the above pollers.

Recent production application logs were dominated by notices, file metadata, and presence for one file, matching these sources. Log counts are not request counts: container stdout/stderr is broadcast to every in-flight request. A bounded 100-record sample covering 22:01:34.932–22:03:52.258 UTC contained 69 copies of NODE_READY but only 35 distinct ready messages/peer identities. This establishes substantial startup churn in the sample, not 69 independent cold starts and not a cold-start percentage. Each startup initializes database access, admin checks, peer networking, and the Node authentication sidecar.

### Open collaboration sockets add persistent backend work

`crates/suiteleaf-node/src/main.rs` runs cloud room polling every 250 ms. `Rooms::poll_cloud` in `collab.rs` correctly skips database work when the instance has no sockets. With at least one socket it calls `Db::changes_since`: up to 14,400 change-feed queries per hour per active container, independent of whether anyone edits. Each query currently translates SQL and opens a read-only transaction, prepares, queries, and commits (`crates/suitedb/src/postgres_store.rs`).

The cursor starts at zero on each container. A new instance with a socket can replay historical `_cloud_ops` in batches of 1,000 before reaching the current tip. Room changes trigger catch-up of all locally open rooms. These are amplification risks as history and room counts grow; their current CPU share was not measurable.

Every cloud instance also immediately runs room maintenance and repeats it every 30 seconds. Maintenance takes the shared `cloud-mutations` advisory lock, looks up all multiuser rooms, restores rooms missing locally, scans expired signals and presence, and checks compaction. Cold-start bursts can therefore multiply maintenance and contend with real mutations.

The socket checks credentials/access every five seconds. Preserve prompt revocation when optimizing this. Open sockets legitimately keep requests in flight, affecting provisioned memory duration. A sleeping timer is not itself proof of CPU consumption: the repeated database and processing work is what matters.

Cloud startup also initializes libp2p even though cloud replication is disabled and the configured listen/bootstrap lists are empty. One sampled socket request logged a Kademlia warning about having no known peers. This is unnecessary background/startup work, but its magnitude is unmeasured.

## Recommended order of work

1. Stop nonessential polling in hidden tabs, coalesce duplicate item reads, and allow only one outstanding request per poller. Use completion-based scheduling and bounded error backoff. Refresh promptly on visibility/focus and local save events. Make notices substantially less frequent or event-driven.
2. Reuse the collaboration channel for file/presence updates where possible, with a slower fallback when disconnected. Explicitly choose background collaboration behavior so unsaved changes and revocations remain correct.
3. Replace the 250 ms change-feed polling with an appropriate notification mechanism or adaptive polling. Establish a safe current cursor when subscribing and recover authoritative state with race coverage. Avoid simply jumping to the tip and risking missed updates.
4. Coordinate cloud maintenance across containers, avoid eagerly restoring unrelated rooms on every cold start, and skip unused peer networking in cloud mode.
5. Optimize Docker dependency layers/caching and avoid deploying commits that cannot affect the cloud artifact. Assess build-stage timing before deciding whether to build the image in existing GitHub CI and deploy an immutable image.

Validation should measure idle foreground/background request counts, overlapping requests under slow responses, collaboration convergence and revocation, change-feed queries, and unique instance startup identities before and after. Behavior belongs in Vitest; backend changes also need Rust/integration coverage. No application tests were run for this read-only investigation.

## Evidence and limits

- CLI: `vercel --scope aquinas billing usage --group-by project --since 2d --json`.
- Logs: production deployment `dpl_5U1A28otn73koSHwCSnCMHiCB6Rq`, recent 30-minute window and the bounded sample above. A different main commit began building during the investigation; no deployment was initiated here.
- Detailed per-route CPU/duration metrics queries were rejected with `payment_required`: Observability Plus is required. No subscription was purchased. Thus polling is proven in source and reflected in logs, but the fraction of runtime CPU it consumes is not established.
- [Container logging and scaling semantics](https://vercel.com/docs/functions/runtimes/container): logs are broadcast across in-flight requests; count unique startup identities rather than raw log lines.
- [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing): active CPU differs from elapsed request/provisioned-memory duration.
