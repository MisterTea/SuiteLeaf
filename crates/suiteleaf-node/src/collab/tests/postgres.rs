//! Cross-instance room locking against a real Postgres. Run with an isolated
//! database: SUITELEAF_TEST_POSTGRES_URL=... cargo test -p suiteleaf-node -- --ignored postgres
use crate::collab::*;
use crate::{auth::AuthUser, schema::node_schema};
use std::time::{Duration, Instant};
use yrs::{GetString, Text};

pub(crate) fn pg_db() -> Arc<Db> {
    let url = std::env::var("SUITELEAF_TEST_POSTGRES_URL")
        .expect("Use an isolated Postgres test database");
    let schema = node_schema(None).unwrap();
    Db::migrate_postgres(&url, &schema).unwrap();
    Arc::new(
        Db::open_postgres(
            &url,
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            schema,
        )
        .unwrap(),
    )
}

fn person(id: &str) -> AuthUser {
    AuthUser {
        id: id.into(),
        email: None,
        name: Some(id.into()),
        role: None,
    }
}

/// One "Fluid instance": its own database pools and in-memory rooms.
fn instance(blobs: &std::path::Path) -> Rooms {
    let db = pg_db();
    let drive = Drive::open(db.clone(), blobs).unwrap();
    Rooms::new(db, drive)
}

fn insert(doc: &Doc, at: u32, text: &str) -> Vec<u8> {
    let root = doc.get_or_insert_text("body");
    let before = doc.transact().state_vector();
    root.insert(&mut doc.transact_mut(), at, text);
    doc.transact().encode_state_as_update_v1(&before)
}

fn push(rooms: &Rooms, item: &str, user: &str, bytes: &[u8]) -> bool {
    rooms
        .apply_update(LiveUpdate {
            item,
            user_id: user,
            name: user,
            role: Role::Editor,
            bytes,
            unit: "paragraph",
            key: "body",
            at: "2026-11-26T16:00:00.000Z",
        })
        .unwrap()
}

fn body(rooms: &Rooms, item: &str) -> String {
    let live = rooms.live.lock().unwrap();
    let room = live.get(item).unwrap();
    let text = room.doc.get_or_insert_text("body");
    text.get_string(&room.doc.transact())
}

fn share(rooms: &[&Rooms], item: &str) {
    for (n, rooms) in rooms.iter().enumerate() {
        rooms
            .join(item, &person(&format!("p{n}")), Role::Editor, 1)
            .unwrap();
    }
    // A second editor turns the room multiuser.
    rooms[0]
        .join(item, &person("extra"), Role::Editor, 2)
        .unwrap();
}

#[test]
#[ignore = "requires an isolated Postgres database"]
fn postgres_edits_to_different_rooms_do_not_wait_on_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (
        format!("room-a-{}", uuid::Uuid::now_v7()),
        format!("room-b-{}", uuid::Uuid::now_v7()),
    );
    let here = instance(&dir.path().join("blobs"));
    share(&[&here], &a);
    share(&[&here], &b);

    // Another instance is in the middle of a long step on room A.
    let other = pg_db();
    let held = other.lock_all(&crate::cloud::item_locks(&a)).unwrap();
    assert!(held.is_some());

    // Room B edits proceed at once; under the old global lock they waited.
    let started = Instant::now();
    let doc = Doc::new();
    for n in 0..5 {
        assert!(push(&here, &b, "p0", &insert(&doc, 0, &format!("{n}"))));
    }
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    // Room A really is held: maintenance skips it instead of waiting.
    assert!(
        here.db
            .try_lock_all(&crate::cloud::item_locks(&a))
            .unwrap()
            .is_none()
    );
    drop(held);
    assert!(push(&here, &a, "p0", &insert(&Doc::new(), 0, "a")));
    assert_eq!(body(&here, &a), "a");
}

#[test]
#[ignore = "requires an isolated Postgres database"]
fn postgres_concurrent_edits_to_one_room_from_two_instances_converge() {
    let dir = tempfile::tempdir().unwrap();
    let item = format!("room-{}", uuid::Uuid::now_v7());
    let blobs = dir.path().join("blobs");
    let first = instance(&blobs);
    let second = instance(&blobs);
    share(&[&first, &second], &item);

    const EDITS: usize = 15;
    std::thread::scope(|s| {
        for (who, rooms) in [("p0", &first), ("p1", &second)] {
            let item = &item;
            s.spawn(move || {
                let doc = Doc::new();
                for n in 0..EDITS {
                    let len = doc
                        .get_or_insert_text("body")
                        .get_string(&doc.transact())
                        .len() as u32;
                    let chunk = format!("[{who}:{n}]");
                    assert!(push(rooms, item, who, &insert(&doc, len, &chunk)));
                }
            });
        }
    });
    first.catch_up(&item).unwrap();
    second.catch_up(&item).unwrap();
    let (one, two) = (body(&first, &item), body(&second, &item));
    assert_eq!(one, two, "both instances converge");
    for who in ["p0", "p1"] {
        for n in 0..EDITS {
            assert!(
                one.contains(&format!("[{who}:{n}]")),
                "lost [{who}:{n}] in {one}"
            );
        }
    }
    // A third instance that starts now rebuilds the same document.
    let third = instance(&blobs);
    third.join(&item, &person("late"), Role::Editor, 3).unwrap();
    assert_eq!(body(&third, &item), one);
}
