use std::sync::Arc;

use libp2p_identity::ed25519;
use suitedb::{Db, Schema, Value};
use suitedrive::{Drive, DriveError, Principal, Role, tables};

struct Node {
    db: Arc<Db>,
    drive: Arc<Drive>,
    _dir: tempfile::TempDir,
}

fn node() -> Node {
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

fn user(id: &str) -> Principal {
    Principal {
        id: id.into(),
        admin: false,
    }
}

fn edge(db: &Db, id: &str, group: &str, kind: &str, member: &str) {
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

#[test]
fn nesting_a_group_inside_itself_is_refused() {
    let n = node();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    let volunteers = n.drive.create_group("rosa", "Volunteers").unwrap();
    n.drive
        .add_member("rosa", &club.id, "group", &volunteers.id)
        .unwrap();
    let err = n
        .drive
        .add_member("rosa", &volunteers.id, "group", &club.id)
        .unwrap_err();
    assert!(matches!(err, DriveError::BadRequest(message) if message.contains("loop")));
    assert!(!n.drive.group_has_loop(&club.id).unwrap());
}

#[test]
fn a_replicated_loop_does_not_trap_membership_walks() {
    let n = node();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    let volunteers = n.drive.create_group("rosa", "Volunteers").unwrap();
    edge(&n.db, "e1", &club.id, "group", &volunteers.id);
    edge(&n.db, "e2", &volunteers.id, "group", &club.id);
    edge(&n.db, "e3", &volunteers.id, "user", "sam");
    assert!(n.drive.group_has_loop(&club.id).unwrap());
    let groups = n.drive.group_ids("sam").unwrap();
    let ids: Vec<_> = groups
        .iter()
        .filter_map(|value| match value {
            Value::Text(id) => Some(id.as_str()),
            _ => None,
        })
        .collect();
    assert!(ids.contains(&volunteers.id.as_str()));
    assert!(ids.contains(&club.id.as_str()));
    assert_eq!(n.drive.group_detail(&club.id).unwrap().loop_present, true);
}

#[test]
fn a_nested_group_can_open_a_shared_file() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    let volunteers = n.drive.create_group("rosa", "Volunteers").unwrap();
    n.drive
        .add_member("rosa", &club.id, "group", &volunteers.id)
        .unwrap();
    n.drive
        .add_member("rosa", &volunteers.id, "user", "sam")
        .unwrap();
    let file = n
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, Some("text/plain"), b"Saturday")
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "group", &club.id, Some(Role::Viewer))
        .unwrap();
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Viewer));
    let shared = n.drive.shared(&sam).unwrap();
    assert_eq!(shared.len(), 1);
    assert_eq!(shared[0].name, "Watering rota.sldoc");
}

#[test]
fn opening_the_same_file_twice_within_fifteen_minutes_is_one_event() {
    let n = node();
    n.drive.note_open("sam", "file-1", "Watering rota").unwrap();
    n.drive.note_open("sam", "file-1", "Watering rota").unwrap();
    let trail = n.drive.document_trail("sam").unwrap();
    assert_eq!(trail.len(), 1);
    assert_eq!(trail[0].action, "open");

    let rows = n
        .db
        .query("SELECT id FROM audit_event", &[])
        .unwrap();
    let id = rows[0].get("id").and_then(|v| match v {
        Value::Text(s) => Some(s.clone()),
        _ => None,
    }).unwrap();
    n.db.transact(|tx| {
        tx.upsert(
            "audit_event",
            &id,
            [("at", Value::Text("2000-01-01T00:00:00.000Z".into()))],
        )
    })
    .unwrap();
    n.drive.note_open("sam", "file-1", "Watering rota").unwrap();
    assert_eq!(n.drive.document_trail("sam").unwrap().len(), 2);
}

#[test]
fn edits_already_in_version_history_show_on_the_trail() {
    let n = node();
    let sam = user("sam");
    let file = n
        .drive
        .create(&sam, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&sam, &file.id, None, Some("text/plain"), b"Saturday")
        .unwrap();
    n.drive.note_open("sam", &file.id, "Watering rota.sldoc").unwrap();
    let trail = n.drive.document_trail("sam").unwrap();
    assert!(trail.iter().any(|entry| entry.action == "edit" && entry.name.contains("Watering")));
    assert!(trail.iter().any(|entry| entry.action == "open"));
}

#[test]
fn a_group_grant_is_read_comment_or_write() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    let volunteers = n.drive.create_group("rosa", "Volunteers").unwrap();
    n.drive
        .add_member("rosa", &club.id, "group", &volunteers.id)
        .unwrap();
    n.drive
        .add_member("rosa", &volunteers.id, "user", "sam")
        .unwrap();
    let file = n
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, Some("text/plain"), b"Monday")
        .unwrap();

    n.drive
        .share(&rosa, &file.id, "group", &club.id, Some(Role::Viewer))
        .unwrap();
    assert!(n.drive.read(&sam, &file.id, None).is_ok());
    assert!(matches!(
        n.drive.add_comment(&sam, &file.id, "Tuesday?"),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, Some("text/plain"), b"changed"),
        Err(DriveError::Forbidden)
    ));
    let notices = n.drive.notices(&sam).unwrap();
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].role, Role::Viewer);

    n.drive
        .share(&rosa, &file.id, "group", &club.id, Some(Role::Commenter))
        .unwrap();
    assert!(n.drive.add_comment(&sam, &file.id, "Tuesday?").is_ok());
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, Some("text/plain"), b"changed"),
        Err(DriveError::Forbidden)
    ));

    n.drive
        .share(&rosa, &file.id, "group", &club.id, Some(Role::Editor))
        .unwrap();
    assert!(n
        .drive
        .write(&sam, &file.id, None, Some("text/plain"), b"Tuesday")
        .is_ok());

    n.drive
        .add_member("rosa", &volunteers.id, "user", "priya")
        .unwrap();
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}
