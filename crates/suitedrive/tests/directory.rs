use std::sync::Arc;

use libp2p_identity::ed25519;
use suitedb::{ColumnType, Db, Schema, TableDef, Value};
use suitedrive::{AccessReason, Drive, DriveError, Principal, Role, tables};

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
    assert!(n.drive.group_detail(&club.id).unwrap().loop_present);
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

    let rows = n.db.query("SELECT id FROM audit_event", &[]).unwrap();
    let id = rows[0]
        .get("id")
        .and_then(|v| match v {
            Value::Text(s) => Some(s.clone()),
            _ => None,
        })
        .unwrap();
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
    n.drive
        .note_open("sam", &file.id, "Watering rota.sldoc")
        .unwrap();
    let trail = n.drive.document_trail("sam").unwrap();
    assert!(
        trail
            .iter()
            .any(|entry| entry.action == "edit" && entry.name.contains("Watering"))
    );
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
        n.drive
            .write(&sam, &file.id, None, Some("text/plain"), b"changed"),
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
        n.drive
            .write(&sam, &file.id, None, Some("text/plain"), b"changed"),
        Err(DriveError::Forbidden)
    ));

    n.drive
        .share(&rosa, &file.id, "group", &club.id, Some(Role::Editor))
        .unwrap();
    assert!(
        n.drive
            .write(&sam, &file.id, None, Some("text/plain"), b"Tuesday")
            .is_ok()
    );

    n.drive
        .add_member("rosa", &volunteers.id, "user", "priya")
        .unwrap();
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}

#[test]
fn an_explanation_matches_the_role_decision() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let folder = n.drive.create(&rosa, None, "Beds", "folder", None).unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&folder.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let direct = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(direct.role, n.drive.role(&sam, &file.id).unwrap());
    assert!(matches!(
        direct.reason,
        AccessReason::Grant { inherited: false, principal_type, .. } if principal_type == "user"
    ));

    n.drive.share(&rosa, &file.id, "user", "sam", None).unwrap();
    n.drive
        .share(&rosa, &folder.id, "user", "sam", Some(Role::Viewer))
        .unwrap();
    let inherited = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(inherited.role, Some(Role::Viewer));
    assert!(matches!(
        inherited.reason,
        AccessReason::Grant { inherited: true, item_id, .. } if item_id == folder.id
    ));

    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    let volunteers = n.drive.create_group("rosa", "Volunteers").unwrap();
    n.drive
        .add_member("rosa", &club.id, "group", &volunteers.id)
        .unwrap();
    n.drive
        .add_member("rosa", &volunteers.id, "user", "sam")
        .unwrap();
    n.drive
        .share(&rosa, &folder.id, "user", "sam", None)
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "group", &club.id, Some(Role::Commenter))
        .unwrap();
    let nested = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(nested.role, n.drive.role(&sam, &file.id).unwrap());
    assert!(matches!(
        nested.reason,
        AccessReason::Grant { principal_type, principal_id, .. }
            if principal_type == "group" && principal_id == club.id
    ));

    n.drive
        .set_expiry(
            &rosa,
            &file.id,
            "group",
            &club.id,
            Some("2000-01-01T00:00:00.000Z"),
        )
        .unwrap();
    let ended = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(ended.role, None);
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), None);
    assert!(matches!(ended.reason, AccessReason::Expired { .. }));

    let stranger = n.drive.explain(&user("eve"), &file.id).unwrap();
    assert_eq!(stranger.role, None);
    assert_eq!(stranger.reason, AccessReason::None);
    assert!(stranger.group_loops.is_empty());
    let hidden_from_eve = n.drive.explain_visible(&user("eve"), &file.id).unwrap_err();
    let missing = n
        .drive
        .explain_visible(&user("eve"), "secret-value")
        .unwrap_err();
    assert_eq!(hidden_from_eve.to_string(), missing.to_string());
    assert_eq!(hidden_from_eve.to_string(), "not found");
    assert!(!hidden_from_eve.to_string().contains("secret-value"));
    assert!(!hidden_from_eve.to_string().contains(&file.id));

    let admin = Principal {
        id: "eve".into(),
        admin: true,
    };
    let as_admin = n.drive.explain(&admin, &file.id).unwrap();
    assert_eq!(as_admin.role, Some(Role::Owner));
    assert_eq!(as_admin.reason, AccessReason::Admin);
}

#[test]
fn a_membership_cycle_is_named_and_the_walk_still_finishes() {
    let n = node();
    let rosa = user("rosa");
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    let volunteers = n.drive.create_group("rosa", "Volunteers").unwrap();
    edge(&n.db, "e1", &club.id, "group", &volunteers.id);
    edge(&n.db, "e2", &volunteers.id, "group", &club.id);
    edge(&n.db, "e3", &volunteers.id, "user", "sam");
    let file = n
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "group", &club.id, Some(Role::Viewer))
        .unwrap();
    let explained = n.drive.explain(&user("sam"), &file.id).unwrap();
    assert_eq!(explained.role, Some(Role::Viewer));
    assert!(explained.group_loops.contains(&club.id));
    assert!(explained.group_loops.contains(&volunteers.id));
}

#[test]
fn a_restricted_folder_blocks_a_grant_from_the_folder_above_it() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let beds = n
        .drive
        .create(&rosa, Some(&garden.id), "Beds", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&beds.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    n.drive.set_restricted(&rosa, &beds.id, true).unwrap();
    assert!(n.drive.set_restricted(&sam, &beds.id, false).is_err());
    assert!(n.drive.set_restricted(&rosa, &file.id, true).is_err());
    let blocked = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(blocked.role, None);
    assert_eq!(blocked.role, n.drive.role(&sam, &file.id).unwrap());
    assert!(matches!(
        blocked.reason,
        AccessReason::Restricted { ref item_id, ref item_name, .. }
            if item_id == &beds.id && item_name == "Beds"
    ));
    let noor = n
        .drive
        .explain_visible(&user("noor"), &file.id)
        .unwrap_err();
    assert_eq!(noor.to_string(), "not found");
    assert!(!noor.to_string().contains("Watering"));
    assert!(!noor.to_string().contains(&file.id));
    let sam_visible = n.drive.explain_visible(&sam, &file.id).unwrap();
    assert!(matches!(
        sam_visible.reason,
        AccessReason::Restricted { ref item_name, .. } if item_name == "Beds"
    ));
    let hidden = n.drive.explain(&user("noor"), &file.id).unwrap();
    assert_eq!(hidden.role, None);
    assert!(matches!(
        hidden.reason,
        AccessReason::Restricted { ref item_id, ref item_name, .. }
            if item_id.is_empty() && item_name.is_empty()
    ));
    assert!(
        n.drive
            .write(&sam, &file.id, None, Some("text/plain"), b"no")
            .is_err()
    );

    n.drive
        .share(&rosa, &beds.id, "user", "sam", Some(Role::Viewer))
        .unwrap();
    let from_beds = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(from_beds.role, Some(Role::Viewer));
    assert!(matches!(
        from_beds.reason,
        AccessReason::Grant { inherited: true, ref item_id, .. } if item_id == &beds.id
    ));
}

#[test]
fn restricting_a_folder_lists_who_loses_access_and_can_be_undone() {
    let n = node();
    let rosa = user("rosa");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let beds = n
        .drive
        .create(&rosa, Some(&garden.id), "Beds", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&beds.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    n.drive
        .add_member("rosa", &club.id, "user", "priya")
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "group", &club.id, Some(Role::Viewer))
        .unwrap();

    let plan = n.drive.plan_restrict(&rosa, &beds.id).unwrap();
    assert_eq!(plan.folder_name, "Beds");
    assert!(plan.recovery.contains("Beds"));
    assert!(plan.recovery.contains("Grants stay"));
    assert!(n.drive.role(&user("sam"), &file.id).unwrap() == Some(Role::Editor));
    let sam_file = plan
        .changes
        .iter()
        .find(|change| change.principal_id == "sam" && change.item_id == file.id)
        .unwrap();
    assert_eq!(sam_file.before, Some(Role::Editor));
    assert_eq!(sam_file.after, None);
    let priya_file = plan
        .changes
        .iter()
        .find(|change| change.principal_id == "priya" && change.item_id == file.id)
        .unwrap();
    assert_eq!(priya_file.before, Some(Role::Viewer));
    assert_eq!(priya_file.after, None);

    let applied = n.drive.restrict_folder(&rosa, &beds.id).unwrap();
    assert_eq!(applied.changes.len(), plan.changes.len());
    assert_eq!(n.drive.role(&user("sam"), &file.id).unwrap(), None);
    n.drive.restore_inheritance(&rosa, &beds.id).unwrap();
    assert_eq!(
        n.drive.role(&user("sam"), &file.id).unwrap(),
        Some(Role::Editor)
    );
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Viewer)
    );
}

#[test]
fn restricting_a_folder_names_a_person_in_an_organization_grant() {
    let dir = tempfile::tempdir().unwrap();
    let mut defined = tables();
    defined.push(
        TableDef::new("member", "id")
            .column("userId", ColumnType::Text)
            .column("organizationId", ColumnType::Text),
    );
    let db = Arc::new(
        Db::open(
            &dir.path().join("db.sqlite"),
            ed25519::Keypair::generate(),
            Schema {
                version: 1,
                tables: defined,
            },
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rosa = user("rosa");
    let garden = drive.create(&rosa, None, "Garden", "folder", None).unwrap();
    let beds = drive
        .create(&rosa, Some(&garden.id), "Beds", "folder", None)
        .unwrap();
    let file = drive
        .create(&rosa, Some(&beds.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    drive
        .share(&rosa, &garden.id, "org", "club", Some(Role::Editor))
        .unwrap();
    db.transact(|tx| {
        tx.upsert(
            "member",
            "noor-club",
            [
                ("userId", Value::Text("noor".into())),
                ("organizationId", Value::Text("club".into())),
            ],
        )
    })
    .unwrap();
    let plan = drive.plan_restrict(&rosa, &beds.id).unwrap();
    let noor = plan
        .changes
        .iter()
        .find(|change| change.principal_id == "noor" && change.item_id == file.id)
        .unwrap();
    assert_eq!(noor.before, Some(Role::Editor));
    assert_eq!(noor.after, None);
    assert!(
        !plan
            .changes
            .iter()
            .any(|change| change.principal_id == "club")
    );
    assert_eq!(
        drive.role(&user("noor"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}

#[test]
fn a_guest_share_ends_and_a_permanent_share_stays_off_the_review() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let priya = user("priya");
    let file = n
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, None, b"Monday: Rosa")
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "eve", Some(Role::Viewer))
        .unwrap();
    let secret = n
        .drive
        .share_guest(&rosa, &file.id, "sam", Role::Editor, "secret-value");
    assert!(
        matches!(secret, Err(DriveError::BadRequest(message)) if message == "A guest share is a viewer or a commenter." && !message.contains("secret-value"))
    );
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Editor));
    let bad_date = n
        .drive
        .share_guest(&rosa, &file.id, "sam", Role::Viewer, "secret-value");
    assert!(
        matches!(bad_date, Err(DriveError::BadRequest(message)) if message == "A guest share needs an end date." && !message.contains("secret-value"))
    );
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Editor));
    let ended = n.drive.share_guest(
        &rosa,
        &file.id,
        "sam",
        Role::Viewer,
        "2000-01-01T00:00:00.000Z",
    );
    assert!(
        matches!(ended, Err(DriveError::BadRequest(message)) if message == "Choose an end date that is still ahead.")
    );
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Editor));

    let until = "2099-01-03T00:00:00.000Z";
    n.drive
        .share_guest(&rosa, &file.id, "sam", Role::Viewer, until)
        .unwrap();
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Viewer));
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, None, b"no"),
        Err(DriveError::Forbidden)
    ));
    let review = n.drive.guest_review(&rosa).unwrap();
    assert_eq!(review.len(), 1);
    assert_eq!(review[0].principal_id, "sam");
    assert_eq!(review[0].role, Role::Viewer);
    assert_eq!(review[0].expires_at, until);
    assert!(!review[0].expired);
    assert_eq!(review[0].item_name, "Watering rota.sldoc");
    assert!(n.drive.guest_review(&sam).unwrap().is_empty());
    assert!(n.drive.guest_review(&priya).unwrap().is_empty());
    let events = n.drive.audit_for("item", &file.id).unwrap();
    let before = events
        .iter()
        .find(|event| event.action == "guest.before")
        .unwrap();
    let after = events
        .iter()
        .find(|event| event.action == "guest.after")
        .unwrap();
    assert_eq!(before.name, "sam editor");
    assert_eq!(after.name, format!("sam viewer {until}"));
    assert!(!before.name.contains("Monday"));
    assert!(!after.name.contains("Monday"));
    assert!(!after.name.contains("secret-value"));
}

#[test]
fn a_guest_end_with_an_offset_is_stored_in_utc() {
    let n = node();
    let rosa = user("rosa");
    let file = n
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share_guest(
            &rosa,
            &file.id,
            "sam",
            Role::Viewer,
            "2099-02-28T23:00:00-05:00",
        )
        .unwrap();
    let rows = n
        .db
        .query(
            "SELECT expiresAt FROM drive_acl WHERE itemId = ?1",
            &[Value::Text(file.id.clone())],
        )
        .unwrap();
    let expires = match rows.first().and_then(|row| row.get("expiresAt")) {
        Some(Value::Text(text)) => text.clone(),
        _ => String::new(),
    };
    assert_eq!(expires, "2099-03-01T04:00:00.000Z");
    let bad = n.drive.share_guest(
        &rosa,
        &file.id,
        "sam",
        Role::Viewer,
        "2099-02-28T23:00:00-secret",
    );
    assert!(
        matches!(bad, Err(DriveError::BadRequest(message)) if message == "A guest share needs an end date." && !message.contains("secret"))
    );
}

#[test]
fn an_impossible_guest_day_does_not_open_the_file() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let file = n
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, None, b"Monday")
        .unwrap();
    let impossible = n.drive.share_guest(
        &rosa,
        &file.id,
        "sam",
        Role::Viewer,
        "2026-11-31T00:00:00.000Z",
    );
    assert!(
        matches!(impossible, Err(DriveError::BadRequest(message)) if message == "That day is not on the calendar." && !message.contains("2026"))
    );
    let leap = n.drive.share_guest(
        &rosa,
        &file.id,
        "sam",
        Role::Viewer,
        "2100-02-29T00:00:00.000Z",
    );
    assert!(
        matches!(leap, Err(DriveError::BadRequest(message)) if message == "That day is not on the calendar.")
    );
    n.drive
        .share_guest(
            &rosa,
            &file.id,
            "sam",
            Role::Viewer,
            "2099-02-28T00:00:00.000Z",
        )
        .unwrap();
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Viewer));
    n.db.transact(|tx| {
        tx.upsert(
            "drive_acl",
            &format!("{}:user:sam", file.id),
            [("expiresAt", Value::Text("secret-value".into()))],
        )
    })
    .unwrap();
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), None);
    let message = n
        .drive
        .read(&sam, &file.id, None)
        .expect_err("closed")
        .to_string();
    assert!(!message.contains("secret-value"));
    assert!(!message.contains("Monday"));
}

#[test]
fn planning_a_group_change_names_who_gains_or_loses_access_and_writes_nothing() {
    let n = node();
    let rosa = user("rosa");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&garden.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, Some("text/plain"), b"secret-value")
        .unwrap();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    n.drive
        .share(&rosa, &garden.id, "group", &club.id, Some(Role::Editor))
        .unwrap();
    n.drive
        .add_member("rosa", &club.id, "user", "priya")
        .unwrap();

    let blank = n.drive.plan_member(&club.id, " ", true).unwrap_err();
    let DriveError::BadRequest(message) = blank else {
        panic!("expected a name");
    };
    assert_eq!(message, "Name the person.");
    assert!(!message.contains("secret-value"));

    let added = n.drive.plan_member(&club.id, "sam", true).unwrap();
    assert_eq!(added.group_name, "Garden club");
    let sam_file = added
        .changes
        .iter()
        .find(|change| change.item_id == file.id)
        .unwrap();
    assert_eq!(sam_file.before, None);
    assert_eq!(sam_file.after, Some(Role::Editor));
    assert_eq!(n.drive.role(&user("sam"), &file.id).unwrap(), None);
    assert!(!format!("{added:?}").contains("secret-value"));

    let removed = n.drive.plan_member(&club.id, "priya", false).unwrap();
    let priya_file = removed
        .changes
        .iter()
        .find(|change| change.item_id == file.id)
        .unwrap();
    assert_eq!(priya_file.before, Some(Role::Editor));
    assert_eq!(priya_file.after, None);
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}

#[test]
fn planning_a_nested_group_names_each_person_and_writes_nothing() {
    let n = node();
    let rosa = user("rosa");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&garden.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, Some("text/plain"), b"secret-value")
        .unwrap();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    let volunteers = n.drive.create_group("rosa", "Volunteers").unwrap();
    n.drive
        .share(&rosa, &garden.id, "group", &club.id, Some(Role::Editor))
        .unwrap();
    n.drive
        .add_member("rosa", &volunteers.id, "user", "sam")
        .unwrap();
    n.drive
        .add_member("rosa", &volunteers.id, "user", "priya")
        .unwrap();
    n.drive
        .add_member("rosa", &club.id, "user", "priya")
        .unwrap();

    let added = n.drive.plan_member(&club.id, &volunteers.id, true).unwrap();
    let sam = added
        .changes
        .iter()
        .find(|change| change.principal_id == "sam" && change.item_id == file.id)
        .unwrap();
    assert_eq!(sam.before, None);
    assert_eq!(sam.after, Some(Role::Editor));
    assert!(
        !added
            .changes
            .iter()
            .any(|change| change.principal_id == "priya")
    );
    assert_eq!(n.drive.role(&user("sam"), &file.id).unwrap(), None);
    assert!(!format!("{added:?}").contains("secret-value"));
    n.drive
        .commit_member("rosa", &club.id, &volunteers.id, true, &added.changes)
        .unwrap();
    assert_eq!(
        n.drive.role(&user("sam"), &file.id).unwrap(),
        Some(Role::Editor)
    );
    let removed = n
        .drive
        .plan_member(&club.id, &volunteers.id, false)
        .unwrap();
    let sam_loss = removed
        .changes
        .iter()
        .find(|change| change.principal_id == "sam" && change.item_id == file.id)
        .unwrap();
    assert_eq!(sam_loss.before, Some(Role::Editor));
    assert_eq!(sam_loss.after, None);
    assert!(
        !removed
            .changes
            .iter()
            .any(|change| change.principal_id == "priya")
    );
    assert_eq!(
        n.drive.role(&user("sam"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}

#[test]
fn committing_a_group_change_checks_the_plan_again() {
    let n = node();
    let rosa = user("rosa");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&garden.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, Some("text/plain"), b"secret-value")
        .unwrap();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    n.drive
        .share(&rosa, &garden.id, "group", &club.id, Some(Role::Editor))
        .unwrap();
    let added = n.drive.plan_member(&club.id, "sam", true).unwrap();
    let mut stale = added.changes.clone();
    stale[0].after = Some(Role::Viewer);
    let wrong = n
        .drive
        .commit_member("rosa", &club.id, "sam", true, &stale)
        .unwrap_err();
    let DriveError::BadRequest(message) = wrong else {
        panic!("expected the plan to be checked again");
    };
    assert_eq!(message, "The access plan changed. Review it again.");
    assert!(!message.contains("secret-value"));
    assert_eq!(n.drive.role(&user("sam"), &file.id).unwrap(), None);
    n.drive
        .commit_member("rosa", &club.id, "sam", true, &added.changes)
        .unwrap();
    assert_eq!(
        n.drive.role(&user("sam"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}

#[test]
fn handing_over_every_owned_file_leaves_someone_elses_file() {
    let n = node();
    let sam = user("sam");
    let priya = user("priya");
    let admin = Principal {
        id: "rosa".into(),
        admin: true,
    };
    let beds = n.drive.create(&sam, None, "Beds", "file", None).unwrap();
    let paths = n.drive.create(&sam, None, "Paths", "file", None).unwrap();
    let notes = n.drive.create(&priya, None, "Notes", "file", None).unwrap();
    assert!(matches!(
        n.drive.transfer_owned(&sam, "sam", "priya"),
        Err(DriveError::Forbidden)
    ));
    let refused = n.drive.transfer_owned(&admin, "sam", "").unwrap_err();
    let DriveError::BadRequest(message) = refused else {
        panic!("expected a person to be named");
    };
    assert_eq!(message, "Choose a person to own this file.");
    assert!(!message.contains("secret-value"));
    assert_eq!(n.drive.get(&sam, &beds.id).unwrap().owner_id, "sam");
    assert_eq!(n.drive.transfer_owned(&admin, "sam", "priya").unwrap(), 2);
    assert_eq!(n.drive.get(&priya, &beds.id).unwrap().owner_id, "priya");
    assert_eq!(n.drive.get(&priya, &paths.id).unwrap().owner_id, "priya");
    assert_eq!(n.drive.get(&priya, &notes.id).unwrap().owner_id, "priya");
    assert!(n.drive.owned_item_ids("sam").unwrap().is_empty());
}

#[test]
fn an_editor_policy_lists_who_would_change_and_can_be_undone() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&garden.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, Some("text/plain"), b"secret-value")
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "priya", Some(Role::Viewer))
        .unwrap();

    let plan = n.drive.plan_editor_policy(&rosa).unwrap();
    assert_eq!(plan.changes.len(), 1);
    assert_eq!(plan.changes[0].principal_id, "sam");
    assert_eq!(plan.changes[0].item_name, "Garden");
    assert_eq!(plan.changes[0].before, Role::Editor);
    assert_eq!(plan.changes[0].after, Role::Viewer);
    assert_eq!(plan.recovery, "Set each changed grant back to editor.");
    assert!(!format!("{plan:?}").contains("secret-value"));
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Editor));

    let stale = n
        .drive
        .apply_editor_policy(&rosa, "secret-value")
        .unwrap_err();
    let DriveError::BadRequest(message) = stale else {
        panic!("expected the plan to be checked again");
    };
    assert_eq!(message, "The access plan changed. Review it again.");
    assert!(!message.contains("secret-value"));
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Editor));

    n.drive.apply_editor_policy(&rosa, &plan.stamp).unwrap();
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Viewer));
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Viewer)
    );
    let (_item, bytes) = n.drive.read(&rosa, &file.id, None).unwrap();
    assert_eq!(bytes, b"secret-value");

    n.drive
        .rollback_editor_policy(&rosa, &plan.changes)
        .unwrap();
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Editor));

    n.drive.apply_editor_policy(&rosa, &plan.stamp).unwrap();
    n.drive
        .share(&rosa, &garden.id, "user", "sam", Some(Role::Commenter))
        .unwrap();
    let drifted = n
        .drive
        .rollback_editor_policy(&rosa, &plan.changes)
        .unwrap_err();
    let DriveError::BadRequest(drifted_message) = drifted else {
        panic!("expected the plan to be checked again");
    };
    assert_eq!(drifted_message, "The access plan changed. Review it again.");
    assert_eq!(n.drive.role(&sam, &file.id).unwrap(), Some(Role::Commenter));
}
