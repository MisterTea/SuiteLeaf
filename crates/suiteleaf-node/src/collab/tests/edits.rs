use yrs::GetString;

use crate::collab::{body::body_snapshot, *};

#[test]
fn a_viewer_or_commenter_cannot_change_the_live_document() {
    use crate::{auth::AuthUser, schema::node_schema};

    fn labeled(name: &str, text: &str) -> Vec<u8> {
        use yrs::Text;

        let doc = Doc::new();
        let root = doc.get_or_insert_text(name);
        let before = doc.transact().state_vector();
        root.insert(&mut doc.transact_mut(), 0, text);
        doc.transact().encode_state_as_update_v1(&before)
    }
    fn push(rooms: &Rooms, role: Role, unit: &str, bytes: &[u8]) -> bool {
        rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "person",
                name: "Person",
                role,
                bytes,
                unit,
                key: "0",
                at: "2026-10-30T18:00:00.000Z",
            })
            .unwrap()
    }
    fn root(rooms: &Rooms, name: &str) -> String {
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        let txn = room.doc.transact();
        txn.get_text(name)
            .map(|text| text.get_string(&txn))
            .unwrap_or_default()
    }

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
    let editor = AuthUser {
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
    rooms.join("file", &editor, Role::Editor, 1).unwrap();
    let shared = rooms.join("file", &sam, Role::Editor, 2).unwrap();
    assert_eq!(shared.mode, "multiuser");

    assert!(push(
        &rooms,
        Role::Editor,
        "paragraph",
        &labeled("editorNote", "from an editor")
    ));
    assert!(!push(
        &rooms,
        Role::Viewer,
        "paragraph",
        &labeled("viewerNote", "from a viewer")
    ));
    assert!(!push(
        &rooms,
        Role::Commenter,
        "paragraph",
        &labeled("bodyNote", "from a commenter")
    ));
    assert!(!push(
        &rooms,
        Role::Responder,
        "cell",
        &labeled("sheetNote", "from a responder")
    ));
    assert!(push(
        &rooms,
        Role::Commenter,
        "comment",
        &labeled("commentNote", "from a comment")
    ));
    fn paragraphs_update() -> Vec<u8> {
        use yrs::{Array, TextPrelim};
        let doc = Doc::new();
        let paragraphs = doc.get_or_insert_array("paragraphs");
        let before = doc.transact().state_vector();
        paragraphs.insert(&mut doc.transact_mut(), 0, TextPrelim::new("secret-value"));
        doc.transact().encode_state_as_update_v1(&before)
    }
    fn cells_update() -> Vec<u8> {
        use yrs::Map;
        let doc = Doc::new();
        let cells = doc.get_or_insert_map("cells");
        let before = doc.transact().state_vector();
        cells.insert(&mut doc.transact_mut(), "0:0", "secret-value");
        doc.transact().encode_state_as_update_v1(&before)
    }
    assert!(!push(
        &rooms,
        Role::Commenter,
        "comment",
        &paragraphs_update()
    ));
    assert!(!push(&rooms, Role::Commenter, "comment", &cells_update()));
    assert_eq!(root(&rooms, "editorNote"), "from an editor");
    assert_eq!(root(&rooms, "commentNote"), "from a comment");
    assert!(root(&rooms, "viewerNote").is_empty());
    assert!(root(&rooms, "bodyNote").is_empty());
    assert!(root(&rooms, "sheetNote").is_empty());
    let live = rooms.live.lock().expect("rooms");
    let room = live.get("file").expect("room");
    let snapshot = body_snapshot(&room.doc);
    assert!(!snapshot.contains("secret-value"));
    assert!(paragraph_texts(&room.doc).is_empty());
}

#[test]
fn a_second_seed_does_not_repeat_the_document() {
    use crate::{auth::AuthUser, schema::node_schema};
    use yrs::{Array, TextPrelim};

    fn seed(text: &str) -> Vec<u8> {
        let doc = Doc::new();
        let paragraphs = doc.get_or_insert_array("paragraphs");
        let before = doc.transact().state_vector();
        paragraphs.insert(&mut doc.transact_mut(), 0, TextPrelim::new(text));
        doc.transact().encode_state_as_update_v1(&before)
    }
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
    rooms.join("file", &maya, Role::Editor, 1).unwrap();
    assert_eq!(
        rooms.join("file", &sam, Role::Editor, 2).unwrap().mode,
        "multiuser"
    );
    let first = seed("Tomatoes are in");
    assert!(
        rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "maya",
                name: "Maya",
                role: Role::Editor,
                bytes: &first,
                unit: "seed",
                key: "0",
                at: "2026-10-31T18:00:00.000Z",
            })
            .unwrap()
    );
    let second = seed("Tomatoes are in");
    assert!(
        !rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "sam",
                name: "Sam",
                role: Role::Editor,
                bytes: &second,
                unit: "seed",
                key: "0",
                at: "2026-10-31T18:00:01.000Z",
            })
            .unwrap()
    );
    let beans = seed("Beans are staked");
    assert!(
        rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "sam",
                name: "Sam",
                role: Role::Editor,
                bytes: &beans,
                unit: "paragraph",
                key: "1",
                at: "2026-10-31T18:00:02.000Z",
            })
            .unwrap()
    );
    let live = rooms.live.lock().expect("rooms");
    let room = live.get("file").expect("room");
    let texts = paragraph_texts(&room.doc);
    assert_eq!(
        texts
            .iter()
            .filter(|text| text.as_str() == "Tomatoes are in")
            .count(),
        1
    );
    assert!(texts.iter().any(|text| text == "Beans are staked"));
    assert!(!texts.iter().any(|text| text.contains("secret-value")));
}

#[test]
fn a_repeated_update_is_acknowledged_once_in_the_journal() {
    use crate::{auth::AuthUser, schema::node_schema};
    use yrs::Text;

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
    rooms.join("file", &maya, Role::Editor, 1).unwrap();
    rooms.join("file", &sam, Role::Editor, 2).unwrap();
    let doc = Doc::new();
    let root = doc.get_or_insert_text("body");
    let before = doc.transact().state_vector();
    root.insert(&mut doc.transact_mut(), 0, "Beds");
    let bytes = doc.transact().encode_state_as_update_v1(&before);
    let send = |at: &str| {
        rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "maya",
                name: "Maya",
                role: Role::Editor,
                bytes: &bytes,
                unit: "text",
                key: "body",
                at,
            })
            .unwrap()
    };
    assert!(send("2026-11-01T00:00:00.000Z"));
    assert!(send("2026-11-01T00:00:01.000Z"));
    let rows = db
        .query(
            "SELECT id FROM drive_room_update WHERE itemId = ?1",
            &[DbValue::Text("file".into())],
        )
        .unwrap();
    assert_eq!(rows.len(), 1);
    let live = rooms.live.lock().expect("rooms");
    let room = live.get("file").expect("room");
    let txn = room.doc.transact();
    let text = txn.get_text("body").unwrap().get_string(&txn);
    assert_eq!(text, "Beds");
    assert!(!text.contains("secret-value"));
    drop(txn);
    drop(live);
    let later = Rooms::new(
        db.clone(),
        Drive::open(db.clone(), &dir.path().join("blobs")).unwrap(),
    );
    later.join("file", &maya, Role::Editor, 3).unwrap();
    let live = later.live.lock().expect("rooms");
    let room = live.get("file").expect("room");
    let txn = room.doc.transact();
    let text = txn.get_text("body").unwrap().get_string(&txn);
    assert_eq!(text, "Beds");
}

#[test]
fn a_commenter_may_store_a_comment_and_not_a_document_attribute() {
    use yrs::Map;

    fn attr_update(key: &str, value: &str) -> Vec<u8> {
        let doc = Doc::new();
        let before = doc.transact().state_vector();
        let map = doc.get_or_insert_map("docAttrs");
        map.insert(&mut doc.transact_mut(), key, value);
        doc.transact().encode_state_as_update_v1(&before)
    }

    let doc = Doc::new();
    let comment = attr_update("commentThreads", "Water the beds");
    assert!(!body_changed(&doc, &comment).unwrap());
    let styled = attr_update("paragraphStyles", "secret-value");
    assert!(body_changed(&doc, &styled).unwrap());
    let forms = {
        let doc = Doc::new();
        let before = doc.transact().state_vector();
        let map = doc.get_or_insert_map("forms");
        map.insert(&mut doc.transact_mut(), "note", "secret-value");
        doc.transact().encode_state_as_update_v1(&before)
    };
    assert!(body_changed(&Doc::new(), &forms).unwrap());

    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(
        Db::open_in_memory(
            suiteleaf_net::identity::ed25519::Keypair::generate(),
            crate::schema::node_schema(None).unwrap(),
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rooms = Rooms::new(db, drive);
    let maya = crate::auth::AuthUser {
        id: "maya".into(),
        email: None,
        name: Some("Maya".into()),
        role: None,
    };
    let sam = crate::auth::AuthUser {
        id: "sam".into(),
        email: None,
        name: Some("Sam".into()),
        role: None,
    };
    rooms.join("file", &maya, Role::Editor, 1).unwrap();
    rooms.join("file", &sam, Role::Commenter, 2).unwrap();
    assert!(
        rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "sam",
                name: "Sam",
                role: Role::Commenter,
                bytes: &comment,
                unit: "comment",
                key: "0",
                at: "2026-11-01T14:00:00.000Z",
            })
            .unwrap()
    );
    assert!(
        !rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "sam",
                name: "Sam",
                role: Role::Commenter,
                bytes: &styled,
                unit: "comment",
                key: "1",
                at: "2026-11-01T14:00:01.000Z",
            })
            .unwrap()
    );
    assert!(
        !rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "sam",
                name: "Sam",
                role: Role::Commenter,
                bytes: &forms,
                unit: "comment",
                key: "2",
                at: "2026-11-01T14:00:02.000Z",
            })
            .unwrap()
    );
    {
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        let txn = room.doc.transact();
        let map = txn.get_map("docAttrs").expect("attrs");
        let threads = map.get(&txn, "commentThreads");
        assert!(format!("{threads:?}").contains("Water the beds"));
        assert!(map.get(&txn, "paragraphStyles").is_none());
        assert!(txn.get_map("forms").is_none());
        assert!(!format!("{threads:?}").contains("secret-value"));
    }
    let notes = {
        use yrs::{Transact, XmlElementPrelim, XmlFragment, XmlTextPrelim};
        let doc = Doc::new();
        let before = doc.transact().state_vector();
        let fragment = doc.get_or_insert_xml_fragment("notes");
        let mut txn = doc.transact_mut();
        let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        paragraph.push_back(&mut txn, XmlTextPrelim::new("secret-value"));
        drop(txn);
        doc.transact().encode_state_as_update_v1(&before)
    };
    assert!(body_changed(&Doc::new(), &notes).unwrap());
    assert!(
        !rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "sam",
                name: "Sam",
                role: Role::Commenter,
                bytes: &notes,
                unit: "comment",
                key: "3",
                at: "2026-11-01T14:00:03.000Z",
            })
            .unwrap()
    );
    {
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        assert!(!body_snapshot(&room.doc).contains("secret-value"));
    }
    let (caption, rewritten) = {
        use yrs::{Array, Map, Text, Transact, WriteTxn, XmlTextPrelim};
        let doc = Doc::new();
        let start = doc.transact().state_vector();
        {
            let mut txn = doc.transact_mut();
            let labels = txn.get_or_insert_map("labels");
            labels.insert(&mut txn, "bed", XmlTextPrelim::new("Beds"));
            let captions = txn.get_or_insert_array("captions");
            captions.insert(&mut txn, 0, XmlTextPrelim::new("North"));
        }
        let seeded = doc.transact().state_vector();
        let caption = doc.transact().encode_state_as_update_v1(&start);
        {
            let mut txn = doc.transact_mut();
            let labels = txn.get_or_insert_map("labels");
            let label = match labels.get(&txn, "bed") {
                Some(yrs::Out::YXmlText(text)) => text,
                _ => panic!("label"),
            };
            label.remove_range(&mut txn, 0, 4);
            label.insert(&mut txn, 0, "secret-value");
            let captions = txn.get_or_insert_array("captions");
            let nested = match captions.get(&txn, 0) {
                Some(yrs::Out::YXmlText(text)) => text,
                _ => panic!("caption list"),
            };
            nested.remove_range(&mut txn, 0, 5);
            nested.insert(&mut txn, 0, "secret-value");
        }
        let rewritten = doc.transact().encode_state_as_update_v1(&seeded);
        (caption, rewritten)
    };
    let seeded = Doc::new();
    seeded
        .transact_mut()
        .apply_update(yrs::Update::decode_v1(&caption).unwrap())
        .unwrap();
    assert!(body_changed(&seeded, &rewritten).unwrap());
    assert!(
        rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "maya",
                name: "Maya",
                role: Role::Editor,
                bytes: &caption,
                unit: "paragraph",
                key: "4",
                at: "2026-11-01T14:00:04.000Z",
            })
            .unwrap()
    );
    assert!(
        !rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "sam",
                name: "Sam",
                role: Role::Commenter,
                bytes: &rewritten,
                unit: "comment",
                key: "5",
                at: "2026-11-01T14:00:05.000Z",
            })
            .unwrap()
    );
    let live = rooms.live.lock().expect("rooms");
    let room = live.get("file").expect("room");
    let snapshot = body_snapshot(&room.doc);
    assert!(snapshot.contains("Beds"));
    assert!(snapshot.contains("North"));
    assert!(!snapshot.contains("secret-value"));
}
