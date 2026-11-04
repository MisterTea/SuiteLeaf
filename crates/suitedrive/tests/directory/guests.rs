//! Guest shares that end, and how their end dates are read.

use suitedb::Value;
use suitedrive::{DriveError, Role};

use crate::support::{node, user};

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
    let rows =
        n.db.query(
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
