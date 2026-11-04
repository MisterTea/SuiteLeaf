use crate::collab::*;

#[test]
fn a_second_process_catches_up_to_updates_in_the_shared_log() {
    use crate::{auth::AuthUser, schema::node_schema};
    use yrs::{GetString, Text};

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let here = Rooms::new(db.clone(), drive.clone());
    let there = Rooms::new(db, drive);
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
    there.join("file", &ann, Role::Editor, 1).unwrap();
    here.join("file", &ann, Role::Editor, 1).unwrap();
    here.join("file", &sam, Role::Editor, 2).unwrap();
    let doc = Doc::new();
    let root = doc.get_or_insert_text("body");
    let before = doc.transact().state_vector();
    root.insert(&mut doc.transact_mut(), 0, "hello");
    let update = doc.transact().encode_state_as_update_v1(&before);
    assert!(
        here.apply_update(LiveUpdate {
            item: "file",
            user_id: "ann",
            name: "Ann",
            role: Role::Editor,
            bytes: &update,
            unit: "paragraph",
            key: "body",
            at: "2026-10-30T22:00:00.000Z",
        })
        .unwrap()
    );
    assert!(there.catch_up("file").unwrap());
    let live = there.live.lock().unwrap();
    let room = live.get("file").unwrap();
    let text = room.doc.get_or_insert_text("body");
    assert_eq!(text.get_string(&room.doc.transact()), "hello");
    assert_eq!(room.mode, "multiuser");
}

#[test]
fn a_new_process_replays_saved_updates_for_the_open_generation() {
    use crate::{auth::AuthUser, schema::node_schema};
    use yrs::{GetString, Text};

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let doc = Doc::new();
    let root = doc.get_or_insert_text("body");
    let before = doc.transact().state_vector();
    root.insert(&mut doc.transact_mut(), 0, "hello");
    let update = doc.transact().encode_state_as_update_v1(&before);
    db.transact(|tx| {
        tx.upsert(
            "drive_room",
            "file",
            [
                ("mode", DbValue::from("multiuser")),
                ("generation", DbValue::Integer(1)),
                ("baseline", DbValue::from("")),
            ],
        )?;
        tx.upsert(
            "drive_room_update",
            "018f0000-0000-7000-8000-000000000001",
            [
                ("itemId", DbValue::from("file")),
                ("generation", DbValue::Integer(1)),
                ("bytes", DbValue::from(STANDARD.encode(update))),
                ("userId", DbValue::from("ann")),
                ("at", DbValue::from("2026-10-30T22:00:00.000Z")),
                ("unit", DbValue::from("text")),
                ("key", DbValue::from("body")),
            ],
        )
    })
    .unwrap();
    let ann = AuthUser {
        id: "ann".into(),
        email: None,
        name: Some("Ann".into()),
        role: None,
    };
    let first = Rooms::new(db.clone(), drive.clone());
    let joined = first.join("file", &ann, Role::Editor, 1).unwrap();
    assert_eq!(joined.mode, "multiuser");
    let encoded = joined.state.expect("replayed state");
    let again = Rooms::new(db, drive);
    let rejoined = again.join("file", &ann, Role::Editor, 2).unwrap();
    assert_eq!(rejoined.state.as_deref(), Some(encoded.as_str()));
    let decoded = STANDARD.decode(encoded).unwrap();
    let restored = Doc::new();
    restored
        .transact_mut()
        .apply_update(Update::decode_v1(&decoded).unwrap())
        .unwrap();
    let text = restored.get_or_insert_text("body");
    assert_eq!(text.get_string(&restored.transact()), "hello");
}

#[test]
fn a_restart_keeps_sheet_cells_names_and_rules() {
    use crate::{auth::AuthUser, schema::node_schema};
    use yrs::Map;

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let doc = Doc::new();
    let cells = doc.get_or_insert_map("cells");
    let sheet_names = doc.get_or_insert_map("sheetNames");
    let named_ranges = doc.get_or_insert_map("namedRanges");
    let rules = doc.get_or_insert_map("validationRules");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        cells.insert(&mut txn, "fees\u{1f}0\u{1f}0", r#"{"v":"North"}"#);
        sheet_names.insert(&mut txn, "fees", "Fees");
        named_ranges.insert(
            &mut txn,
            "fees-total",
            r#"{"name":"Total","formula":"=A2","sheetId":"fees"}"#,
        );
        rules.insert(
            &mut txn,
            "fees\u{1f}whole",
            r#"{"id":"whole","type":"whole"}"#,
        );
    }
    let update = doc.transact().encode_state_as_update_v1(&before);
    db.transact(|tx| {
        tx.upsert(
            "drive_room",
            "file",
            [
                ("mode", DbValue::from("multiuser")),
                ("generation", DbValue::Integer(1)),
                ("baseline", DbValue::from("")),
            ],
        )?;
        tx.upsert(
            "drive_room_update",
            "018f0000-0000-7000-8000-000000000002",
            [
                ("itemId", DbValue::from("file")),
                ("generation", DbValue::Integer(1)),
                ("bytes", DbValue::from(STANDARD.encode(update))),
                ("userId", DbValue::from("ann")),
                ("at", DbValue::from("2026-11-03T15:00:00.000Z")),
                ("unit", DbValue::from("cell")),
                ("key", DbValue::from("fees")),
            ],
        )
    })
    .unwrap();
    let ann = AuthUser {
        id: "ann".into(),
        email: None,
        name: Some("Ann".into()),
        role: None,
    };
    let rooms = Rooms::new(db, drive);
    let joined = rooms.join("file", &ann, Role::Editor, 1).unwrap();
    let decoded = STANDARD
        .decode(joined.state.expect("replayed state"))
        .unwrap();
    let restored = Doc::new();
    restored
        .transact_mut()
        .apply_update(Update::decode_v1(&decoded).unwrap())
        .unwrap();
    let txn = restored.transact();
    let cell = txn
        .get_map("cells")
        .unwrap()
        .get(&txn, "fees\u{1f}0\u{1f}0")
        .unwrap();
    assert!(format!("{cell:?}").contains("North"), "{cell:?}");
    assert!(!format!("{cell:?}").contains("secret-value"));
    assert_eq!(
        txn.get_map("sheetNames")
            .unwrap()
            .get(&txn, "fees")
            .and_then(|value| match value {
                yrs::Out::Any(yrs::Any::String(text)) => Some(text.to_string()),
                _ => None,
            })
            .as_deref(),
        Some("Fees")
    );
    let range = txn
        .get_map("namedRanges")
        .unwrap()
        .get(&txn, "fees-total")
        .unwrap();
    assert!(format!("{range:?}").contains("Total"), "{range:?}");
    let rule = txn
        .get_map("validationRules")
        .unwrap()
        .get(&txn, "fees\u{1f}whole")
        .unwrap();
    assert!(format!("{rule:?}").contains("whole"), "{rule:?}");
}

#[test]
fn a_restarted_slide_room_writes_both_objects_and_the_transition() {
    use crate::{auth::AuthUser, schema::node_schema};
    use suitedrive::Principal;
    use yrs::Map;

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let file = br#"{"format":"suiteleaf","version":1,"id":"f","kind":"slide","title":"Beds","createdAt":"2026-10-30T18:00:00.000Z","updatedAt":"2026-10-30T18:00:00.000Z","content":{"name":"slide-restart","slideOrder":["s1"],"slides":{"s1":{"id":"s1","notes":"Water the beds","elements":[]}}}}"#;
    let who = Principal {
        id: "maya".into(),
        admin: false,
    };
    let item = drive
        .create(
            &who,
            None,
            "Beds.slslides",
            "file",
            Some("application/json"),
        )
        .unwrap();
    drive
        .write(&who, &item.id, None, Some("application/json"), file)
        .unwrap();
    drive
        .share(&who, &item.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let rooms = Rooms::new(db.clone(), drive.clone());
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
    let slides = doc.get_or_insert_map("slides");
    let elements = doc.get_or_insert_map("slideElements");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        slides.insert(
            &mut txn,
            "s1",
            r##"{"id":"s1","notes":"Water the beds","layout":"title-body","background":{"color":"#112233"},"transition":{"type":"fade","duration":0.5},"elementOrder":["a"]}"##,
        );
        elements.insert(&mut txn, "s1\u{1f}a", r#"{"id":"a","text":"West"}"#);
        elements.insert(
            &mut txn,
            "s1\u{1f}b",
            r#"{"id":"b","text":"North","animation":"fade"}"#,
        );
        elements.insert(
            &mut txn,
            "s1\u{1f}secret-value\nx",
            r#"{"id":"x","text":"secret-value"}"#,
        );
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
                unit: "object",
                key: "s1",
                at: "2026-10-30T18:05:00.000Z",
            })
            .unwrap()
    );
    let later = Rooms::new(
        db.clone(),
        Drive::open(db.clone(), &dir.path().join("blobs")).unwrap(),
    );
    later.join(&item.id, &maya, Role::Editor, 3).unwrap();
    later
        .db
        .transact(|tx| {
            tx.delete("drive_presence", &presence_id(&item.id, "maya"))?;
            tx.delete("drive_presence", &presence_id(&item.id, "sam"))?;
            Ok(())
        })
        .unwrap();
    later.kick(10_000, 1).unwrap();
    let (_item, bytes) = drive.read(&who, &item.id, None).unwrap();
    let saved = String::from_utf8(bytes).unwrap();
    assert!(saved.contains("West"), "{saved}");
    assert!(saved.contains("North"), "{saved}");
    assert!(saved.contains("fade"), "{saved}");
    assert!(saved.contains("title-body"), "{saved}");
    assert!(saved.contains("#112233"), "{saved}");
    assert!(saved.contains("Water the beds"), "{saved}");
    assert!(!saved.contains("secret-value"), "{saved}");
}
