//! A single node with its own database and blob store, and the callers the tests use.

use std::{collections::BTreeMap, sync::Arc};

use libp2p_identity::ed25519;
use suitedb::{Db, Schema};
use suitedrive::{Drive, Principal, tables};
use tempfile::TempDir;

pub struct Node {
    pub db: Arc<Db>,
    pub drive: Arc<Drive>,
    _dir: TempDir,
}

pub fn node() -> Node {
    let dir = tempfile::tempdir().unwrap();
    let schema = Schema {
        version: 1,
        tables: tables(),
    };
    let db = Arc::new(
        Db::open(
            &dir.path().join("db.sqlite"),
            ed25519::Keypair::generate(),
            schema,
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

pub fn sync(from: &Node, to: &Node) {
    let ops = from.db.ops_since(None, 0, usize::MAX).unwrap().ops;
    to.db.ingest_many(ops.iter().map(Vec::as_slice)).unwrap();
}

pub fn answer_map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}
