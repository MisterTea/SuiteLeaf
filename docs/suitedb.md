# SuiteDB

SuiteDB is the database inside every SuiteLeaf node. Each node keeps a complete SQLite copy. Writes become signed operations that replicate to every node, and a CRDT merge rule guarantees that nodes that have seen the same operations hold identical tables, whatever order the operations arrived in. Auth accounts and sessions (better-auth) and SuiteDrive metadata are both SuiteDB tables.

The implementation is in [`crates/suitedb`](../crates/suitedb). It's wired to the network by [`crates/suiteleaf-node`](../crates/suiteleaf-node).

## Operations

A local write creates one **op**: a signed batch of row changes.

```rust
struct OpBody {
    parents: Vec<OpId>, // the author's DAG heads when the op was created
    hlc: Hlc,           // hybrid logical clock: (wall ms, counter, node tag)
    schema: u32,        // schema version the op was written with
    author: [u8; 32],   // the node's Ed25519 public key
    changes: Vec<Change>, // Upsert(table, pk, columns) or Delete(table, pk)
}
struct Op { body: OpBody, sig: Vec<u8> } // Ed25519 signature over CBOR(body)
// OpId = BLAKE3(CBOR(body))
```

- Ops link to their parents by hash, so the log is a Merkle DAG, like a blockchain without consensus. Each node tracks its current heads, and two nodes have seen the same ops exactly when their heads match.
- Every op is signed with the author node's libp2p identity key. Receivers verify the signature, and if `allowlist` is set, they also check the author.
- An op whose parents haven't arrived waits in `_pending` and is applied when they do.

## Merge rules

- **Columns** are last-writer-wins registers. A column's version is `(op HLC, change index within the op)`, and a write applies only if its version is higher than the column's current version.
- **Rows** track three versions: when they were first created, last upserted, and last deleted. A row is visible when its newest upsert is newer than its newest delete.
- **Deletes** hide every column written before them. If a later upsert brings a row back, only columns written after the delete are visible; the rest read as `NULL`.

Each register only ever moves to a larger version, so applying ops is commutative and idempotent. [`tests/crdt.rs`](../crates/suitedb/tests/crdt.rs) checks this with a property test: three replicas receive random interleavings of shuffled, duplicated ops, and their tables, conflict records, and heads must end up identical.

The hybrid logical clock keeps versions ordered roughly by wall time, even when clocks disagree. A node advances its clock past every timestamp it observes, except ones more than five minutes in the future.

## Unique keys

Without consensus, two nodes can't both enforce a unique column such as `user.email`, so materialized tables have no `UNIQUE` constraints. Tables declare `unique` columns instead, and after every merge SuiteDB records collisions in `_conflicts`:

- The row created first wins (lowest creation version, then primary key). Every node picks the same winner.
- The losing row is kept, so no data is lost, but the auth adapter hides it from lookups. Signing in by email or username therefore always finds the same account on every node.
- An administrator resolves a conflict by changing or deleting the losing row.

## Schema

Replicated tables are declared in code:

- better-auth's tables are generated into [`services/auth/schema.json`](../services/auth/schema.json) by `npm run generate-schema -w @suiteleaf/auth`.
- SuiteDrive's tables are in [`crates/suitedrive`](../crates/suitedrive/src/lib.rs).

The node's schema version is `auth version × 100 + drive version`. On startup, missing tables and columns are created. A node holds back ops written with a newer schema until it's upgraded, and it refuses to open a database written by a newer build.

## Sync

| Mechanism | Purpose |
| --- | --- |
| Gossipsub topic `suiteleaf/suitedb/ops/1` | Delivers each new op to connected nodes in real time. |
| Request/response `/suiteleaf/suitedb/sync/1` | Catches a node up. It pages through a peer's op-log in that peer's arrival order, starting after a saved per-peer cursor. |

A peer's arrival order is topological (parents always come first), so paging through it never stalls on missing parents. A node pulls from a peer when they connect, every `sync_interval_secs` seconds, and whenever a gossiped op arrives with unknown parents. Cursors are tied to the peer database's random `epoch`, so if a peer's database is replaced, the cursor restarts from zero.

## Trust model

A cluster is a set of trusted nodes:

- Connections require the cluster's private-network key (`swarm.key`).
- `allowlist` optionally restricts both which peers can connect and which nodes can author ops.
- Every node stores everything: password hashes, OAuth tokens (encrypted with the shared auth secret), and every SuiteDrive file. Only run nodes on machines you would trust with all of that data.

## Limits

- Consistency is eventual. Unique keys and logouts take effect everywhere only after their ops replicate. JWTs last 15 minutes.
- The op-log grows without bound. Compaction and snapshot bootstrap for new nodes aren't implemented.
- The internal adapter API (`/internal/db`) listens on loopback only and requires a per-boot token.
