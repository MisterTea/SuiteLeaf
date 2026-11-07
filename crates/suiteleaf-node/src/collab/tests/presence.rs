use crate::collab::*;

#[test]
fn same_user_tabs_have_independent_presence_and_activity() {
    use crate::schema::node_schema;
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rooms = Rooms::new(db.clone(), drive);
    let ann = AuthUser {
        id: "ann".into(),
        email: None,
        name: Some("Ann".into()),
        role: None,
    };
    let first = rooms
        .join_connection("file", &ann, Role::Editor, 1, "tab-1")
        .unwrap();
    let second = rooms
        .join_connection("file", &ann, Role::Editor, 1, "tab-2")
        .unwrap();
    assert_eq!(first.generation, second.generation);
    assert!(first.seed);
    assert!(!second.seed);
    // Rejoining a connection must not create another presence or seed again.
    rooms
        .join_connection("file", &ann, Role::Editor, 2, "tab-2")
        .unwrap();
    assert_eq!(rooms.occupants("file").unwrap().len(), 2);
    rooms.activity("file", "tab-2", 50).unwrap();
    let row = db
        .get("drive_presence", &presence_id("file", "tab-2"))
        .unwrap()
        .unwrap();
    assert_eq!(row.get("lastActiveMs").and_then(as_int), Some(50));
    rooms.leave_connection("file", "ann", 51, "tab-1").unwrap();
    assert_eq!(rooms.writers("file").unwrap().len(), 1);
    assert_eq!(rooms.occupants("file").unwrap()[0].user_id, "ann");
    rooms.leave_connection("file", "ann", 52, "tab-2").unwrap();
    assert!(rooms.writers("file").unwrap().is_empty());
}

#[test]
fn leaving_drops_a_person_before_the_idle_sweep() {
    use crate::{auth::AuthUser, schema::node_schema};

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rooms = Rooms::new(db, drive);
    let ann = AuthUser {
        id: "ann".into(),
        email: None,
        name: Some("Ann".into()),
        role: None,
    };
    let sam = AuthUser {
        id: "sam".into(),
        email: None,
        name: Some("Sam".into()),
        role: None,
    };
    rooms.join("file", &ann, Role::Editor, 1).unwrap();
    rooms.join("file", &sam, Role::Commenter, 1).unwrap();
    let names = rooms
        .occupants("file")
        .unwrap()
        .into_iter()
        .map(|person| person.name)
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["Ann".to_string(), "Sam".to_string()]);
    rooms.leave("file", "sam", 2).unwrap();
    let stayed = rooms.occupants("file").unwrap();
    assert_eq!(stayed.len(), 1);
    assert_eq!(stayed[0].name, "Ann");
    assert!(rooms.kick(2, 15 * 60 * 1000).unwrap().is_empty());
}

#[test]
fn a_name_with_a_line_break_is_listed_as_someone() {
    use crate::{auth::AuthUser, schema::node_schema};
    use suitedb::Value;

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rooms = Rooms::new(db, drive);
    let noor = AuthUser {
        id: "noor".into(),
        email: None,
        name: Some("Garden\nsecret-value".into()),
        role: None,
    };
    rooms.join("file", &noor, Role::Editor, 1).unwrap();
    let people = rooms.occupants("file").unwrap();
    assert_eq!(people.len(), 1);
    assert_eq!(people[0].name, "Someone");
    assert_eq!(people[0].user_id, "noor");
    let stored = rooms
        .db
        .get("drive_presence", &presence_id("file", "noor"))
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.get("name"),
        Some(&Value::Text("Garden\nsecret-value".into()))
    );
}

#[test]
fn an_idle_room_keeps_text_when_there_is_no_file_to_write() {
    use crate::{auth::AuthUser, schema::node_schema};
    use yrs::{Array, TextPrelim, Transact};

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rooms = Rooms::new(db, drive);
    let maya = AuthUser {
        id: "maya".into(),
        email: None,
        name: Some("Maya".into()),
        role: None,
    };
    let sam = AuthUser {
        id: "sam".into(),
        email: None,
        name: Some("Sam".into()),
        role: None,
    };
    rooms.join("missing", &maya, Role::Editor, 1).unwrap();
    rooms.join("missing", &sam, Role::Editor, 2).unwrap();
    let doc = Doc::new();
    let paragraphs = doc.get_or_insert_array("paragraphs");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        paragraphs.insert(&mut txn, 0, TextPrelim::new("Tomatoes are in"));
    }
    let update = doc.transact().encode_state_as_update_v1(&before);
    rooms
        .apply_update(LiveUpdate {
            item: "missing",
            user_id: "maya",
            name: "Maya",
            role: Role::Editor,
            bytes: &update,
            unit: "paragraph",
            key: "0",
            at: "2026-10-31T12:00:00.000Z",
        })
        .unwrap();
    rooms.leave("missing", "maya", 3).unwrap();
    rooms.leave("missing", "sam", 4).unwrap();
    let live = rooms.live.lock().expect("rooms");
    let room = live.get("missing").expect("room");
    assert_eq!(room.mode, "multiuser");
    assert_eq!(
        paragraph_texts(&room.doc),
        vec!["Tomatoes are in".to_string()]
    );
}

#[test]
fn a_solo_join_returns_instead_of_locking_the_room_twice() {
    use std::{sync::mpsc, time::Duration};

    use crate::{auth::AuthUser, schema::node_schema};
    use suitedrive::Role;

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rooms = Rooms::new(db, drive);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let ann = AuthUser {
            id: "ann".into(),
            email: None,
            name: Some("Ann".into()),
            role: None,
        };
        let viewer = AuthUser {
            id: "val".into(),
            email: None,
            name: Some("Val".into()),
            role: None,
        };
        let view_first = rooms.join("view-file", &viewer, Role::Viewer, 1).unwrap();
        assert!(view_first.joined);
        assert_eq!(view_first.mode, "solo");

        let first = rooms.join("file", &ann, Role::Editor, 1).unwrap();
        assert!(first.joined);
        assert_eq!(first.mode, "multiuser");
        let again = rooms.join("file", &ann, Role::Editor, 2).unwrap();
        assert_eq!(again.mode, "multiuser");
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        let shared = rooms.join("file", &sam, Role::Editor, 3).unwrap();
        assert_eq!(shared.mode, "multiuser");
        let _ = tx.send(());
    });
    rx.recv_timeout(Duration::from_secs(5))
        .expect("joining a room locked the room map twice");
}

#[test]
fn an_abandoned_room_is_compacted_when_a_peer_already_cleared_presence() {
    use crate::{auth::AuthUser, schema::node_schema};
    use suitedrive::Principal;
    use yrs::{Array, TextPrelim, Transact};

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let file = br#"{"format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes","createdAt":"2026-10-30T18:00:00.000Z","updatedAt":"2026-10-30T18:00:00.000Z","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"North bed"}]},{"type":"paragraph","content":[{"type":"text","text":"South bed"}]}]}}"#;
    let who = Principal {
        id: "maya".into(),
        admin: false,
    };
    let item = drive
        .create(&who, None, "Notes.sldoc", "file", Some("application/json"))
        .unwrap();
    drive
        .write(&who, &item.id, None, Some("application/json"), file)
        .unwrap();
    drive
        .share(&who, &item.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let rooms = Rooms::new(db, drive.clone());
    let maya = AuthUser {
        id: "maya".into(),
        email: None,
        name: Some("Maya".into()),
        role: None,
    };
    let sam = AuthUser {
        id: "sam".into(),
        email: None,
        name: Some("Sam".into()),
        role: None,
    };
    rooms.join(&item.id, &maya, Role::Editor, 1).unwrap();
    assert_eq!(
        rooms.join(&item.id, &sam, Role::Editor, 2).unwrap().mode,
        "multiuser"
    );
    let doc = Doc::new();
    let paragraphs = doc.get_or_insert_array("paragraphs");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        for text in ["Tomatoes are in", "Beans are staked"] {
            let index = paragraphs.len(&txn);
            paragraphs.insert(&mut txn, index, TextPrelim::new(text));
        }
    }
    let update = doc.transact().encode_state_as_update_v1(&before);
    assert!(
        rooms
            .apply_update(LiveUpdate {
                item: &item.id,
                user_id: "maya",
                name: "Maya",
                role: Role::Editor,
                bytes: &update,
                unit: "paragraph",
                key: "0",
                at: "2026-10-30T18:05:00.000Z",
            })
            .unwrap()
    );
    let live_texts = {
        let live = rooms.live.lock().expect("rooms");
        paragraph_texts(&live.get(&item.id).expect("room").doc)
    };
    assert_eq!(
        live_texts,
        vec![
            "Tomatoes are in".to_string(),
            "Beans are staked".to_string()
        ]
    );
    rooms
        .db
        .transact(|tx| {
            tx.delete("drive_presence", &presence_id(&item.id, "maya"))?;
            tx.delete("drive_presence", &presence_id(&item.id, "sam"))?;
            Ok(())
        })
        .unwrap();
    assert!(rooms.writers(&item.id).unwrap().is_empty());
    rooms.kick(10_000, 1).unwrap();
    let (_item, bytes) = drive.read(&who, &item.id, None).unwrap();
    let saved = String::from_utf8(bytes).unwrap();
    assert!(saved.contains("Tomatoes are in"), "{saved}");
    assert!(saved.contains("Beans are staked"), "{saved}");
}

#[test]
fn a_presence_time_that_is_not_a_time_does_not_drop_the_edit() {
    use crate::{auth::AuthUser, schema::node_schema};
    use yrs::{Array, TextPrelim, Transact};

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rooms = Rooms::new(db.clone(), drive);
    let ann = AuthUser {
        id: "ann".into(),
        email: None,
        name: Some("Ann".into()),
        role: None,
    };
    let sam = AuthUser {
        id: "sam".into(),
        email: None,
        name: Some("Sam".into()),
        role: None,
    };
    rooms.join("file", &ann, Role::Editor, 1).unwrap();
    rooms.join("file", &sam, Role::Editor, 1).unwrap();
    let doc = Doc::new();
    let paragraphs = doc.get_or_insert_array("paragraphs");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        paragraphs.insert(&mut txn, 0, TextPrelim::new("Beds"));
    }
    let update = doc.transact().encode_state_as_update_v1(&before);
    rooms
        .apply_update(LiveUpdate {
            item: "file",
            user_id: "ann",
            name: "Ann",
            role: Role::Editor,
            bytes: &update,
            unit: "paragraph",
            key: "0",
            at: "2026-11-01T12:00:00.000Z",
        })
        .unwrap();
    let id = "file:ann";
    let mut row = db.get("drive_presence", id).unwrap().unwrap();
    row.insert("lastActiveMs".into(), DbValue::Integer(0));
    db.transact(|tx| tx.upsert("drive_presence", id, row.into_iter().collect::<Vec<_>>()))
        .unwrap();
    let kicked = rooms.kick(1 + IDLE_MS + 1, IDLE_MS).unwrap();
    assert_eq!(kicked, vec!["sam".to_string()]);
    let names = rooms
        .occupants("file")
        .unwrap()
        .into_iter()
        .map(|person| person.name)
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["Ann".to_string()]);
    let live = rooms.live.lock().expect("rooms");
    let room = live.get("file").expect("room");
    assert_eq!(room.mode, "multiuser");
    assert_eq!(paragraph_texts(&room.doc), vec!["Beds".to_string()]);
}

#[test]
fn solo_editor_uses_crdt_and_compacts_on_leave() {
    use crate::{auth::AuthUser, schema::node_schema};
    use suitedrive::Principal;
    use yrs::{Array, TextPrelim, Transact};

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let file = br#"{"format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes","createdAt":"2026-10-30T18:00:00.000Z","updatedAt":"2026-10-30T18:00:00.000Z","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"North bed"}]}]}}"#;
    let who = Principal {
        id: "maya".into(),
        admin: false,
    };
    let item = drive
        .create(&who, None, "Notes.sldoc", "file", Some("application/json"))
        .unwrap();
    drive
        .write(&who, &item.id, None, Some("application/json"), file)
        .unwrap();
    let rooms = Rooms::new(db, drive.clone());
    let maya = AuthUser {
        id: "maya".into(),
        email: None,
        name: Some("Maya".into()),
        role: None,
    };

    let join = rooms.join(&item.id, &maya, Role::Editor, 1).unwrap();
    assert!(join.joined);
    assert_eq!(join.mode, "multiuser");
    assert!(join.seed);

    let doc = Doc::new();
    let paragraphs = doc.get_or_insert_array("paragraphs");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        paragraphs.insert(&mut txn, 0, TextPrelim::new("Radishes planted"));
    }
    let update = doc.transact().encode_state_as_update_v1(&before);
    assert!(
        rooms
            .apply_update(LiveUpdate {
                item: &item.id,
                user_id: "maya",
                name: "Maya",
                role: Role::Editor,
                bytes: &update,
                unit: "paragraph",
                key: "0",
                at: "2026-11-01T12:00:00.000Z",
            })
            .unwrap()
    );

    rooms.leave(&item.id, "maya", 2).unwrap();
    let (_item, bytes) = drive.read(&who, &item.id, None).unwrap();
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("Radishes planted"));
}
