use std::collections::{BTreeMap, HashSet};

use libp2p_identity::{PublicKey, ed25519};
use proptest::prelude::*;
use suitedb::{ColumnType, Db, Schema, TableDef, Value};

fn schema() -> Schema {
    Schema {
        version: 1,
        tables: vec![
            TableDef::new("t", "id")
                .column("a", ColumnType::Text)
                .column("b", ColumnType::Integer)
                .column("email", ColumnType::Text)
                .unique("email"),
        ],
    }
}

fn replica() -> Db {
    Db::open_in_memory(ed25519::Keypair::generate(), schema()).unwrap()
}

fn dump(db: &Db) -> Vec<BTreeMap<String, Value>> {
    db.query("SELECT * FROM t ORDER BY id", &[]).unwrap()
}

/// Every encoded op in `db`, in its local order.
fn log(db: &Db) -> Vec<Vec<u8>> {
    db.ops_since(None, 0, usize::MAX).unwrap().ops
}

fn text(s: &str) -> Value {
    Value::Text(s.into())
}

#[test]
fn local_writes_are_visible_and_replicate() {
    let (a, b) = (replica(), replica());
    a.transact(|tx| tx.upsert("t", "r1", [("a", text("x")), ("b", Value::Integer(1))]))
        .unwrap();
    a.transact(|tx| tx.upsert("t", "r1", [("b", Value::Integer(2))]))
        .unwrap();
    let report = b.ingest_many(log(&a).iter().map(Vec::as_slice)).unwrap();
    assert_eq!(report.applied, 2);
    assert_eq!(dump(&a), dump(&b));
    assert_eq!(b.get("t", "r1").unwrap().unwrap()["b"], Value::Integer(2));
    assert_eq!(a.heads().unwrap(), b.heads().unwrap());
    let again = b.ingest_many(log(&a).iter().map(Vec::as_slice)).unwrap();
    assert_eq!(again.duplicate, 2);
}

#[test]
fn later_writes_win_per_column_and_concurrent_edits_merge() {
    let (a, b) = (replica(), replica());
    a.transact(|tx| tx.upsert("t", "r", [("a", text("base")), ("b", Value::Integer(0))]))
        .unwrap();
    b.ingest_many(log(&a).iter().map(Vec::as_slice)).unwrap();
    a.transact(|tx| tx.upsert("t", "r", [("a", text("from a"))]))
        .unwrap();
    b.transact(|tx| tx.upsert("t", "r", [("b", Value::Integer(9))]))
        .unwrap();
    a.ingest_many(log(&b).iter().map(Vec::as_slice)).unwrap();
    b.ingest_many(log(&a).iter().map(Vec::as_slice)).unwrap();
    let row = a.get("t", "r").unwrap().unwrap();
    assert_eq!(row["a"], text("from a"));
    assert_eq!(row["b"], Value::Integer(9));
    assert_eq!(dump(&a), dump(&b));
}

#[test]
fn a_delete_hides_earlier_columns_even_after_resurrection() {
    let a = replica();
    a.transact(|tx| tx.upsert("t", "r", [("a", text("old")), ("b", Value::Integer(1))]))
        .unwrap();
    a.transact(|tx| tx.delete("t", "r")).unwrap();
    assert!(a.get("t", "r").unwrap().is_none());
    a.transact(|tx| tx.upsert("t", "r", [("a", text("new"))]))
        .unwrap();
    let row = a.get("t", "r").unwrap().unwrap();
    assert_eq!(row["a"], text("new"));
    assert_eq!(row["b"], Value::Null);
    let ops = log(&a);
    let b = replica();
    for op in ops.iter().rev() {
        b.ingest(op).unwrap();
    }
    assert_eq!(dump(&a), dump(&b));
    assert_eq!(b.pending_count().unwrap(), 0);
}

#[test]
fn ops_with_missing_parents_wait_until_the_parents_arrive() {
    let a = replica();
    for i in 0..5 {
        a.transact(|tx| tx.upsert("t", "r", [("b", Value::Integer(i))]))
            .unwrap();
    }
    let ops = log(&a);
    let b = replica();
    let report = b.ingest(&ops[4]).unwrap();
    assert_eq!((report.applied, report.pending), (0, 1));
    assert!(b.get("t", "r").unwrap().is_none());
    b.ingest_many(ops[..4].iter().map(Vec::as_slice)).unwrap();
    assert_eq!(b.pending_count().unwrap(), 0);
    assert_eq!(b.get("t", "r").unwrap().unwrap()["b"], Value::Integer(4));
}

#[test]
fn duplicate_unique_values_resolve_to_the_first_created_row_everywhere() {
    let (a, b) = (replica(), replica());
    a.transact(|tx| tx.upsert("t", "first", [("email", text("x@example.com"))]))
        .unwrap();
    b.transact(|tx| tx.upsert("t", "second", [("email", text("x@example.com"))]))
        .unwrap();
    a.ingest_many(log(&b).iter().map(Vec::as_slice)).unwrap();
    b.ingest_many(log(&a).iter().map(Vec::as_slice)).unwrap();
    let (ca, cb) = (a.conflicts().unwrap(), b.conflicts().unwrap());
    assert_eq!(ca, cb);
    assert_eq!(ca.len(), 1);
    assert_eq!(ca[0].value, "x@example.com");
    assert_eq!(ca[0].winner, "first");
    assert_eq!(ca[0].loser, "second");
    a.transact(|tx| tx.upsert("t", "second", [("email", text("y@example.com"))]))
        .unwrap();
    assert!(a.conflicts().unwrap().is_empty());
}

#[test]
fn schema_violations_are_rejected_before_signing() {
    let a = replica();
    assert!(
        a.transact(|tx| tx.upsert("missing", "r", [("a", text("x"))]))
            .is_err()
    );
    assert!(
        a.transact(|tx| tx.upsert("t", "r", [("nope", text("x"))]))
            .is_err()
    );
    assert!(
        a.transact(|tx| tx.upsert("t", "r", [("b", text("not a number"))]))
            .is_err()
    );
    assert!(
        a.transact(|tx| tx.upsert("t", "r", [("id", text("other"))]))
            .is_err()
    );
    assert_eq!(a.op_count().unwrap(), 0);
}

#[test]
fn ops_from_authors_outside_the_allowlist_are_rejected() {
    let (a, b) = (replica(), replica());
    a.transact(|tx| tx.upsert("t", "r", [("a", text("x"))]))
        .unwrap();
    let stranger = PublicKey::from(ed25519::Keypair::generate().public()).to_peer_id();
    b.set_allowlist(Some(HashSet::from([stranger])));
    let report = b.ingest_many(log(&a).iter().map(Vec::as_slice)).unwrap();
    assert_eq!(report.rejected, 1);
    b.set_allowlist(Some(HashSet::from([a.peer_id()])));
    assert_eq!(
        b.ingest_many(log(&a).iter().map(Vec::as_slice))
            .unwrap()
            .applied,
        1
    );
}

#[test]
fn sync_pages_resume_from_the_saved_cursor() {
    let (a, b) = (replica(), replica());
    for i in 0..20 {
        a.transact(|tx| tx.upsert("t", &format!("r{i}"), [("b", Value::Integer(i))]))
            .unwrap();
    }
    let rt = tokio_rt();
    let pull = |db: &Db| {
        rt.block_on(db.pull_from("a", |req| {
            let reply = a.handle_sync(&req);
            async move { Ok(reply) }
        }))
        .unwrap()
    };
    assert_eq!(pull(&b).applied, 20);
    a.transact(|tx| tx.delete("t", "r0")).unwrap();
    let report = pull(&b);
    assert_eq!((report.applied, report.duplicate), (1, 0));
    assert_eq!(dump(&a), dump(&b));
    let small = a.ops_since(None, 0, 1).unwrap();
    assert_eq!(small.ops.len(), 1);
    assert!(small.more);
}

#[test]
fn reopening_a_database_keeps_data_and_clock() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db.sqlite");
    let key = ed25519::Keypair::generate();
    let db = Db::open(&path, key.clone(), schema()).unwrap();
    db.transact(|tx| tx.upsert("t", "r", [("b", Value::Integer(1))]))
        .unwrap();
    let epoch = db.epoch().to_owned();
    drop(db);
    let db = Db::open(&path, key, schema()).unwrap();
    assert_eq!(db.epoch(), epoch);
    db.transact(|tx| tx.upsert("t", "r", [("b", Value::Integer(2))]))
        .unwrap();
    assert_eq!(db.get("t", "r").unwrap().unwrap()["b"], Value::Integer(2));
    let newer = Schema {
        version: 0,
        ..schema()
    };
    assert!(Db::open(&path, ed25519::Keypair::generate(), newer).is_err());
}

fn tokio_rt() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
}

#[derive(Debug, Clone)]
enum Action {
    Upsert {
        replica: usize,
        row: u8,
        a: Option<u8>,
        b: Option<i64>,
        email: Option<u8>,
    },
    Delete {
        replica: usize,
        row: u8,
    },
    Sync {
        from: usize,
        to: usize,
    },
}

fn action() -> impl Strategy<Value = Action> {
    prop_oneof![
        4 => (0..3usize, 0..4u8, proptest::option::of(0..3u8), proptest::option::of(0..100i64), proptest::option::of(0..2u8))
            .prop_map(|(replica, row, a, b, email)| Action::Upsert { replica, row, a, b, email }),
        1 => (0..3usize, 0..4u8).prop_map(|(replica, row)| Action::Delete { replica, row }),
        1 => (0..3usize, 0..3usize).prop_map(|(from, to)| Action::Sync { from, to }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    /// Replicas that receive the same ops, in any order and with duplicates,
    /// end with identical tables and conflict records.
    #[test]
    fn replicas_converge(actions in proptest::collection::vec(action(), 1..40), seed in any::<u64>()) {
        let replicas = [replica(), replica(), replica()];
        for action in &actions {
            match action {
                Action::Upsert { replica, row, a, b, email } => {
                    let mut cols: Vec<(&str, Value)> = vec![];
                    if let Some(a) = a { cols.push(("a", Value::Text(format!("a{a}")))); }
                    if let Some(b) = b { cols.push(("b", Value::Integer(*b))); }
                    if let Some(e) = email { cols.push(("email", Value::Text(format!("e{e}")))); }
                    replicas[*replica].transact(|tx| tx.upsert("t", &format!("r{row}"), cols)).unwrap();
                }
                Action::Delete { replica, row } => {
                    replicas[*replica].transact(|tx| tx.delete("t", &format!("r{row}"))).unwrap();
                }
                Action::Sync { from, to } => {
                    let ops = log(&replicas[*from]);
                    replicas[*to].ingest_many(ops.iter().map(Vec::as_slice)).unwrap();
                }
            }
        }
        let mut all: Vec<Vec<u8>> = replicas.iter().flat_map(log).collect();
        let duplicates: Vec<Vec<u8>> = all.iter().step_by(3).cloned().collect();
        all.extend(duplicates);
        for (i, db) in replicas.iter().enumerate() {
            let mut ops = all.clone();
            shuffle(&mut ops, seed.wrapping_add(i as u64));
            for op in &ops {
                db.ingest(op).unwrap();
            }
            prop_assert_eq!(db.pending_count().unwrap(), 0);
        }
        prop_assert_eq!(dump(&replicas[0]), dump(&replicas[1]));
        prop_assert_eq!(dump(&replicas[1]), dump(&replicas[2]));
        prop_assert_eq!(replicas[0].conflicts().unwrap(), replicas[1].conflicts().unwrap());
        prop_assert_eq!(replicas[1].conflicts().unwrap(), replicas[2].conflicts().unwrap());
        prop_assert_eq!(replicas[0].heads().unwrap(), replicas[2].heads().unwrap());
    }
}

fn shuffle<T>(items: &mut [T], seed: u64) {
    let mut seed = seed | 1;
    for i in (1..items.len()).rev() {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        items.swap(i, (seed % (i as u64 + 1)) as usize);
    }
}
