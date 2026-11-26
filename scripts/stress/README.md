# Cloud locking stress tests (fake environment)

Nothing here talks to Vercel, Neon, or Vercel Blob. Both suites start a
throwaway `postgres:16-alpine` container on loopback and remove it on exit.

## 1. Rust, in-process (`scripts/stress/run-rust-stress.sh`)

Real `Db`, `Rooms`, `Drive`, and the real request-lock middleware; several
in-process "instances" (each with its own Postgres pools and rooms, like
Fluid instances); a local-filesystem blob store. Tests live in
`crates/suiteleaf-node/src/collab/tests/stress.rs` (all `#[ignore]`):

- room edits from 4 instances × 4 writers on 2 and 32 rooms: documents
  converge byte-identically, no lost or duplicated edit, no errors; compared
  with the old global lock emulated (one fleet-wide exclusive lock per edit)
- room maintenance (`kick`) looping on every instance during edits
- `kick` skips a busy room and kicks the rest
- a stuck room holder / stuck request lock fails waiters after ~10s (503 over
  HTTP), other items are unaffected, and everything recovers
- request middleware under write load (2 instances): throughput vs the old
  global lock, and sign-in latency
- bursts of 16 concurrent sign-ups on the bootstrap token and on one invite:
  exactly one winner

```sh
scripts/stress/run-rust-stress.sh            # all stress tests
scripts/stress/run-rust-stress.sh stuck      # name filter
```

## 2. HTTP, real containers (`scripts/stress/run-http-stress.sh`)

N containers of the act-built image (`act -j vercel` → `suiteleaf-vercel:ci`)
on one Postgres, each running the real node and the real Better Auth sidecar.
`fake-bridge.mjs` (mounted via `cloud-fake.toml`) proxies auth and stands in
for the Vercel Blob bridge with a shared temp directory.
`stress_http.py` (stdlib only) runs:

- 12 concurrent bootstrap sign-ups and 12 concurrent redemptions of one
  invite (exactly one winner each), 5 rounds of two admins demoting each
  other at once (exactly one succeeds, one admin left)
- a timed workload from 24 workers across instances: saves with `If-Match`
  (shared payloads so blobs are deduplicated), deliberate stale saves
  (must be 409), comments, renames, moves, folder moves (cycle attempts),
  trash + delete forever (blob GC), ACL changes; `STRESS_MIX=items` runs
  saves + comments only
- sign-in and get-session sampled throughout (Better Auth rate-limits one
  client IP, so 429s are expected and reported)
- afterwards: no orphaned items, no folder cycles, every live version's blob
  exists, every live file reads back intact

```sh
STRESS_IMAGE=suiteleaf-vercel:ci STRESS_INSTANCES=3 STRESS_SECONDS=40 STRESS_MIX=mixed \
  scripts/stress/run-http-stress.sh
```
