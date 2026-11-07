//! Central Postgres storage. SQLite remains the self-hosted replication backend.
use crate::{
    Change, ChangeKind, ColumnType, Db, Error, Op, OpBody, OpId, Result, RowChange, Schema, Value,
    hlc::Clock, schema::quote,
};
use postgres::types::{ToSql, Type};
use postgres_native_tls::MakeTlsConnector;
use r2d2_postgres::PostgresConnectionManager;
use std::collections::{BTreeMap, BTreeSet};

type Manager = PostgresConnectionManager<MakeTlsConnector>;
type Connection = r2d2::PooledConnection<Manager>;
type SnapshotRow = (String, String, BTreeMap<String, Value>);
pub(super) struct PostgresStore {
    pool: BlockingPool,
    operation_locks: BlockingPool,
    item_locks: BlockingPool,
}

// The synchronous driver closes connections using its own Tokio runtime.
// Pool destruction can run while the application's runtime cancels its tasks.
struct BlockingPool(Option<r2d2::Pool<Manager>>);
impl std::ops::Deref for BlockingPool {
    type Target = r2d2::Pool<Manager>;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref().expect("live database pool")
    }
}
impl Drop for BlockingPool {
    fn drop(&mut self) {
        if let Some(pool) = self.0.take() {
            if tokio::runtime::Handle::try_current().is_ok() {
                let _ = std::thread::spawn(move || drop(pool)).join();
            } else {
                drop(pool);
            }
        }
    }
}

fn error(_: impl std::fmt::Display) -> Error {
    // Driver errors can include connection strings or document data.
    Error::Postgres(
        "Database operation failed; inspect database health and schema compatibility.".into(),
    )
}

pub(super) fn blocking<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(f)
        }
        Ok(_) => std::thread::scope(|scope| scope.spawn(f).join().expect("database worker")),
        Err(_) => f(),
    }
}

impl Db {
    /// A disposable change-feed cursor captured before accepting sockets. Joins
    /// rebuild authoritative room state; only later events need replaying.
    pub fn cloud_tip(&self) -> Result<i64> {
        let Some(store) = &self.postgres else {
            return Ok(0);
        };
        blocking(|| {
            Ok(store
                .connection()?
                .query_one("SELECT COALESCE(MAX(seq),0) FROM _cloud_ops", &[])
                .map_err(error)?
                .get(0))
        })
    }

    /// Database-clock lease: one fleet-wide maintenance sweep per period,
    /// including during bursts of cold starts. A crashed holder expires.
    pub fn claim_cloud_maintenance(&self, every: std::time::Duration) -> Result<bool> {
        let Some(store) = &self.postgres else {
            return Ok(true);
        };
        let millis = every.as_millis().clamp(50, 3_600_000) as i64;
        blocking(|| {
            Ok(store.connection()?.query_opt(
                "INSERT INTO _cloud_leases(name,expires_at) VALUES('rooms',clock_timestamp()+$1::bigint*INTERVAL '1 millisecond')
                 ON CONFLICT(name) DO UPDATE SET expires_at=EXCLUDED.expires_at
                 WHERE _cloud_leases.expires_at<=clock_timestamp() RETURNING name",
                &[&millis],
            ).map_err(error)?.is_some())
        })
    }

    /// Connect to an already migrated central database. No SQLite file is opened.
    pub fn open_postgres(
        url: &str,
        key: libp2p_identity::ed25519::Keypair,
        schema: Schema,
    ) -> Result<Self> {
        schema.validate()?;
        let store = blocking(|| {
            let store = PostgresStore::connect(url)?;
            store.check_schema(&schema)?;
            Ok::<_, Error>(store)
        })?;
        // The existing read-only SQLite closure API is retained for local tooling;
        // cloud requests use native Postgres queries and transactions exclusively.
        let mut db = Self::open_in_memory(key, schema)?;
        db.postgres = Some(store);
        Ok(db)
    }

    pub fn migrate_postgres(url: &str, schema: &Schema) -> Result<()> {
        schema.validate()?;
        blocking(|| PostgresStore::connect(url)?.migrate(schema))
    }

    pub fn is_postgres(&self) -> bool {
        self.postgres.is_some()
    }

    /// Serializes a compound operation across instances, including reads before writes.
    /// This uses a transaction-level lock and works with Neon's transaction pooler.
    pub fn exclusive(&self, scope: &str) -> Result<Option<CloudLock>> {
        let Some(store) = &self.postgres else {
            return Ok(None);
        };
        blocking(|| {
            // Lock waiters must never exhaust the pool used by the lock
            // holder's queries. Compound operations can also acquire item locks.
            let pool = if scope == "cloud-mutations" {
                &store.operation_locks
            } else {
                &store.item_locks
            };
            let mut connection = pool.get().map_err(error)?;
            connection.batch_execute("BEGIN").map_err(error)?;
            let bytes = blake3::hash(scope.as_bytes());
            let key = i64::from_le_bytes(bytes.as_bytes()[..8].try_into().unwrap());
            connection
                .execute("SELECT pg_advisory_xact_lock($1)", &[&key])
                .map_err(error)?;
            Ok(Some(CloudLock {
                connection: Some(connection),
            }))
        })
    }
}

pub struct CloudLock {
    connection: Option<Connection>,
}
impl Drop for CloudLock {
    fn drop(&mut self) {
        if let Some(mut connection) = self.connection.take() {
            blocking(move || {
                let _ = connection.batch_execute("ROLLBACK");
                drop(connection);
            });
        }
    }
}

impl PostgresStore {
    pub(super) fn changes_since(&self, cursor: i64) -> Result<Vec<BTreeMap<String, Value>>> {
        blocking(|| {
            // A single SELECT needs no explicit BEGIN/PREPARE/COMMIT cycle.
            let rows = self
                .connection()?
                .query(
                    "SELECT seq,payload FROM _cloud_ops WHERE seq>$1 ORDER BY seq LIMIT 1000",
                    &[&cursor],
                )
                .map_err(error)?;
            decode_rows(&rows)
        })
    }
    pub(super) fn snapshot(&self, schema: &Schema) -> Result<Vec<SnapshotRow>> {
        blocking(|| {
            let mut connection = self.connection()?;
            let mut tx = connection
                .build_transaction()
                .read_only(true)
                .isolation_level(postgres::IsolationLevel::RepeatableRead)
                .start()
                .map_err(error)?;
            let mut result = Vec::new();
            for table in &schema.tables {
                let rows = tx
                    .query(&format!("SELECT * FROM {}", quote(&table.name)), &[])
                    .map_err(error)?;
                for row in decode_rows(&rows)? {
                    if let Some(Value::Text(pk)) = row.get(&table.pk) {
                        result.push((table.name.clone(), pk.clone(), row));
                    }
                }
            }
            tx.commit().map_err(error)?;
            Ok(result)
        })
    }
    pub(super) fn op_count(&self) -> Result<u64> {
        blocking(|| {
            Ok(self
                .connection()?
                .query_one("SELECT COUNT(*) FROM _cloud_ops", &[])
                .map_err(error)?
                .get::<_, i64>(0) as u64)
        })
    }
    fn connect(url: &str) -> Result<Self> {
        Ok(Self {
            pool: Self::pool(url, 8)?,
            operation_locks: Self::pool(url, 2)?,
            item_locks: Self::pool(url, 2)?,
        })
    }
    fn pool(url: &str, size: u32) -> Result<BlockingPool> {
        let tls = native_tls::TlsConnector::builder().build().map_err(error)?;
        let manager =
            PostgresConnectionManager::new(url.parse().map_err(error)?, MakeTlsConnector::new(tls));
        let pool = r2d2::Pool::builder()
            .max_size(size)
            .min_idle(Some(0))
            .connection_timeout(std::time::Duration::from_secs(15))
            .build(manager)
            .map_err(error)?;
        Ok(BlockingPool(Some(pool)))
    }
    fn connection(&self) -> Result<Connection> {
        self.pool.get().map_err(error)
    }

    fn check_schema(&self, schema: &Schema) -> Result<()> {
        let row = self
            .connection()?
            .query_opt(
                "SELECT version FROM _cloud_schema WHERE singleton = TRUE",
                &[],
            )
            .map_err(error)?;
        if row.is_none_or(|r| r.get::<_, i64>(0) != i64::from(schema.version)) {
            return Err(Error::Schema(
                "Run the cloud migration command for this release before starting the server."
                    .into(),
            ));
        }
        Ok(())
    }

    fn migrate(&self, schema: &Schema) -> Result<()> {
        let mut connection = self.connection()?;
        let mut tx = connection.transaction().map_err(error)?;
        tx.execute("SELECT pg_advisory_xact_lock(71386913001)", &[])
            .map_err(error)?;
        tx.batch_execute("CREATE TABLE IF NOT EXISTS _cloud_schema (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), version BIGINT NOT NULL);
            CREATE TABLE IF NOT EXISTS _conflicts (tbl TEXT NOT NULL, col TEXT NOT NULL, value TEXT NOT NULL, winner TEXT NOT NULL, loser TEXT NOT NULL, PRIMARY KEY(tbl,col,loser));
            CREATE TABLE IF NOT EXISTS _cloud_ops (seq BIGSERIAL PRIMARY KEY, id BYTEA UNIQUE NOT NULL, payload BYTEA NOT NULL);
            CREATE TABLE IF NOT EXISTS _cloud_objects (hash TEXT PRIMARY KEY, bytes BIGINT NOT NULL);
            CREATE TABLE IF NOT EXISTS _cloud_leases (name TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL);").map_err(error)?;
        if let Some(row) = tx
            .query_opt(
                "SELECT version FROM _cloud_schema WHERE singleton = TRUE",
                &[],
            )
            .map_err(error)?
            && row.get::<_, i64>(0) > i64::from(schema.version)
        {
            return Err(Error::Schema("Database is newer than this release.".into()));
        }
        for table in &schema.tables {
            tx.batch_execute(&format!(
                "CREATE TABLE IF NOT EXISTS {} ({} TEXT PRIMARY KEY)",
                quote(&table.name),
                quote(&table.pk)
            ))
            .map_err(error)?;
            for column in &table.columns {
                let ty = match column.ty {
                    ColumnType::Text => "TEXT",
                    ColumnType::Integer => "BIGINT",
                    ColumnType::Real => "DOUBLE PRECISION",
                    ColumnType::Blob => "BYTEA",
                    ColumnType::Any => {
                        return Err(Error::Schema(
                            "Untyped columns are not supported in cloud mode.".into(),
                        ));
                    }
                };
                tx.batch_execute(&format!(
                    "ALTER TABLE {} ADD COLUMN IF NOT EXISTS {} {ty}",
                    quote(&table.name),
                    quote(&column.name)
                ))
                .map_err(error)?;
            }
            for column in table.unique.iter().chain(&table.indexes) {
                tx.batch_execute(&format!(
                    "CREATE INDEX IF NOT EXISTS {} ON {} ({})",
                    quote(&format!("ix_{}_{}", table.name, column)),
                    quote(&table.name),
                    quote(column)
                ))
                .map_err(error)?;
            }
        }
        tx.execute("INSERT INTO _cloud_schema(singleton,version) VALUES(TRUE,$1) ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version", &[&i64::from(schema.version)]).map_err(error)?;
        tx.commit().map_err(error)
    }

    pub(super) fn query(
        &self,
        schema: &Schema,
        sql: &str,
        values: &[Value],
    ) -> Result<Vec<BTreeMap<String, Value>>> {
        blocking(|| self.query_native(schema, sql, values))
    }
    fn query_native(
        &self,
        schema: &Schema,
        sql: &str,
        values: &[Value],
    ) -> Result<Vec<BTreeMap<String, Value>>> {
        let sql = translate(schema, sql)?;
        let mut connection = self.connection()?;
        let mut tx = connection
            .build_transaction()
            .read_only(true)
            .start()
            .map_err(error)?;
        let statement = tx.prepare(&sql).map_err(error)?;
        let parameters = parameters(values, statement.params())?;
        let refs: Vec<&(dyn ToSql + Sync)> = parameters
            .iter()
            .map(|v| v.as_ref() as &(dyn ToSql + Sync))
            .collect();
        let rows = tx.query(&statement, &refs).map_err(error)?;
        let result = decode_rows(&rows);
        tx.commit().map_err(error)?;
        result
    }

    pub(super) fn transact(
        &self,
        schema: &Schema,
        key: &libp2p_identity::ed25519::Keypair,
        changes: Vec<Change>,
    ) -> Result<(OpId, Vec<u8>, Vec<RowChange>)> {
        blocking(|| self.transact_native(schema, key, changes))
    }
    fn transact_native(
        &self,
        schema: &Schema,
        key: &libp2p_identity::ed25519::Keypair,
        changes: Vec<Change>,
    ) -> Result<(OpId, Vec<u8>, Vec<RowChange>)> {
        let mut connection = self.connection()?;
        let mut tx = connection.transaction().map_err(error)?;
        tx.execute("SELECT pg_advisory_xact_lock(71386913002)", &[])
            .map_err(error)?;
        let op = Op::sign(
            OpBody {
                parents: vec![],
                hlc: Clock::new(crate::op::node_tag(&key.public())).tick(),
                schema: schema.version,
                author: key.public().to_bytes(),
                changes,
            },
            key,
        );
        let mut rows = Vec::new();
        for change in &op.body.changes {
            let def = schema
                .table(&change.table)
                .ok_or_else(|| Error::Schema("Unknown table".into()))?;
            match &change.kind {
                ChangeKind::Delete => {
                    tx.execute(
                        &format!(
                            "DELETE FROM {} WHERE {}=$1",
                            quote(&def.name),
                            quote(&def.pk)
                        ),
                        &[&change.pk],
                    )
                    .map_err(error)?;
                }
                ChangeKind::Upsert(columns) => {
                    let mut columns = columns.clone();
                    columns.insert(def.pk.clone(), Value::Text(change.pk.clone()));
                    let names: Vec<_> = columns.keys().map(|n| quote(n)).collect();
                    let slots: Vec<_> = (1..=names.len()).map(|n| format!("${n}")).collect();
                    let sets: Vec<_> = columns
                        .keys()
                        .filter(|n| *n != &def.pk)
                        .map(|n| format!("{}=EXCLUDED.{}", quote(n), quote(n)))
                        .collect();
                    let action = if sets.is_empty() {
                        "DO NOTHING".into()
                    } else {
                        format!("DO UPDATE SET {}", sets.join(","))
                    };
                    let sql = format!(
                        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({}) {action}",
                        quote(&def.name),
                        names.join(","),
                        slots.join(","),
                        quote(&def.pk)
                    );
                    let statement = tx.prepare(&sql).map_err(error)?;
                    let values: Vec<_> = columns.values().cloned().collect();
                    let parameters = parameters(&values, statement.params())?;
                    let refs: Vec<&(dyn ToSql + Sync)> = parameters
                        .iter()
                        .map(|v| v.as_ref() as &(dyn ToSql + Sync))
                        .collect();
                    tx.execute(&statement, &refs).map_err(error)?;
                }
            }
            rows.push(RowChange {
                table: change.table.clone(),
                pk: change.pk.clone(),
            });
        }
        let (id, bytes) = (op.id(), op.encode());
        // The change feed names changed rows; it must not retain passwords,
        // document chunks, or expired collaboration payloads a second time.
        let event = serde_json::to_vec(&rows).map_err(error)?;
        tx.execute(
            "INSERT INTO _cloud_ops(id,payload) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
            &[&&id.0[..], &event],
        )
        .map_err(error)?;
        tx.commit().map_err(error)?;
        Ok((id, bytes, rows))
    }
}

fn decode_rows(rows: &[postgres::Row]) -> Result<Vec<BTreeMap<String, Value>>> {
    rows.iter()
        .map(|row| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(i, column)| {
                    let value = match *column.type_() {
                        Type::INT8 => row
                            .try_get::<_, Option<i64>>(i)
                            .map(|v| v.map(Value::Integer)),
                        Type::INT4 => row
                            .try_get::<_, Option<i32>>(i)
                            .map(|v| v.map(|n| Value::Integer(n.into()))),
                        Type::FLOAT8 => {
                            row.try_get::<_, Option<f64>>(i).map(|v| v.map(Value::Real))
                        }
                        Type::BYTEA => row
                            .try_get::<_, Option<Vec<u8>>>(i)
                            .map(|v| v.map(Value::Blob)),
                        Type::BOOL => row
                            .try_get::<_, Option<bool>>(i)
                            .map(|v| v.map(|b| Value::Integer(i64::from(b)))),
                        _ => row
                            .try_get::<_, Option<String>>(i)
                            .map(|v| v.map(Value::Text)),
                    }
                    .map_err(error)?
                    .unwrap_or(Value::Null);
                    Ok((column.name().to_owned(), value))
                })
                .collect()
        })
        .collect()
}

fn parameters(values: &[Value], types: &[Type]) -> Result<Vec<Box<dyn ToSql + Sync + Send>>> {
    if values.len() != types.len() {
        return Err(Error::Invalid("Incorrect query parameter count".into()));
    }
    values
        .iter()
        .zip(types)
        .map(|(v, t)| -> Result<Box<dyn ToSql + Sync + Send>> {
            Ok(match (v, t) {
                (Value::Null, &Type::INT8) => Box::new(None::<i64>),
                (Value::Null, &Type::INT4) => Box::new(None::<i32>),
                (Value::Null, &Type::FLOAT8) => Box::new(None::<f64>),
                (Value::Null, &Type::BYTEA) => Box::new(None::<Vec<u8>>),
                (Value::Null, _) => Box::new(None::<String>),
                (Value::Integer(n), &Type::INT4) => Box::new(i32::try_from(*n).map_err(error)?),
                (Value::Integer(n), &Type::FLOAT8) => Box::new(*n as f64),
                (Value::Integer(n), _) => Box::new(*n),
                (Value::Real(n), _) => Box::new(*n),
                (Value::Text(s), _) => Box::new(s.clone()),
                (Value::Blob(b), _) => Box::new(b.clone()),
            })
        })
        .collect()
}

/// Translate our numbered SQLite placeholders and known identifiers, never string literals.
fn translate(schema: &Schema, sql: &str) -> Result<String> {
    let names: BTreeSet<&str> = schema
        .tables
        .iter()
        .flat_map(|t| {
            std::iter::once(t.name.as_str())
                .chain(std::iter::once(t.pk.as_str()))
                .chain(t.columns.iter().map(|c| c.name.as_str()))
        })
        .collect();
    let mut out = String::new();
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' || c == '"' {
            let delimiter = c;
            out.push(c);
            i += 1;
            while i < chars.len() {
                let c = chars[i];
                out.push(c);
                i += 1;
                if c == delimiter {
                    if i < chars.len() && chars[i] == delimiter {
                        out.push(delimiter);
                        i += 1;
                    } else {
                        break;
                    }
                }
            }
        } else if c == '?' {
            out.push('$');
            i += 1;
            if i == chars.len() || !chars[i].is_ascii_digit() {
                return Err(Error::Invalid("Queries require numbered parameters".into()));
            }
        } else if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let token: String = chars[start..i].iter().collect();
            if token.eq_ignore_ascii_case("COLLATE") {
                while i < chars.len() && chars[i].is_whitespace() {
                    i += 1;
                }
                let start = i;
                while i < chars.len() && chars[i].is_ascii_alphabetic() {
                    i += 1;
                }
                if chars[start..i].iter().collect::<String>() != "NOCASE" {
                    return Err(Error::Invalid("Unsupported collation".into()));
                }
                let end = out.trim_end().len();
                let start = out[..end]
                    .rfind(|c: char| c.is_whitespace() || c == ',')
                    .map_or(0, |p| p + 1);
                let expression = out[start..end].to_owned();
                out.truncate(start);
                out.push_str(&format!("LOWER({expression})"));
            } else if token.eq_ignore_ascii_case("IFNULL") {
                out.push_str("COALESCE");
            } else if names.contains(token.as_str()) {
                out.push_str(&quote(&token));
            } else if token.eq_ignore_ascii_case("LIKE") {
                out.push_str("ILIKE");
            } else {
                out.push_str(&token);
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn query_translation_preserves_literals_and_quoted_identifiers() {
        let schema = Schema {
            version: 1,
            tables: vec![crate::TableDef::new("files", "id").column("userId", ColumnType::Text)],
        };
        assert_eq!(
            translate(
                &schema,
                "SELECT userId FROM files WHERE id=?1 AND userId LIKE 'userId?2' AND \"id\"=?2"
            )
            .unwrap(),
            "SELECT \"userId\" FROM \"files\" WHERE \"id\"=$1 AND \"userId\" ILIKE 'userId?2' AND \"id\"=$2"
        );
        assert!(translate(&schema, "SELECT ?").is_err());
    }
}
