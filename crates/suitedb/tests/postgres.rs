//! Run against an isolated database: SUITELEAF_TEST_POSTGRES_URL=... cargo test -p suitedb --test postgres -- --ignored
use suitedb::{ColumnType, Db, Schema, TableDef, Value};
fn schema() -> Schema {
    Schema {
        version: 1,
        tables: vec![
            TableDef::new("records", "id")
                .column("userId", ColumnType::Text)
                .column("body", ColumnType::Blob)
                .column("amount", ColumnType::Integer),
        ],
    }
}
fn url() -> String {
    std::env::var("SUITELEAF_TEST_POSTGRES_URL").expect("Use an isolated Postgres test database")
}
fn open() -> Db {
    Db::open_postgres(
        &url(),
        libp2p_identity::ed25519::Keypair::generate(),
        schema(),
    )
    .unwrap()
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires an isolated Postgres database"]
async fn postgres_connections_can_be_destroyed_inside_async_tasks() {
    Db::migrate_postgres(&url(), &schema()).unwrap();
    let db = open();
    assert!(db.query("SELECT id FROM records LIMIT 1", &[]).is_ok());
    drop(db);
    // Cancellation of a task can be the final owner during runtime shutdown.
    let task = tokio::spawn(async {
        let db = open();
        assert!(db.query("SELECT id FROM records LIMIT 1", &[]).is_ok());
        let _keep = db;
        std::future::pending::<()>().await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
}

#[test]
#[ignore = "requires an isolated Postgres database"]
fn postgres_is_durable_parameterized_and_read_only() {
    Db::migrate_postgres(&url(), &schema()).unwrap();
    let db = open();
    let id = uuid::Uuid::new_v4().to_string();
    db.transact(|tx| {
        tx.upsert(
            "records",
            &id,
            [
                ("userId", Value::Text("O'Brien ?1".into())),
                ("body", Value::Blob(vec![0, 1, 255])),
                ("amount", Value::Integer(9_000_000_000)),
            ],
        )
    })
    .unwrap();
    let other = open();
    let row = other.get("records", &id).unwrap().unwrap();
    assert_eq!(row["userId"], Value::Text("O'Brien ?1".into()));
    assert_eq!(row["body"], Value::Blob(vec![0, 1, 255]));
    assert_eq!(row["amount"], Value::Integer(9_000_000_000));
    assert!(db.query("DELETE FROM records", &[]).is_err());
    assert!(
        db.transact(|tx| {
            tx.delete("records", &id)?;
            tx.upsert("absent", "bad", [("x", Value::Null)])
        })
        .is_err()
    );
    assert!(other.get("records", &id).unwrap().is_some());
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot.sqlite");
    db.checkpoint_copy(&path).unwrap();
    let snapshot = Db::open(
        &path,
        libp2p_identity::ed25519::Keypair::generate(),
        schema(),
    )
    .unwrap();
    assert_eq!(
        snapshot.get("records", &id).unwrap(),
        other.get("records", &id).unwrap()
    );
    drop(snapshot);
    db.transact(|tx| tx.delete("records", &id)).unwrap();
    assert!(other.get("records", &id).unwrap().is_none());
    db.checkpoint_copy(&path).unwrap();
    let snapshot = Db::open(
        &path,
        libp2p_identity::ed25519::Keypair::generate(),
        schema(),
    )
    .unwrap();
    assert!(
        snapshot.get("records", &id).unwrap().is_none(),
        "An overwritten backup must not retain deleted rows"
    );
}

#[test]
#[ignore = "requires an isolated Postgres database"]
fn compound_operations_are_serialized_across_instances() {
    Db::migrate_postgres(&url(), &schema()).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    open()
        .transact(|tx| tx.upsert("records", &id, [("amount", Value::Integer(0))]))
        .unwrap();
    std::thread::scope(|s| {
        for _ in 0..4 {
            let id = &id;
            s.spawn(move || {
                let db = open();
                for _ in 0..5 {
                    let _lock = db.exclusive(id).unwrap();
                    let row = db.get("records", id).unwrap().unwrap();
                    let Value::Integer(n) = row["amount"] else {
                        panic!()
                    };
                    db.transact(|tx| tx.upsert("records", id, [("amount", Value::Integer(n + 1))]))
                        .unwrap();
                }
            });
        }
    });
    assert_eq!(
        open().get("records", &id).unwrap().unwrap()["amount"],
        Value::Integer(20)
    );
}
