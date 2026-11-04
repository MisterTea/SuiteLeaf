//! A single node with its own database and blob store, and the helpers the tests share.

use std::sync::Arc;

use libp2p_identity::ed25519;
use suitedb::{Db, Schema, Value};
use suitedrive::{Drive, Principal, tables};

pub struct Node {
    pub db: Arc<Db>,
    pub drive: Arc<Drive>,
    _dir: tempfile::TempDir,
}

pub fn node() -> Node {
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open(
            &dir.path().join("db.sqlite"),
            ed25519::Keypair::generate(),
            Schema {
                version: 1,
                tables: tables(),
            },
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    Node {
        db,
        drive,
        _dir: dir,
    }
}

pub fn user(id: &str) -> Principal {
    Principal {
        id: id.into(),
        admin: false,
    }
}

pub fn edge(db: &Db, id: &str, group: &str, kind: &str, member: &str) {
    db.transact(|tx| {
        tx.upsert(
            "directory_edge",
            id,
            [
                ("groupId", Value::Text(group.into())),
                ("memberType", Value::Text(kind.into())),
                ("memberId", Value::Text(member.into())),
            ],
        )
    })
    .unwrap();
}
