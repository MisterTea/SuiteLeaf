//! SuiteDB: every node holds a complete SQLite copy of the database.
//!
//! Writes become signed [`Op`]s that link to the author's previous DAG heads.
//! Each op is a batch of row changes applied with these CRDT rules:
//!
//! * Every column is a last-writer-wins register ordered by
//!   `(op HLC, change index)`.
//! * A row is visible when its newest upsert is newer than its newest delete.
//!   A delete hides every column written before it, so a row resurrected by a
//!   later upsert only shows columns written after the delete.
//!
//! Each register only ever moves to a larger version, so applying the same
//! ops in any order, any number of times, produces the same tables.

pub mod hlc;
pub mod op;
pub mod schema;
pub mod sync;

use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    path::Path,
    sync::{Mutex, MutexGuard, RwLock},
};

use libp2p_identity::{PeerId, PublicKey, ed25519};
use rusqlite::{
    Connection, OptionalExtension, ToSql, params,
    types::{FromSql, FromSqlResult, ToSqlOutput, ValueRef},
};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

pub use hlc::{Clock, Hlc};
pub use op::{Change, ChangeKind, Op, OpBody, OpId, Value, node_tag};
pub use schema::{Column, ColumnType, Schema, TableDef, quote};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid op: {0}")]
    Invalid(String),
    #[error("schema: {0}")]
    Schema(String),
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl ToSql for Value {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            Value::Null => ToSqlOutput::Borrowed(ValueRef::Null),
            Value::Integer(i) => ToSqlOutput::Borrowed(ValueRef::Integer(*i)),
            Value::Real(f) => ToSqlOutput::Borrowed(ValueRef::Real(*f)),
            Value::Text(s) => ToSqlOutput::Borrowed(ValueRef::Text(s.as_bytes())),
            Value::Blob(b) => ToSqlOutput::Borrowed(ValueRef::Blob(b)),
        })
    }
}

impl FromSql for Value {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        Ok(match value {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(i) => Value::Integer(i),
            ValueRef::Real(f) => Value::Real(f),
            ValueRef::Text(t) => Value::Text(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(b) => Value::Blob(b.to_vec()),
        })
    }
}

impl Value {
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Value::Null => serde_json::Value::Null,
            Value::Integer(i) => (*i).into(),
            Value::Real(f) => {
                serde_json::Number::from_f64(*f).map_or(serde_json::Value::Null, Into::into)
            }
            Value::Text(s) => s.clone().into(),
            Value::Blob(b) => hex::encode(b).into(),
        }
    }
}

/// A row touched by an applied op, local or remote.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RowChange {
    pub table: String,
    pub pk: String,
}

/// Two rows that share a value in a declared unique column. The row created
/// first (lowest version) wins; the loser is kept for an administrator.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conflict {
    pub table: String,
    pub column: String,
    pub value: String,
    pub winner: String,
    pub loser: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IngestReport {
    pub applied: usize,
    pub duplicate: usize,
    pub pending: usize,
    pub rejected: usize,
}

/// A page of a peer's op-log in its local arrival order. Arrival order is
/// topological (parents are always applied first), so a receiver that applies
/// pages in order never lacks a parent from this peer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncBatch {
    pub epoch: String,
    #[serde(with = "sync::byte_vecs")]
    pub ops: Vec<Vec<u8>>,
    pub next: u64,
    pub more: bool,
}

pub type Hook = Box<dyn Fn(&[RowChange]) + Send + Sync>;

/// Builds the changes for one local op; validated against the schema.
pub struct Tx<'a> {
    schema: &'a Schema,
    changes: Vec<Change>,
}

impl Tx<'_> {
    pub fn upsert<K: Into<String>, V: Into<Value>>(
        &mut self,
        table: &str,
        pk: &str,
        columns: impl IntoIterator<Item = (K, V)>,
    ) -> Result<()> {
        let columns: BTreeMap<String, Value> = columns
            .into_iter()
            .map(|(k, v)| (k.into(), v.into()))
            .collect();
        let change = Change {
            table: table.into(),
            pk: pk.into(),
            kind: ChangeKind::Upsert(columns),
        };
        validate_change(self.schema, &change)?;
        self.changes.push(change);
        Ok(())
    }

    pub fn delete(&mut self, table: &str, pk: &str) -> Result<()> {
        let change = Change {
            table: table.into(),
            pk: pk.into(),
            kind: ChangeKind::Delete,
        };
        validate_change(self.schema, &change)?;
        self.changes.push(change);
        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }
}

fn validate_change(schema: &Schema, change: &Change) -> Result<()> {
    let def = schema
        .table(&change.table)
        .ok_or_else(|| Error::Schema(format!("unknown table {}", change.table)))?;
    if change.pk.is_empty() || change.pk.len() > 512 {
        return Err(Error::Schema(format!(
            "invalid primary key for {}",
            change.table
        )));
    }
    if let ChangeKind::Upsert(cols) = &change.kind {
        for (name, value) in cols {
            let ty = def
                .column_type(name)
                .ok_or_else(|| Error::Schema(format!("unknown column {}.{name}", def.name)))?;
            if name == &def.pk {
                if value != &Value::Text(change.pk.clone()) {
                    return Err(Error::Schema(format!("{}.{name} cannot change", def.name)));
                }
            } else if !ty.accepts(value) {
                return Err(Error::Schema(format!("wrong type for {}.{name}", def.name)));
            }
        }
    }
    Ok(())
}

enum Outcome {
    Applied(Vec<RowChange>),
    Duplicate,
    Pending,
}

struct Inner {
    conn: Connection,
    clock: Clock,
}

pub struct Db {
    inner: Mutex<Inner>,
    key: ed25519::Keypair,
    peer: PeerId,
    schema: Schema,
    epoch: String,
    allow: RwLock<Option<HashSet<PeerId>>>,
    hooks: RwLock<Vec<Hook>>,
    local_ops: broadcast::Sender<Vec<u8>>,
}

const INTERNAL_TABLES: &str = "
CREATE TABLE IF NOT EXISTS _ops (
  seq INTEGER PRIMARY KEY,
  id BLOB NOT NULL UNIQUE,
  hlc TEXT NOT NULL,
  author BLOB NOT NULL,
  payload BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS _heads (id BLOB PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _pending (
  id BLOB PRIMARY KEY,
  reason TEXT NOT NULL,
  payload BLOB NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _versions (
  tbl TEXT NOT NULL, pk TEXT NOT NULL, col TEXT NOT NULL, version TEXT NOT NULL,
  PRIMARY KEY (tbl, pk, col)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _rows (
  tbl TEXT NOT NULL, pk TEXT NOT NULL,
  created TEXT, upserted TEXT, deleted TEXT,
  PRIMARY KEY (tbl, pk)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _conflicts (
  tbl TEXT NOT NULL, col TEXT NOT NULL, value TEXT NOT NULL,
  winner TEXT NOT NULL, loser TEXT NOT NULL,
  PRIMARY KEY (tbl, col, loser)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _peers (
  peer TEXT PRIMARY KEY, epoch TEXT, cursor INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
";

fn meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM _meta WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO _meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

impl Db {
    pub fn open(path: &Path, key: ed25519::Keypair, schema: Schema) -> Result<Db> {
        Db::init(Connection::open(path)?, key, schema)
    }

    pub fn open_in_memory(key: ed25519::Keypair, schema: Schema) -> Result<Db> {
        Db::init(Connection::open_in_memory()?, key, schema)
    }

    fn init(mut conn: Connection, key: ed25519::Keypair, schema: Schema) -> Result<Db> {
        schema.validate()?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        let tx = conn.transaction()?;
        tx.execute_batch(INTERNAL_TABLES)?;
        if let Some(stored) = meta(&tx, "schema")? {
            let stored: u32 = stored.parse().unwrap_or(0);
            if stored > schema.version {
                return Err(Error::Schema(format!(
                    "database schema {stored} is newer than this build ({})",
                    schema.version
                )));
            }
        }
        schema.migrate(&tx)?;
        set_meta(&tx, "schema", &schema.version.to_string())?;
        let epoch = match meta(&tx, "epoch")? {
            Some(e) => e,
            None => {
                let e = uuid::Uuid::new_v4().to_string();
                set_meta(&tx, "epoch", &e)?;
                e
            }
        };
        let mut clock = Clock::new(node_tag(&key.public()));
        let latest: Option<String> = tx.query_row("SELECT MAX(hlc) FROM _ops", [], |r| r.get(0))?;
        for stamp in [latest, meta(&tx, "clock")?].into_iter().flatten() {
            if let Some(h) = Hlc::decode(&stamp) {
                clock.observe_at(h, h.wall);
            }
        }
        tx.commit()?;
        let peer = PublicKey::from(key.public()).to_peer_id();
        let db = Db {
            inner: Mutex::new(Inner { conn, clock }),
            key,
            peer,
            schema,
            epoch,
            allow: RwLock::new(None),
            hooks: RwLock::new(Vec::new()),
            local_ops: broadcast::channel(1024).0,
        };
        db.retry_pending()?;
        Ok(db)
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn peer_id(&self) -> PeerId {
        self.peer
    }

    pub fn epoch(&self) -> &str {
        &self.epoch
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    /// Restrict accepted op authors. This node's own key is always accepted.
    pub fn set_allowlist(&self, allow: Option<HashSet<PeerId>>) {
        *self.allow.write().unwrap() = allow;
    }

    /// Called after every applied op with the rows it touched.
    pub fn on_applied(&self, hook: Hook) {
        self.hooks.write().unwrap().push(hook);
    }

    /// Encoded ops created on this node, for gossiping to peers.
    pub fn subscribe(&self) -> broadcast::Receiver<Vec<u8>> {
        self.local_ops.subscribe()
    }

    fn run_hooks(&self, rows: &[RowChange]) {
        if rows.is_empty() {
            return;
        }
        for hook in self.hooks.read().unwrap().iter() {
            hook(rows);
        }
    }

    /// Create, sign, and apply one op from the changes made in `build`.
    /// Returns `None` when no changes were made.
    pub fn transact(&self, build: impl FnOnce(&mut Tx) -> Result<()>) -> Result<Option<OpId>> {
        let mut tx = Tx {
            schema: &self.schema,
            changes: Vec::new(),
        };
        build(&mut tx)?;
        if tx.changes.is_empty() {
            return Ok(None);
        }
        let (id, bytes, rows) = {
            let mut inner = self.lock();
            let hlc = inner.clock.tick();
            let parents = heads(&inner.conn)?;
            let op = Op::sign(
                OpBody {
                    parents,
                    hlc,
                    schema: self.schema.version,
                    author: self.key.public().to_bytes(),
                    changes: tx.changes,
                },
                &self.key,
            );
            let (id, bytes) = (op.id(), op.encode());
            let t = inner.conn.transaction()?;
            let rows = match self.apply(&t, &op, &bytes, id, false)? {
                Outcome::Applied(rows) => rows,
                _ => unreachable!("a local op always has its parents"),
            };
            set_meta(&t, "clock", &hlc.encode())?;
            t.commit()?;
            (id, bytes, rows)
        };
        let _ = self.local_ops.send(bytes);
        self.run_hooks(&rows);
        Ok(Some(id))
    }

    /// Apply one encoded op received from a peer.
    pub fn ingest(&self, bytes: &[u8]) -> Result<IngestReport> {
        self.ingest_many(std::iter::once(bytes))
    }

    /// Apply encoded ops from a peer in one SQLite transaction. Ops with
    /// missing parents wait in `_pending`; invalid or unauthorized ops are
    /// logged and skipped so one bad op cannot stall a sync stream.
    pub fn ingest_many<'a>(&self, ops: impl IntoIterator<Item = &'a [u8]>) -> Result<IngestReport> {
        let mut report = IngestReport::default();
        let mut rows = Vec::new();
        {
            let mut inner = self.lock();
            let inner = &mut *inner;
            let t = inner.conn.transaction()?;
            for bytes in ops {
                let op = match Op::decode(bytes) {
                    Ok(op) => op,
                    Err(e) => {
                        tracing::warn!("{e}");
                        report.rejected += 1;
                        continue;
                    }
                };
                inner.clock.observe(op.body.hlc);
                match self.apply(&t, &op, bytes, op.id(), true) {
                    Ok(Outcome::Applied(r)) => {
                        report.applied += 1;
                        rows.extend(r);
                    }
                    Ok(Outcome::Duplicate) => report.duplicate += 1,
                    Ok(Outcome::Pending) => report.pending += 1,
                    Err(e @ (Error::Invalid(_) | Error::Unauthorized(_) | Error::Schema(_))) => {
                        tracing::warn!("rejected op: {e}");
                        report.rejected += 1;
                    }
                    Err(e) => return Err(e),
                }
            }
            if report.pending > 0 || report.applied > 0 {
                let drained = self.drain_pending(&t)?;
                report.applied += drained.0;
                report.pending = report.pending.saturating_sub(drained.0);
                rows.extend(drained.1);
            }
            t.commit()?;
        }
        rows.sort();
        rows.dedup();
        self.run_hooks(&rows);
        Ok(report)
    }

    /// Re-apply held-back ops, for example after a schema upgrade.
    pub fn retry_pending(&self) -> Result<usize> {
        let (count, rows) = {
            let mut inner = self.lock();
            let t = inner.conn.transaction()?;
            let drained = self.drain_pending(&t)?;
            t.commit()?;
            drained
        };
        self.run_hooks(&rows);
        Ok(count)
    }

    fn drain_pending(&self, conn: &Connection) -> Result<(usize, Vec<RowChange>)> {
        let mut applied = 0;
        let mut rows = Vec::new();
        loop {
            let pending: Vec<(Vec<u8>, Vec<u8>)> = conn
                .prepare("SELECT id, payload FROM _pending")?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?;
            let mut progress = false;
            for (_, bytes) in pending {
                let Ok(op) = Op::decode(&bytes) else { continue };
                if let Ok(Outcome::Applied(r)) = self.apply(conn, &op, &bytes, op.id(), false) {
                    applied += 1;
                    rows.extend(r);
                    progress = true;
                }
            }
            if !progress {
                return Ok((applied, rows));
            }
        }
    }

    fn apply(
        &self,
        conn: &Connection,
        op: &Op,
        bytes: &[u8],
        id: OpId,
        verify: bool,
    ) -> Result<Outcome> {
        let known: bool = conn
            .query_row("SELECT 1 FROM _ops WHERE id = ?1", [&id.0[..]], |_| {
                Ok(true)
            })
            .optional()?
            .is_some();
        if known {
            conn.execute("DELETE FROM _pending WHERE id = ?1", [&id.0[..]])?;
            return Ok(Outcome::Duplicate);
        }
        if verify {
            op.verify()?;
            let author = op.author_peer()?;
            let allowed = author == self.peer
                || self
                    .allow
                    .read()
                    .unwrap()
                    .as_ref()
                    .is_none_or(|a| a.contains(&author));
            if !allowed {
                return Err(Error::Unauthorized(format!(
                    "{author} is not a cluster member"
                )));
            }
        }
        let hold = |reason: &str| -> Result<Outcome> {
            conn.execute(
                "INSERT OR IGNORE INTO _pending (id, reason, payload) VALUES (?1, ?2, ?3)",
                params![&id.0[..], reason, bytes],
            )?;
            Ok(Outcome::Pending)
        };
        if op.body.schema > self.schema.version {
            return hold("schema");
        }
        for change in &op.body.changes {
            validate_change(&self.schema, change).map_err(|e| Error::Invalid(e.to_string()))?;
        }
        for parent in &op.body.parents {
            let present = conn
                .query_row("SELECT 1 FROM _ops WHERE id = ?1", [&parent.0[..]], |_| {
                    Ok(())
                })
                .optional()?
                .is_some();
            if !present {
                return hold("parents");
            }
        }
        let stamp = op.body.hlc.encode();
        let mut rows = Vec::with_capacity(op.body.changes.len());
        let mut touched = BTreeSet::new();
        for (index, change) in op.body.changes.iter().enumerate() {
            let def = self.schema.table(&change.table).expect("validated");
            apply_change(conn, def, change, &format!("{stamp}{index:04x}"))?;
            touched.insert(def.name.clone());
            rows.push(RowChange {
                table: change.table.clone(),
                pk: change.pk.clone(),
            });
        }
        for table in touched {
            refresh_conflicts(conn, self.schema.table(&table).expect("validated"))?;
        }
        conn.execute(
            "INSERT INTO _ops (id, hlc, author, payload) VALUES (?1, ?2, ?3, ?4)",
            params![&id.0[..], stamp, &op.body.author[..], bytes],
        )?;
        for parent in &op.body.parents {
            conn.execute("DELETE FROM _heads WHERE id = ?1", [&parent.0[..]])?;
        }
        conn.execute("INSERT OR IGNORE INTO _heads (id) VALUES (?1)", [&id.0[..]])?;
        conn.execute("DELETE FROM _pending WHERE id = ?1", [&id.0[..]])?;
        Ok(Outcome::Applied(rows))
    }

    /// A page of this node's op-log after `cursor`, for a peer catching up.
    /// A cursor from a different epoch (another database) restarts at zero.
    pub fn ops_since(
        &self,
        epoch: Option<&str>,
        cursor: u64,
        max_bytes: usize,
    ) -> Result<SyncBatch> {
        let start = if epoch == Some(self.epoch.as_str()) {
            cursor
        } else {
            0
        };
        let inner = self.lock();
        let mut stmt = inner
            .conn
            .prepare("SELECT seq, payload FROM _ops WHERE seq > ?1 ORDER BY seq LIMIT 10000")?;
        let mut rows = stmt.query([start as i64])?;
        let (mut ops, mut size, mut next, mut more) = (Vec::new(), 0usize, start, false);
        while let Some(row) = rows.next()? {
            let payload: Vec<u8> = row.get(1)?;
            if !ops.is_empty() && size + payload.len() > max_bytes {
                more = true;
                break;
            }
            size += payload.len();
            next = row.get::<_, i64>(0)? as u64;
            ops.push(payload);
        }
        if !more && ops.len() == 10000 {
            more = true;
        }
        Ok(SyncBatch {
            epoch: self.epoch.clone(),
            ops,
            next,
            more,
        })
    }

    pub fn cursor(&self, peer: &str) -> Result<(Option<String>, u64)> {
        let inner = self.lock();
        Ok(inner
            .conn
            .query_row(
                "SELECT epoch, cursor FROM _peers WHERE peer = ?1",
                [peer],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u64)),
            )
            .optional()?
            .unwrap_or((None, 0)))
    }

    pub fn set_cursor(&self, peer: &str, epoch: &str, cursor: u64) -> Result<()> {
        self.lock().conn.execute(
            "INSERT INTO _peers (peer, epoch, cursor) VALUES (?1, ?2, ?3)
             ON CONFLICT (peer) DO UPDATE SET epoch = excluded.epoch, cursor = excluded.cursor",
            params![peer, epoch, cursor as i64],
        )?;
        Ok(())
    }

    pub fn heads(&self) -> Result<Vec<OpId>> {
        heads(&self.lock().conn)
    }

    pub fn op_count(&self) -> Result<u64> {
        Ok(self
            .lock()
            .conn
            .query_row("SELECT COUNT(*) FROM _ops", [], |r| r.get::<_, i64>(0))? as u64)
    }

    pub fn pending_count(&self) -> Result<u64> {
        Ok(self
            .lock()
            .conn
            .query_row("SELECT COUNT(*) FROM _pending", [], |r| r.get::<_, i64>(0))?
            as u64)
    }

    /// Run read-only queries. Writes must go through [`Db::transact`].
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let inner = self.lock();
        inner.conn.execute_batch("PRAGMA query_only = ON")?;
        let result = f(&inner.conn);
        inner.conn.execute_batch("PRAGMA query_only = OFF")?;
        result
    }

    /// Run a read-only query and return rows as column-name maps.
    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<BTreeMap<String, Value>>> {
        self.read(|conn| {
            let mut stmt = conn.prepare(sql)?;
            let names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
            let rows = stmt
                .query_map(rusqlite::params_from_iter(params), |row| {
                    let mut out = BTreeMap::new();
                    for (i, name) in names.iter().enumerate() {
                        out.insert(name.clone(), row.get::<_, Value>(i)?);
                    }
                    Ok(out)
                })?
                .collect::<std::result::Result<_, _>>()?;
            Ok(rows)
        })
    }

    pub fn get(&self, table: &str, pk: &str) -> Result<Option<BTreeMap<String, Value>>> {
        let def = self
            .schema
            .table(table)
            .ok_or_else(|| Error::Schema(format!("unknown table {table}")))?;
        let sql = format!(
            "SELECT * FROM {} WHERE {} = ?1",
            quote(&def.name),
            quote(&def.pk)
        );
        Ok(self
            .query(&sql, &[Value::Text(pk.into())])?
            .into_iter()
            .next())
    }

    pub fn conflicts(&self) -> Result<Vec<Conflict>> {
        self.read(|conn| {
            Ok(conn
                .prepare("SELECT tbl, col, value, winner, loser FROM _conflicts ORDER BY tbl, col, value, loser")?
                .query_map([], |r| {
                    Ok(Conflict {
                        table: r.get(0)?,
                        column: r.get(1)?,
                        value: r.get(2)?,
                        winner: r.get(3)?,
                        loser: r.get(4)?,
                    })
                })?
                .collect::<std::result::Result<_, _>>()?)
        })
    }
}

fn heads(conn: &Connection) -> Result<Vec<OpId>> {
    let ids: Vec<Vec<u8>> = conn
        .prepare("SELECT id FROM _heads ORDER BY id")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(ids
        .into_iter()
        .filter_map(|b| b.try_into().ok().map(OpId))
        .collect())
}

fn apply_change(conn: &Connection, def: &TableDef, change: &Change, version: &str) -> Result<()> {
    let table = quote(&def.name);
    let pk_col = quote(&def.pk);
    let (created, upserted, deleted): (Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT created, upserted, deleted FROM _rows WHERE tbl = ?1 AND pk = ?2",
            params![def.name, change.pk],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .unwrap_or((None, None, None));
    let save_row =
        |created: &Option<String>, upserted: &Option<String>, deleted: &Option<String>| {
            conn.execute(
            "INSERT INTO _rows (tbl, pk, created, upserted, deleted) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (tbl, pk) DO UPDATE SET created = excluded.created,
               upserted = excluded.upserted, deleted = excluded.deleted",
            params![def.name, change.pk, created, upserted, deleted],
        )
        };
    match &change.kind {
        ChangeKind::Upsert(cols) => {
            let created = Some(created.map_or(version.to_owned(), |c| c.min(version.to_owned())));
            let upserted = Some(upserted.map_or(version.to_owned(), |u| u.max(version.to_owned())));
            save_row(&created, &upserted, &deleted)?;
            let mut visible: Vec<(&String, &Value)> = Vec::new();
            for (col, value) in cols {
                if col == &def.pk {
                    continue;
                }
                let current: Option<String> = conn
                    .query_row(
                        "SELECT version FROM _versions WHERE tbl = ?1 AND pk = ?2 AND col = ?3",
                        params![def.name, change.pk, col],
                        |r| r.get(0),
                    )
                    .optional()?;
                if current.as_deref().is_none_or(|c| version > c) {
                    conn.execute(
                        "INSERT INTO _versions (tbl, pk, col, version) VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT (tbl, pk, col) DO UPDATE SET version = excluded.version",
                        params![def.name, change.pk, col, version],
                    )?;
                    if deleted.as_deref().is_none_or(|d| version > d) {
                        visible.push((col, value));
                    }
                }
            }
            let alive = match (&upserted, &deleted) {
                (Some(u), Some(d)) => u > d,
                _ => true,
            };
            if alive {
                conn.execute(
                    &format!("INSERT INTO {table} ({pk_col}) VALUES (?1) ON CONFLICT ({pk_col}) DO NOTHING"),
                    [&change.pk],
                )?;
                if !visible.is_empty() {
                    let sets: Vec<String> = visible
                        .iter()
                        .enumerate()
                        .map(|(i, (c, _))| format!("{} = ?{}", quote(c), i + 2))
                        .collect();
                    let mut values: Vec<&dyn ToSql> = vec![&change.pk];
                    values.extend(visible.iter().map(|(_, v)| *v as &dyn ToSql));
                    conn.execute(
                        &format!("UPDATE {table} SET {} WHERE {pk_col} = ?1", sets.join(", ")),
                        values.as_slice(),
                    )?;
                }
            }
        }
        ChangeKind::Delete => {
            if deleted.as_deref().is_some_and(|d| d >= version) {
                return Ok(());
            }
            let deleted = Some(version.to_owned());
            save_row(&created, &upserted, &deleted)?;
            if upserted.as_deref().is_none_or(|u| u < version) {
                conn.execute(
                    &format!("DELETE FROM {table} WHERE {pk_col} = ?1"),
                    [&change.pk],
                )?;
            } else {
                let stale: Vec<String> = conn
                    .prepare(
                        "SELECT col FROM _versions WHERE tbl = ?1 AND pk = ?2 AND version < ?3",
                    )?
                    .query_map(params![def.name, change.pk, version], |r| r.get(0))?
                    .collect::<std::result::Result<_, _>>()?;
                let stale: Vec<&String> = stale
                    .iter()
                    .filter(|c| def.column_type(c).is_some())
                    .collect();
                if !stale.is_empty() {
                    let sets: Vec<String> = stale
                        .iter()
                        .map(|c| format!("{} = NULL", quote(c)))
                        .collect();
                    conn.execute(
                        &format!("UPDATE {table} SET {} WHERE {pk_col} = ?1", sets.join(", ")),
                        [&change.pk],
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn refresh_conflicts(conn: &Connection, def: &TableDef) -> Result<()> {
    let table = quote(&def.name);
    let pk = quote(&def.pk);
    for col in &def.unique {
        let c = quote(col);
        conn.execute(
            "DELETE FROM _conflicts WHERE tbl = ?1 AND col = ?2",
            params![def.name, col],
        )?;
        let rows: Vec<(String, String)> = conn
            .prepare(&format!(
                "SELECT CAST(t.{c} AS TEXT), t.{pk} FROM {table} t
                 JOIN _rows r ON r.tbl = ?1 AND r.pk = t.{pk}
                 WHERE t.{c} IN (SELECT {c} FROM {table} WHERE {c} IS NOT NULL GROUP BY {c} HAVING COUNT(*) > 1)
                 ORDER BY t.{c}, r.created, t.{pk}"
            ))?
            .query_map([&def.name], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        let mut winner: Option<(String, String)> = None;
        for (value, row) in rows {
            match &winner {
                Some((v, w)) if *v == value => {
                    conn.execute(
                        "INSERT INTO _conflicts (tbl, col, value, winner, loser) VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![def.name, col, value, w, row],
                    )?;
                }
                _ => winner = Some((value, row)),
            }
        }
    }
    Ok(())
}
