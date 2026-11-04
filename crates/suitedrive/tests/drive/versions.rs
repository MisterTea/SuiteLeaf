//! Saving over a newer version, version names, restore, and the last editor.

use suitedrive::{DriveError, Role};

use crate::support::{node, sync, user};

#[test]
fn stale_saves_conflict_and_every_version_is_kept() {
    let n = node();
    let ann = user("ann");
    let file = n
        .drive
        .create(&ann, None, "notes.sldoc", "file", None)
        .unwrap();
    let v1 = n.drive.write(&ann, &file.id, None, None, b"one").unwrap();
    let v2 = n
        .drive
        .write(&ann, &file.id, v1.head_version_id.as_deref(), None, b"two")
        .unwrap();
    match n.drive.write(
        &ann,
        &file.id,
        v1.head_version_id.as_deref(),
        None,
        b"stale",
    ) {
        Err(DriveError::Conflict(current)) => {
            assert_eq!(current.head_version_id, v2.head_version_id)
        }
        other => panic!("expected a conflict, got {other:?}"),
    }
    let versions = n.drive.versions(&ann, &file.id).unwrap();
    assert_eq!(versions.len(), 2);
    let (_, old) = n.drive.read(&ann, &file.id, Some(&versions[1].id)).unwrap();
    assert_eq!(old, b"one");
}

#[test]
fn a_retry_of_the_same_bytes_does_not_add_a_version() {
    let n = node();
    let ann = user("ann");
    let file = n
        .drive
        .create(&ann, None, "notes.sldoc", "file", None)
        .unwrap();
    let first = n.drive.write(&ann, &file.id, None, None, b"beds").unwrap();
    let again = n.drive.write(&ann, &file.id, None, None, b"beds").unwrap();
    assert_eq!(again.head_version_id, first.head_version_id);
    assert_eq!(n.drive.versions(&ann, &file.id).unwrap().len(), 1);
    let changed = n
        .drive
        .write(&ann, &file.id, None, None, b"beds north")
        .unwrap();
    assert_ne!(changed.head_version_id, first.head_version_id);
    assert_eq!(n.drive.versions(&ann, &file.id).unwrap().len(), 2);
    let secret = n
        .drive
        .write(&ann, &file.id, None, None, b"secret-value")
        .unwrap();
    let repeated = n
        .drive
        .write(&ann, &file.id, None, None, b"secret-value")
        .unwrap();
    assert_eq!(repeated.head_version_id, secret.head_version_id);
    assert_eq!(n.drive.versions(&ann, &file.id).unwrap().len(), 3);
    let (_, bytes) = n.drive.read(&ann, &file.id, None).unwrap();
    assert_eq!(bytes, b"secret-value");
    let before = n.drive.versions(&ann, &file.id).unwrap().len();
    let head = n
        .drive
        .write_head("ann", &file.id, b"secret-value")
        .unwrap();
    assert_eq!(head.head_version_id, repeated.head_version_id);
    assert_eq!(n.drive.versions(&ann, &file.id).unwrap().len(), before);
    n.drive.write_head("ann", &file.id, b"beds again").unwrap();
    assert_eq!(n.drive.versions(&ann, &file.id).unwrap().len(), before + 1);
}

#[test]
fn naming_restore_and_copy_keep_every_version_byte_for_byte() {
    let (a, b) = (node(), node());
    let ann = user("ann");
    let folder = a
        .drive
        .create(&ann, None, "Garden club", "folder", None)
        .unwrap();
    let file = a
        .drive
        .create(&ann, Some(&folder.id), "rota.sldoc", "file", None)
        .unwrap();
    let monday = b"monday rota";
    let tuesday = b"tuesday rota";
    let first = a.drive.write(&ann, &file.id, None, None, monday).unwrap();
    let first_id = first.head_version_id.clone().unwrap();
    let second = a
        .drive
        .write(&ann, &file.id, Some(&first_id), None, tuesday)
        .unwrap();
    let second_id = second.head_version_id.clone().unwrap();

    let named = a
        .drive
        .name_version(&ann, &file.id, &first_id, Some("Agreed rota"))
        .unwrap();
    assert_eq!(named.name.as_deref(), Some("Agreed rota"));
    sync(&a, &b);
    let replicated = b.drive.versions(&ann, &file.id).unwrap();
    assert_eq!(
        replicated
            .iter()
            .find(|v| v.id == first_id)
            .unwrap()
            .name
            .as_deref(),
        Some("Agreed rota")
    );

    let restored = a
        .drive
        .restore(&ann, &file.id, &first_id, Some(&second_id))
        .unwrap();
    let (_, bytes) = a.drive.read(&ann, &file.id, None).unwrap();
    assert_eq!(bytes, monday);
    let history = a.drive.versions(&ann, &file.id).unwrap();
    assert_eq!(history.len(), 3);
    assert!(history.iter().any(|v| v.id == first_id));
    assert!(history.iter().any(|v| v.id == second_id));
    let head = history
        .iter()
        .find(|v| Some(&v.id) == restored.head_version_id.as_ref())
        .unwrap();
    assert_eq!(head.restored_from.as_deref(), Some(first_id.as_str()));
    assert_eq!(
        bytes,
        a.drive.read(&ann, &file.id, Some(&first_id)).unwrap().1
    );

    let again = a
        .drive
        .restore(
            &ann,
            &file.id,
            &second_id,
            restored.head_version_id.as_deref(),
        )
        .unwrap();
    assert_eq!(a.drive.read(&ann, &file.id, None).unwrap().1, tuesday);
    assert_ne!(again.head_version_id.as_deref(), Some(second_id.as_str()));
    assert_eq!(a.drive.versions(&ann, &file.id).unwrap().len(), 4);

    let copy = a
        .drive
        .copy_version(&ann, &file.id, &first_id, "rota (Sam's draft).sldoc")
        .unwrap();
    assert_eq!(copy.parent_id.as_deref(), Some(folder.id.as_str()));
    assert_eq!(a.drive.read(&ann, &copy.id, None).unwrap().1, monday);

    assert!(matches!(
        a.drive.restore(&ann, &file.id, &first_id, Some("stale")),
        Err(DriveError::Conflict(_))
    ));
}

#[test]
fn the_last_editor_is_the_head_version_author_not_the_owner() {
    let n = node();
    let (rosa, sam, alex) = (user("rosa"), user("sam"), user("alex"));
    let file = n
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    assert!(file.last_author_id.is_none());
    assert!(file.last_edited_at.is_none());

    let saved = n.drive.write(&rosa, &file.id, None, None, b"rosa").unwrap();
    assert_eq!(saved.last_author_id.as_deref(), Some(rosa.id.as_str()));
    assert!(saved.last_edited_at.is_some());
    assert_eq!(saved.owner_id, rosa.id);

    n.drive
        .share(&rosa, &file.id, "user", &sam.id, Some(Role::Editor))
        .unwrap();
    let edited = n
        .drive
        .write(
            &sam,
            &file.id,
            saved.head_version_id.as_deref(),
            None,
            b"sam",
        )
        .unwrap();
    assert_eq!(edited.owner_id, rosa.id);
    assert_eq!(edited.last_author_id.as_deref(), Some(sam.id.as_str()));
    assert_ne!(edited.last_edited_at, saved.last_edited_at);

    n.drive
        .share(&rosa, &file.id, "user", &alex.id, Some(Role::Viewer))
        .unwrap();
    let seen = n.drive.get(&alex, &file.id).unwrap();
    assert_eq!(seen.role, Some(Role::Viewer));
    assert_eq!(seen.last_author_id.as_deref(), Some(sam.id.as_str()));
    assert_eq!(seen.last_edited_at, edited.last_edited_at);

    let listed = n.drive.list(&rosa, None).unwrap();
    let row = listed.iter().find(|item| item.id == file.id).unwrap();
    assert_eq!(row.last_author_id.as_deref(), Some(sam.id.as_str()));
}
