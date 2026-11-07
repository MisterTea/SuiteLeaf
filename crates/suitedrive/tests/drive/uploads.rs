//! Uploads sent in slices, and the storage budget.

use std::sync::Arc;

use libp2p_identity::ed25519;
use suitedb::{Db, Schema};
use suitedrive::{Drive, DriveError, tables};

use crate::support::{node, user};

#[test]
fn a_span_upload_keeps_the_first_part_until_the_file_is_complete() {
    let n = node();
    let ann = user("ann");
    let file = n
        .drive
        .create(&ann, None, "Notes.sldoc", "file", None)
        .unwrap();
    let first = n
        .drive
        .write_span(&ann, &file.id, None, Some("text/plain"), 0, 10, b"Beds")
        .unwrap();
    assert!(first.is_none());
    let gap = n.drive.write_span(
        &ann,
        &file.id,
        None,
        Some("text/plain"),
        6,
        10,
        b"secret-value",
    );
    let message = gap.expect_err("gap").to_string();
    assert_eq!(message, "That upload does not continue the saved part.");
    assert!(!message.contains("secret-value"));
    assert!(Drive::content_range("bytes secret-value").is_none());
    assert_eq!(Drive::content_range("bytes 0-0/0"), Some((0, 0, 0)));
    assert!(Drive::content_range("bytes 1-1/0").is_none());
    let saved = n
        .drive
        .write_span(&ann, &file.id, None, Some("text/plain"), 4, 10, b" north")
        .unwrap()
        .expect("complete");
    let (_item, bytes) = n.drive.read(&ann, &file.id, None).unwrap();
    assert_eq!(bytes, b"Beds north");
    assert!(saved.head_version_id.is_some());
    let blank = n
        .drive
        .create(&ann, None, "Blank.sldoc", "file", None)
        .unwrap();
    let empty = n
        .drive
        .write_span(&ann, &blank.id, None, Some("text/plain"), 0, 0, b"")
        .unwrap()
        .expect("empty");
    let (_blank, empty_bytes) = n.drive.read(&ann, &blank.id, None).unwrap();
    assert!(empty_bytes.is_empty());
    assert!(empty.head_version_id.is_some());
}

#[test]
fn a_restart_keeps_the_accepted_part_of_an_upload() {
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
    let blobs = dir.path().join("blobs");
    let ann = user("ann");
    let file = {
        let drive = Drive::open(db.clone(), &blobs).unwrap();
        let file = drive
            .create(&ann, None, "Notes.sldoc", "file", None)
            .unwrap();
        assert!(
            drive
                .write_span(&ann, &file.id, None, Some("text/plain"), 0, 10, b"Beds")
                .unwrap()
                .is_none()
        );
        file
    };
    let again = Drive::open(db, &blobs).unwrap();
    let saved = again
        .write_span(&ann, &file.id, None, Some("text/plain"), 4, 10, b" north")
        .unwrap()
        .expect("complete");
    let (_item, bytes) = again.read(&ann, &file.id, None).unwrap();
    assert_eq!(bytes, b"Beds north");
    assert!(saved.head_version_id.is_some());
    assert!(!blobs.join("partials").join(&file.id).exists());
}

#[test]
fn a_storage_budget_refuses_a_file_that_does_not_fit() {
    let n = node();
    let rosa = user("rosa");
    let file = n
        .drive
        .create(&rosa, None, "Notes.sldoc", "file", None)
        .unwrap();
    let bad = Drive::storage_budget_from("secret-value").unwrap_err();
    let message = bad.to_string();
    assert_eq!(
        message,
        "The storage budget is not a whole number of bytes."
    );
    assert!(!message.contains("secret-value"));
    n.drive.set_storage_budget(Some(8));
    let too_big = n
        .drive
        .write(&rosa, &file.id, None, None, b"keep this")
        .unwrap_err();
    assert!(matches!(too_big, DriveError::NoRoom));
    assert_eq!(
        too_big.to_string(),
        "SuiteDrive does not have room for this file."
    );
    assert!(!too_big.to_string().contains("keep this"));
    n.drive.write(&rosa, &file.id, None, None, b"beds").unwrap();
    let (_item, bytes) = n.drive.read(&rosa, &file.id, None).unwrap();
    assert_eq!(bytes, b"beds");
    let later = n
        .drive
        .write(&rosa, &file.id, None, None, b"secret-value")
        .unwrap_err();
    assert!(matches!(later, DriveError::NoRoom));
    assert!(!later.to_string().contains("secret-value"));
    let (_item, bytes) = n.drive.read(&rosa, &file.id, None).unwrap();
    assert_eq!(bytes, b"beds");
    let span = n
        .drive
        .write_span(&rosa, &file.id, None, None, 0, 20, b"north")
        .unwrap_err();
    assert!(matches!(span, DriveError::NoRoom));
    let (_item, bytes) = n.drive.read(&rosa, &file.id, None).unwrap();
    assert_eq!(bytes, b"beds");
}

#[test]
fn an_upload_span_accepts_files_larger_than_256mb() {
    let n = node();
    let ann = user("ann");
    let file = n
        .drive
        .create(&ann, None, "Large.sldoc", "file", None)
        .unwrap();
    let total = 350 * 1024 * 1024;
    let res = n
        .drive
        .write_span(&ann, &file.id, None, Some("text/plain"), 0, total, b"head");
    assert!(res.is_ok());
    assert!(res.unwrap().is_none());
}
