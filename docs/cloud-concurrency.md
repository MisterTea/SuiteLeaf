# Cloud concurrency control

Hosted SuiteLeaf runs several instances against one Neon Postgres database,
private Vercel Blob storage, and in-memory Yjs rooms. Cross-instance mutual
exclusion uses Postgres transaction-level advisory locks
(`Db::lock_all` / `Db::try_lock_all`): every lock set is taken in one
transaction, deduplicated (strongest mode wins) and ordered by key, so
overlapping sets cannot deadlock. Every wait is bounded by
`lock_timeout = 10s`; a timed-out request returns 503 instead of hanging.

There is no database-wide lock. The locks are:

| Lock | Mode | Held by |
| --- | --- | --- |
| `drive` | shared | Item-level work: content saves, v2 section commits, version names/restores, public/respond links, comments, presence, form answers, notice dismissal, and every collaboration room step |
| `drive` | exclusive | Tree and access changes: create, rename/move/trash (PATCH), delete forever (also blob GC), ACL, expiry, guests, owner transfer, copies, admin changes, public-sharing policy |
| `item:{id}` | exclusive | HTTP mutations of item `id` **and** its collaboration room (join, leave, apply update, catch-up, compaction, restore) |
| `respond:{token}` | exclusive | Public form answers for one respond link |
| `accounts` | exclusive | Sign-up (held from the invite/bootstrap check through account creation and invite deletion), invitations, sessions, emergency sign-in, admin user/group changes |
| `file:{id}`, upload parts | exclusive | Short inner sections inside suitedrive (separate pool) |

Route-to-lock mapping lives in `crates/suiteleaf-node/src/cloud.rs`
(`mutation_locks`); unknown mutating routes fall back to
`accounts` + exclusive `drive`.

Invariants:

- **Rooms**: a room's read-merge-write (catch up from the update log, apply,
  store) runs under `item:{id}`, so edits to one room are serialized across
  instances and converge; different rooms never wait on each other.
  Maintenance try-locks one room per step and skips busy rooms.
- **Content**: writes also use `If-Match` on `headVersionId` (optimistic
  concurrency, 409 on conflict) under `file:{id}`.
- **Blobs**: blobs are content-addressed and written before the version row
  that points at them. Garbage collection (`delete_forever`) holds `drive`
  exclusively, and commits hold it shared, so a commit's "every referenced
  blob exists" check and its pointer write cannot interleave with GC.
  Blobs uploaded but never committed are not collected (pre-existing).
- **Sign-up**: two concurrent sign-ups cannot both consume one single-use
  invitation or both become the bootstrap first admin.
- **Change feed**: each `transact` still takes a short global commit lock so
  `_cloud_ops.seq` commits in order for `changes_since` readers.
- **Storage budget**: `ensure_room` is a soft check; concurrent uploads can
  overshoot it by the size of the in-flight uploads.
