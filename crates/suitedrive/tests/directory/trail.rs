//! The access trail: open events, edits, explanations, and audited removals.

use suitedb::Value;
use suitedrive::{AccessReason, DriveError, Principal, Role};

use crate::support::{node, user};

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
fn removing_a_grant_is_audited_and_search_stops_finding_the_file() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let file = n
        .drive
        .create(&rosa, None, "North beds.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &file.id, None, Some("text/plain"), b"secret-value")
        .unwrap();
    assert!(matches!(
        n.drive
            .share(&sam, &file.id, "user", "sam", Some(Role::Editor)),
        Err(DriveError::Forbidden)
    ));
    assert!(
        n.drive
            .audit_for("item", &file.id)
            .unwrap()
            .iter()
            .all(|event| event.action != "share.before")
    );

    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let hits = n.drive.search(&sam, "North").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].name, "North beds.sldoc");
    assert!(!hits[0].snippet.contains("secret-value"));

    n.drive.share(&rosa, &file.id, "user", "sam", None).unwrap();
    assert!(n.drive.search(&sam, "North").unwrap().is_empty());
    assert_eq!(n.drive.search(&rosa, "North").unwrap().len(), 1);
    assert!(matches!(
        n.drive.read(&sam, &file.id, None),
        Err(DriveError::Forbidden)
    ));

    let events = n.drive.audit_for("item", &file.id).unwrap();
    let before = events
        .iter()
        .filter(|event| event.action == "share.before")
        .map(|event| event.name.as_str())
        .collect::<Vec<_>>();
    let after = events
        .iter()
        .filter(|event| event.action == "share.after")
        .map(|event| event.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(before, vec!["user sam editor", "user sam none"]);
    assert_eq!(after, vec!["user sam none", "user sam editor"]);
    let shown = format!("{events:?}");
    assert!(!shown.contains("secret-value"));
}
