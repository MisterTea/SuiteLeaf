//! Files and folders: content, replication, moves, trash, and deleting forever.

use std::sync::Arc;

use suitedb::Value;
use suitedrive::{BlobTransport, CHUNK_SIZE, Drive, DriveError, Hash, Manifest, Role};

use crate::support::{node, sync, user};

struct Direct(Arc<Drive>);

#[async_trait::async_trait]
impl BlobTransport for Direct {
    async fn peers(&self) -> Vec<String> {
        vec!["peer".into()]
    }
    async fn request(&self, _: &str, data: Vec<u8>) -> anyhow::Result<Vec<u8>> {
        Ok(self.0.handle_blob_request(&data))
    }
}

#[test]
fn content_round_trips_through_chunks() {
    let n = node();
    let bytes: Vec<u8> = (0..(CHUNK_SIZE * 2 + 17))
        .map(|i| (i % 251) as u8)
        .collect();
    let hash = n.drive.blobs().put_content(&bytes).unwrap();
    assert_eq!(n.drive.blobs().get_content(&hash).unwrap().unwrap(), bytes);
    assert!(n.drive.blobs().missing(&hash).unwrap().is_empty());
    assert!(n.drive.blobs().put_verified(&hash, b"tampered").is_err());
}

#[tokio::test]
async fn files_replicate_metadata_and_blobs_to_other_nodes() {
    let (a, b) = (node(), node());
    let ann = user("ann");
    let folder = a
        .drive
        .create(&ann, None, "Reports", "folder", None)
        .unwrap();
    let file = a
        .drive
        .create(&ann, Some(&folder.id), "Q3.sldoc", "file", None)
        .unwrap();
    let big: Vec<u8> = (0..CHUNK_SIZE * 3).map(|i| (i % 7) as u8).collect();
    let saved = a
        .drive
        .write(
            &ann,
            &file.id,
            None,
            Some("application/vnd.suiteleaf.doc+json"),
            &big,
        )
        .unwrap();
    assert!(saved.available);

    sync(&a, &b);
    let listed = b.drive.list(&ann, Some(&folder.id)).unwrap();
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].available);
    assert!(matches!(
        b.drive.read(&ann, &file.id, None),
        Err(DriveError::Unavailable)
    ));
    assert_eq!(b.drive.wanted().len(), 1);

    let hash = b.drive.content_hash(&listed[0], None).unwrap().unwrap();
    assert!(b.drive.fetch(hash, &Direct(a.drive.clone())).await.unwrap());
    let (item, bytes) = b.drive.read(&ann, &file.id, None).unwrap();
    assert_eq!(bytes, big);
    assert!(item.available);
    assert!(b.drive.wanted().is_empty());
}

#[test]
fn moves_rename_and_trash_respect_the_folder_tree() {
    let n = node();
    let ann = user("ann");
    let outer = n.drive.create(&ann, None, "Outer", "folder", None).unwrap();
    let inner = n
        .drive
        .create(&ann, Some(&outer.id), "Inner", "folder", None)
        .unwrap();
    let file = n.drive.create(&ann, None, "a.sldoc", "file", None).unwrap();
    assert!(
        n.drive
            .update(&ann, &outer.id, None, Some(Some(&inner.id)), None)
            .is_err()
    );
    assert!(
        n.drive
            .update(&ann, &outer.id, None, Some(Some(&file.id)), None)
            .is_err()
    );
    assert!(
        n.drive
            .create(&ann, None, "bad/name", "file", None)
            .is_err()
    );
    let moved = n
        .drive
        .update(&ann, &file.id, Some("b.sldoc"), Some(Some(&inner.id)), None)
        .unwrap();
    assert_eq!(
        (moved.name.as_str(), moved.parent_id.as_deref()),
        ("b.sldoc", Some(inner.id.as_str()))
    );
    n.drive
        .update(&ann, &inner.id, None, None, Some(true))
        .unwrap();
    assert!(n.drive.list(&ann, Some(&outer.id)).unwrap().is_empty());
    assert_eq!(n.drive.list(&ann, None).unwrap().len(), 1);
}

#[test]
fn trash_hides_the_file_and_restore_puts_it_back_in_its_folder() {
    let n = node();
    let ann = user("ann");
    let bob = user("bob");
    let folder = n
        .drive
        .create(&ann, None, "Garden club", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&ann, Some(&folder.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    let top = n
        .drive
        .create(&ann, None, "Notes.sldoc", "file", None)
        .unwrap();

    n.drive
        .update(&ann, &file.id, None, None, Some(true))
        .unwrap();
    n.drive
        .update(&ann, &top.id, None, None, Some(true))
        .unwrap();
    assert!(n.drive.list(&ann, Some(&folder.id)).unwrap().is_empty());
    assert!(
        n.drive
            .list(&ann, None)
            .unwrap()
            .iter()
            .all(|item| item.id != file.id && item.id != top.id)
    );

    let trashed = n.drive.list_trashed(&ann).unwrap();
    let rota = trashed.iter().find(|item| item.id == file.id).unwrap();
    assert_eq!(rota.parent_id.as_deref(), Some(folder.id.as_str()));
    assert_eq!(rota.parent_name.as_deref(), Some("Garden club"));
    let notes = trashed.iter().find(|item| item.id == top.id).unwrap();
    assert!(notes.parent_id.is_none());
    assert!(notes.parent_name.is_none());
    assert!(n.drive.list_trashed(&bob).unwrap().is_empty());

    let restored = n
        .drive
        .update(&ann, &file.id, None, None, Some(false))
        .unwrap();
    assert!(!restored.trashed);
    assert_eq!(restored.parent_id.as_deref(), Some(folder.id.as_str()));
    let back = n.drive.list(&ann, Some(&folder.id)).unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].id, file.id);
    assert!(
        n.drive
            .list(&ann, None)
            .unwrap()
            .iter()
            .all(|item| item.id != file.id)
    );
    assert!(
        n.drive
            .list_trashed(&ann)
            .unwrap()
            .iter()
            .all(|item| item.id != file.id)
    );
}

#[test]
fn delete_forever_removes_a_trashed_file_and_its_bytes() {
    let n = node();
    let ann = user("ann");
    let bob = user("bob");
    let folder = n
        .drive
        .create(&ann, None, "Garden club", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&ann, Some(&folder.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    let saved = n
        .drive
        .write(&ann, &file.id, None, None, b"Thursday: Rosa")
        .unwrap();
    let hash: Hash = saved.content_hash.clone().unwrap().parse().unwrap();
    let manifest = Manifest::decode(&n.drive.blobs().get(&hash).unwrap().unwrap()).unwrap();
    n.drive
        .share(&ann, &file.id, "user", "bob", Some(Role::Viewer))
        .unwrap();
    let copy = n.drive.keep_copy(&ann, &file.id).unwrap();

    assert!(matches!(
        n.drive.delete_forever(&ann, &file.id),
        Err(DriveError::BadRequest(_))
    ));
    assert_eq!(n.drive.get(&ann, &file.id).unwrap().id, file.id);

    n.drive
        .update(&ann, &file.id, None, None, Some(true))
        .unwrap();
    assert!(matches!(
        n.drive.delete_forever(&bob, &file.id),
        Err(DriveError::Forbidden)
    ));
    n.drive.delete_forever(&ann, &file.id).unwrap();
    assert!(matches!(
        n.drive.get(&ann, &file.id),
        Err(DriveError::NotFound)
    ));
    assert!(matches!(
        n.drive.get(&ann, &file.id),
        Err(DriveError::NotFound)
    ));
    assert!(
        n.db.query(
            "SELECT id FROM drive_version WHERE itemId = ?1",
            &[Value::Text(file.id.clone())],
        )
        .unwrap()
        .is_empty()
    );
    assert!(
        n.db.query(
            "SELECT id FROM drive_acl WHERE itemId = ?1",
            &[Value::Text(file.id.clone())],
        )
        .unwrap()
        .is_empty()
    );
    let (_, bytes) = n.drive.read(&ann, &copy.id, None).unwrap();
    assert_eq!(bytes, b"Thursday: Rosa");
    assert!(n.drive.blobs().has(&hash));
    for chunk in &manifest.chunks {
        assert!(n.drive.blobs().has(chunk));
    }

    let only = n
        .drive
        .create(&ann, Some(&folder.id), "Only.sldoc", "file", None)
        .unwrap();
    let only_saved = n
        .drive
        .write(&ann, &only.id, None, None, b"unique-bytes-xyz")
        .unwrap();
    let only_hash: Hash = only_saved.content_hash.unwrap().parse().unwrap();
    let only_manifest =
        Manifest::decode(&n.drive.blobs().get(&only_hash).unwrap().unwrap()).unwrap();
    n.drive
        .update(&ann, &only.id, None, None, Some(true))
        .unwrap();
    n.drive.delete_forever(&ann, &only.id).unwrap();
    assert!(!n.drive.blobs().has(&only_hash));
    for chunk in &only_manifest.chunks {
        assert!(
            !n.drive.blobs().has(chunk),
            "delete forever left a chunk behind"
        );
    }
    assert!(n.drive.list(&ann, Some(&folder.id)).unwrap().is_empty());
    assert!(
        n.drive
            .list_trashed(&ann)
            .unwrap()
            .iter()
            .all(|item| item.id != only.id)
    );

    n.drive
        .update(&ann, &folder.id, None, None, Some(true))
        .unwrap();
    let inside = n
        .drive
        .create(&ann, Some(&folder.id), "Still here.sldoc", "file", None)
        .unwrap();
    assert!(matches!(
        n.drive.delete_forever(&ann, &folder.id),
        Err(DriveError::BadRequest(_))
    ));
    assert_eq!(
        n.drive.get(&ann, &inside.id).unwrap().parent_id.as_deref(),
        Some(folder.id.as_str())
    );
}

#[test]
fn trashed_files_stay_listed_after_a_long_time() {
    let n = node();
    let ann = user("ann");
    let folder = n
        .drive
        .create(&ann, None, "Garden club", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&ann, Some(&folder.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .update(&ann, &file.id, None, None, Some(true))
        .unwrap();
    n.db.transact(|tx| {
        tx.upsert(
            "drive_item",
            &file.id,
            [("updatedAt", Value::Text("1999-01-01T00:00:00.000Z".into()))],
        )
    })
    .unwrap();

    let trashed = n.drive.list_trashed(&ann).unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].id, file.id);
    assert_eq!(trashed[0].parent_name.as_deref(), Some("Garden club"));
    assert!(n.drive.list(&ann, Some(&folder.id)).unwrap().is_empty());
}

#[test]
fn list_folders_returns_nested_folders_and_skips_ones_you_cannot_edit() {
    let n = node();
    let ann = user("ann");
    let bob = user("bob");
    let club = n
        .drive
        .create(&ann, None, "Garden club", "folder", None)
        .unwrap();
    let meetings = n
        .drive
        .create(&ann, Some(&club.id), "Meetings", "folder", None)
        .unwrap();
    let rota = n
        .drive
        .create(
            &ann,
            Some(&meetings.id),
            "Watering rota.sldoc",
            "file",
            None,
        )
        .unwrap();
    let secret = n
        .drive
        .create(&bob, None, "Bob's notes", "folder", None)
        .unwrap();
    n.drive
        .share(&bob, &secret.id, "user", "ann", Some(Role::Viewer))
        .unwrap();

    let folders = n.drive.list_folders(&ann).unwrap();
    let club_row = folders.iter().find(|folder| folder.id == club.id).unwrap();
    let meetings_row = folders
        .iter()
        .find(|folder| folder.id == meetings.id)
        .unwrap();
    assert_eq!(club_row.parent_id, None);
    assert_eq!(meetings_row.parent_id.as_deref(), Some(club.id.as_str()));
    assert!(folders.iter().all(|folder| folder.kind == "folder"));
    assert!(folders.iter().all(|folder| folder.id != secret.id));
    assert!(folders.iter().all(|folder| folder.id != rota.id));
    assert_eq!(folders.len(), 2);
    assert_eq!(
        n.drive.get(&ann, &rota.id).unwrap().parent_name.as_deref(),
        Some("Meetings")
    );
}
