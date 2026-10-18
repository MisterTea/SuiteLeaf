use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, SystemTime},
};

use libp2p_identity::ed25519;
use suitedb::{Db, Schema, Value};
use suitedrive::{
    BlobTransport, CHUNK_SIZE, Drive, DriveError, Hash, Manifest, PRESENCE_TTL, Presence,
    Principal, Role, tables,
};
use tempfile::TempDir;

struct Node {
    db: Arc<Db>,
    drive: Arc<Drive>,
    _dir: TempDir,
}

fn node() -> Node {
    let dir = tempfile::tempdir().unwrap();
    let schema = Schema {
        version: 1,
        tables: tables(),
    };
    let db = Arc::new(
        Db::open(
            &dir.path().join("db.sqlite"),
            ed25519::Keypair::generate(),
            schema,
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

fn sync(from: &Node, to: &Node) {
    let ops = from.db.ops_since(None, 0, usize::MAX).unwrap().ops;
    to.db.ingest_many(ops.iter().map(Vec::as_slice)).unwrap();
}

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
fn sharing_is_inherited_by_folder_contents_and_enforced() {
    let n = node();
    let (ann, bob, eve) = (user("ann"), user("bob"), user("eve"));
    let folder = n.drive.create(&ann, None, "Team", "folder", None).unwrap();
    let file = n
        .drive
        .create(&ann, Some(&folder.id), "plan.slsheet", "file", None)
        .unwrap();
    assert!(matches!(
        n.drive.get(&bob, &file.id),
        Err(DriveError::Forbidden)
    ));

    n.drive
        .share(&ann, &folder.id, "user", "bob", Some(Role::Viewer))
        .unwrap();
    assert_eq!(
        n.drive.get(&bob, &file.id).unwrap().role,
        Some(Role::Viewer)
    );
    assert!(matches!(
        n.drive.write(&bob, &file.id, None, None, b"x"),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive
            .share(&bob, &file.id, "user", "eve", Some(Role::Owner)),
        Err(DriveError::Forbidden)
    ));
    assert_eq!(n.drive.shared(&bob).unwrap().len(), 1);

    n.drive
        .share(&ann, &file.id, "user", "bob", Some(Role::Editor))
        .unwrap();
    n.drive
        .write(&bob, &file.id, None, None, b"bob's edit")
        .unwrap();
    assert!(matches!(
        n.drive.list(&eve, Some(&folder.id)),
        Err(DriveError::Forbidden)
    ));
    assert!(n.drive.list(&eve, None).unwrap().is_empty());

    n.drive
        .share(&ann, &folder.id, "user", "bob", None)
        .unwrap();
    assert_eq!(
        n.drive.get(&bob, &file.id).unwrap().role,
        Some(Role::Editor)
    );
    let admin = Principal {
        id: "root".into(),
        admin: true,
    };
    assert_eq!(
        n.drive.get(&admin, &file.id).unwrap().role,
        Some(Role::Owner)
    );
}

#[test]
fn a_commenter_can_comment_but_cannot_change_the_file() {
    let n = node();
    let (ann, bob, eve) = (user("ann"), user("bob"), user("eve"));
    let file = n
        .drive
        .create(&ann, None, "rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&ann, &file.id, "user", "bob", Some(Role::Commenter))
        .unwrap();
    assert_eq!(
        n.drive.get(&bob, &file.id).unwrap().role,
        Some(Role::Commenter)
    );
    assert!(matches!(
        n.drive.write(&bob, &file.id, None, None, b"changed"),
        Err(DriveError::Forbidden)
    ));
    let comment = n
        .drive
        .add_comment(&bob, &file.id, "Can I swap Tuesday?")
        .unwrap();
    assert_eq!(comment.body, "Can I swap Tuesday?");
    assert_eq!(n.drive.comments(&ann, &file.id).unwrap().len(), 1);
    n.drive
        .share(&ann, &file.id, "user", "eve", Some(Role::Viewer))
        .unwrap();
    assert!(matches!(
        n.drive.add_comment(&eve, &file.id, "I can only read"),
        Err(DriveError::Forbidden)
    ));
    assert!(n.drive.add_comment(&bob, &file.id, "  ").is_err());
}

#[test]
fn access_lists_inherited_folder_roles_above_weaker_direct_ones() {
    let n = node();
    let ann = user("ann");
    let folder = n
        .drive
        .create(&ann, None, "Garden club", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&ann, Some(&folder.id), "rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&ann, &file.id, "user", "bob", Some(Role::Viewer))
        .unwrap();
    n.drive
        .share(&ann, &folder.id, "user", "bob", Some(Role::Editor))
        .unwrap();
    let access = n.drive.access(&ann, &file.id).unwrap();
    assert_eq!(access.your_role, Role::Owner);
    assert_eq!(access.parent.as_ref().unwrap().name, "Garden club");
    let bob_grant = access
        .grants
        .iter()
        .find(|g| g.principal_id == "bob")
        .unwrap();
    assert_eq!(bob_grant.role, Role::Editor);
    assert_eq!(
        bob_grant.inherited_from.as_ref().unwrap().name,
        "Garden club"
    );
    assert!(access.grants.iter().any(|g| {
        g.principal_type == "owner" && g.principal_id == "ann" && g.inherited_from.is_none()
    }));
    n.drive.share(&ann, &file.id, "user", "bob", None).unwrap();
    let only_folder = n.drive.access(&ann, &file.id).unwrap();
    assert_eq!(
        only_folder
            .grants
            .iter()
            .find(|g| g.principal_id == "bob")
            .unwrap()
            .role,
        Role::Editor
    );
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
fn sharing_notifies_in_the_app_and_keep_copy_is_owned() {
    let n = node();
    let (rosa, sam) = (user("rosa"), user("sam"));
    let folder = n.drive.create(&rosa, None, "Club", "folder", None).unwrap();
    let file = n
        .drive
        .create(
            &rosa,
            Some(&folder.id),
            "Plot assignments.slsheet",
            "file",
            None,
        )
        .unwrap();
    let bytes = b"plot-bytes-v1";
    n.drive.write(&rosa, &file.id, None, None, bytes).unwrap();
    assert!(n.drive.notices(&sam).unwrap().is_empty());

    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Viewer))
        .unwrap();
    let notes = n.drive.notices(&sam).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].item_name, "Plot assignments.slsheet");
    assert_eq!(notes[0].sharer_id, "rosa");
    assert_eq!(notes[0].role, Role::Viewer);
    assert!(n.drive.notices(&rosa).unwrap().is_empty());
    assert!(matches!(
        n.drive.dismiss_notice(&rosa, &notes[0].id),
        Err(DriveError::Forbidden)
    ));
    n.drive.dismiss_notice(&sam, &notes[0].id).unwrap();
    assert!(n.drive.notices(&sam).unwrap().is_empty());
    assert_eq!(n.drive.shared(&sam).unwrap().len(), 1);
    n.drive.dismiss_notice(&sam, &notes[0].id).unwrap();

    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let again = n.drive.notices(&sam).unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].role, Role::Editor);
    assert_ne!(again[0].id, notes[0].id);

    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Viewer))
        .unwrap();
    assert!(matches!(
        n.drive
            .create(&sam, Some(&folder.id), "nope.slsheet", "file", None),
        Err(DriveError::Forbidden)
    ));
    n.drive
        .share(&rosa, &folder.id, "user", "sam", Some(Role::Viewer))
        .unwrap();
    assert!(matches!(
        n.drive.keep_copy(&sam, &folder.id),
        Err(DriveError::BadRequest(_))
    ));
    n.drive
        .share(&rosa, &folder.id, "user", "sam", None)
        .unwrap();
    let copy = n.drive.keep_copy(&sam, &file.id).unwrap();
    assert_eq!(copy.owner_id, "sam");
    assert_eq!(copy.role, Some(Role::Owner));
    assert_eq!(copy.parent_id, None);
    assert_eq!(copy.name, file.name);
    assert_eq!(n.drive.read(&sam, &copy.id, None).unwrap().1, bytes);
    assert_eq!(n.drive.read(&rosa, &file.id, None).unwrap().1, bytes);
    assert!(matches!(
        n.drive.get(&rosa, &copy.id),
        Err(DriveError::Forbidden)
    ));
    assert_eq!(n.drive.shared(&sam).unwrap().len(), 1);
    n.drive
        .write(
            &sam,
            &copy.id,
            copy.head_version_id.as_deref(),
            None,
            b"sam-notes",
        )
        .unwrap();
    assert_eq!(n.drive.read(&rosa, &file.id, None).unwrap().1, bytes);

    n.drive.share(&rosa, &file.id, "user", "sam", None).unwrap();
    assert!(n.drive.notices(&sam).unwrap().is_empty());
    assert!(n.drive.shared(&sam).unwrap().is_empty());
    assert!(matches!(
        n.drive.get(&sam, &file.id),
        Err(DriveError::Forbidden)
    ));
    assert_eq!(n.drive.read(&sam, &copy.id, None).unwrap().1, b"sam-notes");
    assert_eq!(n.drive.list(&sam, None).unwrap().len(), 1);

    n.drive
        .share(&rosa, &file.id, "org", "club", Some(Role::Viewer))
        .unwrap();
    assert!(n.drive.notices(&sam).unwrap().is_empty());
    n.drive
        .share(&rosa, &file.id, "user", "rosa", Some(Role::Editor))
        .unwrap();
    assert!(n.drive.notices(&rosa).unwrap().is_empty());
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

#[test]
fn ownership_moves_immediately_and_a_share_can_expire() {
    let (a, b) = (node(), node());
    let (rosa, sam, priya, eve) = (user("rosa"), user("sam"), user("priya"), user("eve"));
    let file = a
        .drive
        .create(&rosa, None, "Watering rota.sldoc", "file", None)
        .unwrap();
    a.drive
        .write(&rosa, &file.id, None, None, b"Monday: Rosa")
        .unwrap();
    a.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    a.drive
        .share(&rosa, &file.id, "user", "priya", Some(Role::Commenter))
        .unwrap();
    a.drive
        .share(&rosa, &file.id, "user", "eve", Some(Role::Viewer))
        .unwrap();

    let saturday = "2099-01-03T00:00:00.000Z";
    for person in ["priya", "eve", "sam"] {
        a.drive
            .set_expiry(&rosa, &file.id, "user", person, Some(saturday))
            .unwrap();
    }
    assert!(
        a.drive
            .set_expiry(&rosa, &file.id, "user", "rosa", Some(saturday))
            .is_err()
    );
    assert!(
        a.drive
            .set_expiry(&rosa, &file.id, "user", "priya", Some("next saturday"))
            .is_err()
    );
    // A role change keeps the end date.
    a.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let before = a.drive.access(&rosa, &file.id).unwrap();
    let sam_grant = before
        .grants
        .iter()
        .find(|g| g.principal_id == "sam")
        .unwrap();
    assert_eq!(sam_grant.role, Role::Editor);
    assert_eq!(sam_grant.expires_at.as_deref(), Some(saturday));
    assert!(!sam_grant.expired);
    assert!(matches!(
        a.drive.transfer(&sam, &file.id, "priya"),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        a.drive
            .set_expiry(&sam, &file.id, "user", "priya", Some(saturday)),
        Err(DriveError::Forbidden)
    ));

    assert_eq!(
        a.drive.get(&priya, &file.id).unwrap().role,
        Some(Role::Commenter)
    );
    a.drive
        .add_comment(&priya, &file.id, "I can cover Wednesday.")
        .unwrap();
    assert!(matches!(
        a.drive.write(&priya, &file.id, None, None, b"no"),
        Err(DriveError::Forbidden)
    ));
    assert_eq!(
        a.drive.get(&eve, &file.id).unwrap().role,
        Some(Role::Viewer)
    );
    assert!(matches!(
        a.drive.add_comment(&eve, &file.id, "no"),
        Err(DriveError::Forbidden)
    ));
    assert_eq!(a.drive.shared(&priya).unwrap().len(), 1);
    assert_eq!(
        a.drive.get(&sam, &file.id).unwrap().role,
        Some(Role::Editor)
    );

    let handed = a.drive.transfer(&rosa, &file.id, "sam").unwrap();
    assert_eq!(handed.owner_id, "sam");
    assert_eq!(handed.role, Some(Role::Editor));
    assert_eq!(a.drive.get(&sam, &file.id).unwrap().role, Some(Role::Owner));
    a.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            b"Monday: Rosa. Sunday: rotate.",
        )
        .unwrap();
    let after = a.drive.access(&sam, &file.id).unwrap();
    assert_eq!(after.your_role, Role::Owner);
    let rosa_grant = after
        .grants
        .iter()
        .find(|g| g.principal_id == "rosa")
        .unwrap();
    assert_eq!(rosa_grant.role, Role::Editor);
    assert!(rosa_grant.expires_at.is_none());
    assert!(
        after
            .grants
            .iter()
            .any(|g| g.principal_type == "owner" && g.principal_id == "sam")
    );
    assert_eq!(
        after
            .grants
            .iter()
            .find(|g| g.principal_id == "priya")
            .unwrap()
            .expires_at
            .as_deref(),
        Some(saturday)
    );
    assert!(matches!(
        a.drive.transfer(&rosa, &file.id, "priya"),
        Err(DriveError::Forbidden)
    ));
    assert!(
        a.drive
            .share(&sam, &file.id, "user", "eve", Some(Role::Owner))
            .is_err()
    );
    assert!(
        a.drive
            .set_expiry(&sam, &file.id, "user", "sam", Some(saturday))
            .is_err()
    );

    let ended = "2000-01-01T00:00:00.000Z";
    a.drive
        .set_expiry(&sam, &file.id, "user", "priya", Some(ended))
        .unwrap();
    a.drive
        .set_expiry(&sam, &file.id, "user", "eve", Some(ended))
        .unwrap();
    assert!(matches!(
        a.drive.get(&priya, &file.id),
        Err(DriveError::Forbidden)
    ));
    assert!(a.drive.shared(&priya).unwrap().is_empty());
    assert!(matches!(
        a.drive.read(&priya, &file.id, None),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        a.drive.get(&eve, &file.id),
        Err(DriveError::Forbidden)
    ));
    let priya_ended = a
        .drive
        .access(&sam, &file.id)
        .unwrap()
        .grants
        .into_iter()
        .find(|g| g.principal_id == "priya")
        .unwrap();
    assert!(priya_ended.expired);
    assert_eq!(priya_ended.role, Role::Commenter);

    a.drive.share(&sam, &file.id, "user", "eve", None).unwrap();
    a.drive
        .share(&sam, &file.id, "user", "eve", Some(Role::Editor))
        .unwrap();
    assert_eq!(
        a.drive.get(&eve, &file.id).unwrap().role,
        Some(Role::Editor)
    );
    a.drive
        .set_expiry(&sam, &file.id, "user", "eve", Some(ended))
        .unwrap();
    assert!(matches!(
        a.drive.write(&eve, &file.id, None, None, b"x"),
        Err(DriveError::Forbidden)
    ));

    sync(&a, &b);
    let remote = b.drive.access(&sam, &file.id).unwrap();
    assert_eq!(remote.your_role, Role::Owner);
    assert_eq!(
        remote
            .grants
            .iter()
            .find(|g| g.principal_id == "rosa")
            .unwrap()
            .role,
        Role::Editor
    );
    let remote_priya = remote
        .grants
        .iter()
        .find(|g| g.principal_id == "priya")
        .unwrap();
    assert!(remote_priya.expired);
    assert_eq!(remote_priya.expires_at.as_deref(), Some(ended));
    assert!(b.drive.shared(&priya).unwrap().is_empty());
    assert_eq!(b.drive.get(&sam, &file.id).unwrap().owner_id, "sam");
    assert_eq!(
        b.drive.get(&rosa, &file.id).unwrap().role,
        Some(Role::Editor)
    );
}

fn form_bytes(prompt: &str, responses: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "content": {
            "questions": [{
                "id": "name",
                "prompt": prompt,
                "kind": "text",
                "required": true
            }],
            "responses": responses
        }
    }))
    .unwrap()
}

#[test]
fn a_responder_can_append_a_form_response_but_cannot_change_the_questions() {
    let n = node();
    let (rosa, sam, ed, commenter, viewer) = (
        user("rosa"),
        user("sam"),
        user("ed"),
        user("commenter"),
        user("viewer"),
    );
    let file = n
        .drive
        .create(
            &rosa,
            None,
            "Plot sign-ups.slform",
            "file",
            Some("application/vnd.suiteleaf.form+json"),
        )
        .unwrap();
    let empty = form_bytes("Your name", serde_json::json!([]));
    n.drive.write(&rosa, &file.id, None, None, &empty).unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Responder))
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "ed", Some(Role::Editor))
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "commenter", Some(Role::Commenter))
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "viewer", Some(Role::Viewer))
        .unwrap();
    assert_eq!(
        n.drive.get(&sam, &file.id).unwrap().role,
        Some(Role::Responder)
    );

    let one = form_bytes(
        "Your name",
        serde_json::json!([{ "id": "r1", "answers": { "name": "Sam", "plot": "Medium" } }]),
    );
    assert!(matches!(
        n.drive.write(&commenter, &file.id, None, None, &one),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive.write(&viewer, &file.id, None, None, &one),
        Err(DriveError::Forbidden)
    ));
    n.drive.write(&sam, &file.id, None, None, &one).unwrap();
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["responses"][0]["answers"]["name"], "Sam");
    assert_eq!(saved["content"]["questions"][0]["prompt"], "Your name");

    let two = form_bytes(
        "Your name",
        serde_json::json!([
            { "id": "r1", "answers": { "name": "Sam", "plot": "Medium" } },
            { "id": "r2", "answers": { "name": "Leo", "plot": "Small" } }
        ]),
    );
    n.drive.write(&sam, &file.id, None, None, &two).unwrap();

    let edited = form_bytes(
        "Your name",
        serde_json::json!([
            { "id": "r1", "answers": { "name": "Samuel", "plot": "Medium" } },
            { "id": "r2", "answers": { "name": "Leo", "plot": "Small" } }
        ]),
    );
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, None, &edited),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, None, &one),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, None, &two),
        Err(DriveError::Forbidden)
    ));

    let renamed = form_bytes(
        "Your full name",
        serde_json::json!([
            { "id": "r1", "answers": { "name": "Sam", "plot": "Medium" } },
            { "id": "r2", "answers": { "name": "Leo", "plot": "Small" } }
        ]),
    );
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, None, &renamed),
        Err(DriveError::Forbidden)
    ));

    let notes = n
        .drive
        .create(&rosa, None, "Notes.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&rosa, &notes.id, None, None, b"hello")
        .unwrap();
    n.drive
        .share(&rosa, &notes.id, "user", "sam", Some(Role::Responder))
        .unwrap();
    assert!(matches!(
        n.drive.write(&sam, &notes.id, None, None, b"changed"),
        Err(DriveError::Forbidden)
    ));

    n.drive.write(&ed, &file.id, None, None, &renamed).unwrap();
    let (_, after) = n.drive.read(&rosa, &file.id, None).unwrap();
    let after: serde_json::Value = serde_json::from_slice(&after).unwrap();
    assert_eq!(after["content"]["questions"][0]["prompt"], "Your full name");
    assert_eq!(after["content"]["responses"][0]["answers"]["name"], "Sam");
}

fn plot_form(responses: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "format": "suiteleaf",
        "version": 1,
        "id": "form-1",
        "title": "Plot sign-ups",
        "kind": "form",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "content": {
            "questions": [
                { "id": "name", "prompt": "Your name", "kind": "text", "required": true },
                {
                    "id": "plot",
                    "prompt": "Plot size",
                    "kind": "choice",
                    "required": true,
                    "choices": ["Small", "Medium", "Large"]
                },
                { "id": "notes", "prompt": "Notes", "kind": "text", "required": false }
            ],
            "responses": responses
        }
    }))
    .unwrap()
}

fn answer_map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

#[test]
fn a_sign_up_link_adds_one_response_and_can_be_turned_off() {
    let n = node();
    let (rosa, sam, ed, viewer) = (user("rosa"), user("sam"), user("ed"), user("viewer"));
    let file = n
        .drive
        .create(
            &rosa,
            None,
            "Plot sign-ups.slform",
            "file",
            Some("application/vnd.suiteleaf.form+json"),
        )
        .unwrap();
    let seeded = plot_form(serde_json::json!([{
        "id": "r0",
        "at": "2026-01-02T00:00:00.000Z",
        "answers": { "name": "Hidden neighbor", "plot": "Small" }
    }]));
    n.drive.write(&rosa, &file.id, None, None, &seeded).unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Responder))
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "ed", Some(Role::Editor))
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "viewer", Some(Role::Viewer))
        .unwrap();

    let notes = n
        .drive
        .create(&rosa, None, "Notes.sldoc", "file", None)
        .unwrap();
    assert!(matches!(
        n.drive.create_respond_link(&rosa, &notes.id),
        Err(DriveError::BadRequest(_))
    ));
    assert!(matches!(
        n.drive.create_respond_link(&sam, &file.id),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive.create_respond_link(&viewer, &file.id),
        Err(DriveError::Forbidden)
    ));

    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    assert_eq!(token.len(), 36);
    assert_eq!(token.matches('-').count(), 4);
    assert_eq!(
        n.drive.create_respond_link(&ed, &file.id).unwrap(),
        token,
        "creating again returns the same token"
    );

    let public = n.drive.public_form(&token).unwrap();
    let json = serde_json::to_value(&public).unwrap();
    assert!(json.get("responses").is_none());
    assert!(json.get("acl").is_none());
    assert_eq!(json["title"], "Plot sign-ups");
    assert_eq!(json["questions"].as_array().unwrap().len(), 3);
    let text = serde_json::to_string(&json).unwrap();
    assert!(!text.contains("Hidden neighbor"));
    assert!(!text.contains(&file.id));
    assert!(!text.contains("rosa"));

    n.drive
        .submit_public_response(&token, &answer_map(&[("name", "Alex"), ("plot", "Large")]))
        .unwrap();
    n.drive
        .submit_public_response(
            &token,
            &answer_map(&[("name", "Sam"), ("plot", "Small"), ("notes", "  ")]),
        )
        .unwrap();
    assert!(matches!(
        n.drive
            .submit_public_response(&token, &answer_map(&[("name", "Leo"), ("plot", "Huge")])),
        Err(DriveError::BadRequest(_))
    ));
    assert!(matches!(
        n.drive.submit_public_response(&token, &answer_map(&[("plot", "Medium")])),
        Err(DriveError::BadRequest(message)) if message == "Your name is required"
    ));

    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["questions"][0]["prompt"], "Your name");
    assert_eq!(saved["content"]["questions"][1]["choices"][2], "Large");
    let rows = saved["content"]["responses"].as_array().unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["answers"]["name"], "Hidden neighbor");
    assert_eq!(rows[1]["answers"]["name"], "Alex");
    assert_eq!(rows[1]["answers"]["plot"], "Large");
    assert_eq!(rows[2]["answers"]["name"], "Sam");
    assert!(rows[2]["answers"].get("notes").is_none());

    n.drive.clear_respond_link(&ed, &file.id).unwrap();
    assert!(matches!(
        n.drive.public_form(&token),
        Err(DriveError::NotFound)
    ));
    assert!(matches!(
        n.drive
            .submit_public_response(&token, &answer_map(&[("name", "Nia"), ("plot", "Medium")])),
        Err(DriveError::NotFound)
    ));
    let (_, after) = n.drive.read(&rosa, &file.id, None).unwrap();
    let after: serde_json::Value = serde_json::from_slice(&after).unwrap();
    assert_eq!(after["content"]["responses"].as_array().unwrap().len(), 3);
    assert_eq!(after["content"]["responses"][1]["answers"]["name"], "Alex");
    assert_eq!(after["content"]["questions"][0]["prompt"], "Your name");

    let again = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    assert_ne!(again, token);
}

#[test]
fn a_sign_up_link_stores_a_rating() {
    let n = node();
    let rosa = user("rosa");
    let file = n
        .drive
        .create(
            &rosa,
            None,
            "Talk feedback.slform",
            "file",
            Some("application/vnd.suiteleaf.form+json"),
        )
        .unwrap();
    let seeded = serde_json::to_vec(&serde_json::json!({
        "format": "suiteleaf",
        "version": 1,
        "id": "form-rating",
        "title": "Talk feedback",
        "kind": "form",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "content": {
            "questions": [
                { "id": "name", "prompt": "Your name", "kind": "text", "required": true },
                { "id": "talk", "prompt": "How was the talk?", "kind": "rating", "required": true },
                {
                    "id": "plot",
                    "prompt": "Plot size",
                    "kind": "choice",
                    "required": false,
                    "choices": ["Small", "Large"]
                }
            ],
            "responses": []
        }
    }))
    .unwrap();
    n.drive.write(&rosa, &file.id, None, None, &seeded).unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let public = serde_json::to_value(n.drive.public_form(&token).unwrap()).unwrap();
    assert_eq!(public["questions"][0]["kind"], "text");
    assert_eq!(public["questions"][1]["kind"], "rating");
    assert!(public["questions"][1].get("choices").is_none());
    assert_eq!(public["questions"][2]["kind"], "choice");

    assert!(matches!(
        n.drive.submit_public_response(&token, &answer_map(&[("name", "Rosa")])),
        Err(DriveError::BadRequest(message)) if message == "How was the talk? is required"
    ));
    assert!(matches!(
        n.drive.submit_public_response(
            &token,
            &answer_map(&[("name", "Rosa"), ("talk", "6"), ("plot", "Small")]),
        ),
        Err(DriveError::BadRequest(message)) if message == "How was the talk? must be a rating from 1 to 5"
    ));
    n.drive
        .submit_public_response(
            &token,
            &answer_map(&[("name", "Rosa"), ("talk", "4"), ("plot", "Large")]),
        )
        .unwrap();

    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["questions"][1]["kind"], "rating");
    assert_eq!(saved["content"]["responses"].as_array().unwrap().len(), 1);
    assert_eq!(saved["content"]["responses"][0]["answers"]["name"], "Rosa");
    assert_eq!(saved["content"]["responses"][0]["answers"]["talk"], "4");
    assert_eq!(saved["content"]["responses"][0]["answers"]["plot"], "Large");
}

#[test]
fn a_sign_up_link_stores_a_grid() {
    let n = node();
    let rosa = user("rosa");
    let file = n
        .drive
        .create(
            &rosa,
            None,
            "Day grid.slform",
            "file",
            Some("application/vnd.suiteleaf.form+json"),
        )
        .unwrap();
    let seeded = serde_json::to_vec(&serde_json::json!({
        "format": "suiteleaf",
        "version": 1,
        "id": "form-grid",
        "title": "Day grid",
        "kind": "form",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "content": {
            "questions": [
                { "id": "name", "prompt": "Your name", "kind": "text", "required": true },
                {
                    "id": "days",
                    "prompt": "Which days?",
                    "kind": "grid",
                    "required": true,
                    "rows": ["Mon", "Tue"],
                    "columns": ["Yes", "No"]
                },
                { "id": "talk", "prompt": "How was the talk?", "kind": "rating", "required": false },
                {
                    "id": "plot",
                    "prompt": "Plot size",
                    "kind": "choice",
                    "required": false,
                    "choices": ["Small", "Large"]
                }
            ],
            "responses": []
        }
    }))
    .unwrap();
    n.drive.write(&rosa, &file.id, None, None, &seeded).unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let public = serde_json::to_value(n.drive.public_form(&token).unwrap()).unwrap();
    assert!(public.get("responses").is_none());
    assert_eq!(public["questions"][0]["kind"], "text");
    assert_eq!(public["questions"][1]["kind"], "grid");
    assert_eq!(public["questions"][1]["rows"][0], "Mon");
    assert_eq!(public["questions"][1]["rows"][1], "Tue");
    assert_eq!(public["questions"][1]["columns"][0], "Yes");
    assert_eq!(public["questions"][1]["columns"][1], "No");
    assert!(public["questions"][1].get("choices").is_none());
    assert_eq!(public["questions"][2]["kind"], "rating");
    assert!(public["questions"][2].get("rows").is_none());
    assert_eq!(public["questions"][3]["kind"], "choice");

    let days = r#"{"Mon":"Yes","Tue":"No"}"#;
    assert!(matches!(
        n.drive.submit_public_response(&token, &answer_map(&[("name", "Rosa")])),
        Err(DriveError::BadRequest(message)) if message == "Which days? is required"
    ));
    assert!(matches!(
        n.drive.submit_public_response(
            &token,
            &answer_map(&[("name", "Rosa"), ("days", r#"{"Mon":"Yes"}"#)]),
        ),
        Err(DriveError::BadRequest(message)) if message == "Which days? is required"
    ));
    assert!(matches!(
        n.drive.submit_public_response(
            &token,
            &answer_map(&[("name", "Rosa"), ("days", r#"{"Mon":"Maybe","Tue":"No"}"#)]),
        ),
        Err(DriveError::BadRequest(message)) if message == "Which days? must be one of the columns"
    ));
    assert!(matches!(
        n.drive.submit_public_response(
            &token,
            &answer_map(&[("name", "Rosa"), ("days", r#"{"Mon":"Yes","Tue":"No","Wed":"Yes"}"#)]),
        ),
        Err(DriveError::BadRequest(message)) if message == "Which days? must be one of the columns"
    ));
    assert!(matches!(
        n.drive.submit_public_response(
            &token,
            &answer_map(&[("name", "Rosa"), ("days", days), ("talk", "6"), ("plot", "Small")]),
        ),
        Err(DriveError::BadRequest(message)) if message == "How was the talk? must be a rating from 1 to 5"
    ));
    n.drive
        .submit_public_response(
            &token,
            &answer_map(&[
                ("name", "Rosa"),
                ("days", days),
                ("talk", "4"),
                ("plot", "Large"),
            ]),
        )
        .unwrap();

    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["questions"][1]["kind"], "grid");
    assert_eq!(saved["content"]["questions"][1]["rows"][0], "Mon");
    assert_eq!(saved["content"]["questions"][1]["columns"][1], "No");
    assert_eq!(saved["content"]["responses"].as_array().unwrap().len(), 1);
    let stored = saved["content"]["responses"][0]["answers"]["days"]
        .as_str()
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(stored).unwrap();
    assert_eq!(parsed["Mon"], "Yes");
    assert_eq!(parsed["Tue"], "No");
    assert!(parsed.get("Wed").is_none());
    assert_eq!(saved["content"]["responses"][0]["answers"]["name"], "Rosa");
    assert_eq!(saved["content"]["responses"][0]["answers"]["talk"], "4");
    assert_eq!(saved["content"]["responses"][0]["answers"]["plot"], "Large");
}

#[test]
fn a_valid_grid_longer_than_a_text_answer_is_accepted() {
    let n = node();
    let rosa = user("rosa");
    let file = n
        .drive
        .create(
            &rosa,
            None,
            "Long grid.slform",
            "file",
            Some("application/vnd.suiteleaf.form+json"),
        )
        .unwrap();
    let row = |index: usize| format!("{index:02}{}", "r".repeat(78));
    let column = "c".repeat(80);
    let rows: Vec<String> = (0..20).map(row).collect();
    let seeded = serde_json::json!({
        "format": "suiteleaf",
        "version": 1,
        "id": "form-long-grid",
        "title": "Long grid",
        "kind": "form",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "content": {
            "questions": [
                {
                    "id": "days",
                    "prompt": "Which days?",
                    "kind": "grid",
                    "required": true,
                    "rows": rows.clone(),
                    "columns": [column.clone()]
                },
                { "id": "notes", "prompt": "Notes", "kind": "text", "required": false }
            ],
            "responses": []
        }
    });
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            &serde_json::to_vec(&seeded).unwrap(),
        )
        .unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let mut chosen = serde_json::Map::new();
    for label in &rows {
        chosen.insert(label.clone(), serde_json::Value::String(column.clone()));
    }
    let days = serde_json::Value::Object(chosen).to_string();
    assert!(days.chars().count() > 2000);
    n.drive
        .submit_public_response(&token, &answer_map(&[("days", &days)]))
        .unwrap();

    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    let stored = saved["content"]["responses"][0]["answers"]["days"]
        .as_str()
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_str(stored).unwrap();
    assert_eq!(parsed[&rows[0]], column);
    assert_eq!(parsed[&rows[19]], column);

    let huge = "x".repeat(40_000);
    assert!(matches!(
        n.drive
            .submit_public_response(&token, &answer_map(&[("days", &huge)])),
        Err(DriveError::BadRequest(message)) if message == "Which days? is too long"
    ));
    let notes = "n".repeat(2_001);
    assert!(matches!(
        n.drive.submit_public_response(
            &token,
            &answer_map(&[("days", &days), ("notes", &notes)]),
        ),
        Err(DriveError::BadRequest(message)) if message == "Notes is too long"
    ));
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

#[test]
fn search_finds_a_document_by_the_words_inside_it() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let club = n
        .drive
        .create(&rosa, None, "Garden club", "folder", None)
        .unwrap();
    n.drive
        .create(&rosa, None, "Thursday plans", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&club.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    let body = serde_json::json!({
        "kind": "doc",
        "content": {
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "text": "Thursday: ask Alex to cover. The beds along the south fence need an extra bucket when the week stays hot."
                }]
            }]
        }
    });
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            Some("application/vnd.suiteleaf.doc+json"),
            &serde_json::to_vec(&body).unwrap(),
        )
        .unwrap();

    assert!(n.drive.search(&rosa, "  ").unwrap().is_empty());
    let hits = n.drive.search(&rosa, "Thursday").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, file.id);
    assert_eq!(hits[0].name, "Watering rota.sldoc");
    assert_eq!(hits[0].parent_name, "Garden club");
    assert!(hits[0].snippet.contains("Thursday"));
    assert!(hits[0].snippet.contains("ask Alex"));
    assert!(hits[0].snippet.chars().count() <= 80);
    let listed = serde_json::to_value(&hits[0]).unwrap();
    assert!(listed.get("snippet").is_some());
    assert!(listed.get("bytes").is_none());
    assert!(listed.get("content").is_none());

    let lower = n.drive.search(&rosa, "thursday").unwrap();
    assert_eq!(lower.len(), 1);
    assert_eq!(lower[0].id, file.id);
    assert!(lower[0].snippet.contains("Thursday"));

    assert!(n.drive.search(&rosa, "zucchini").unwrap().is_empty());
    assert!(n.drive.search(&sam, "Thursday").unwrap().is_empty());
    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Viewer))
        .unwrap();
    let shared = n.drive.search(&sam, "Thursday").unwrap();
    assert_eq!(shared.len(), 1);
    assert_eq!(shared[0].id, file.id);
    assert_eq!(shared[0].parent_name, "Garden club");

    n.drive
        .update(&rosa, &file.id, None, None, Some(true))
        .unwrap();
    assert!(n.drive.search(&rosa, "Thursday").unwrap().is_empty());
    assert!(n.drive.search(&sam, "Thursday").unwrap().is_empty());
}

#[test]
fn search_reads_sheet_slide_and_form_text_and_a_file_name() {
    let n = node();
    let rosa = user("rosa");
    let sheet = n
        .drive
        .create(&rosa, None, "Beds.slsheet", "file", None)
        .unwrap();
    n.drive
        .write(
            &rosa,
            &sheet.id,
            None,
            None,
            &serde_json::to_vec(&serde_json::json!({
                "kind": "sheet",
                "content": {
                    "workbook": {
                        "sheets": {
                            "s1": {
                                "cellData": {
                                    "0": {
                                        "0": { "v": "Hose bib" },
                                        "1": { "v": 3, "f": "=SUM(A1)" }
                                    }
                                }
                            }
                        }
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();
    let deck = n
        .drive
        .create(&rosa, None, "Club night.slslides", "file", None)
        .unwrap();
    n.drive
        .write(
            &rosa,
            &deck.id,
            None,
            None,
            &serde_json::to_vec(&serde_json::json!({
                "kind": "slide",
                "content": {
                    "slides": {
                        "a": {
                            "elements": [{
                                "content": "Welcome plot holders",
                                "rows": [["North bed"]]
                            }],
                            "notes": "Bring the shed key"
                        }
                    }
                }
            }))
            .unwrap(),
        )
        .unwrap();
    let form = n
        .drive
        .create(&rosa, None, "Sign up.slform", "file", None)
        .unwrap();
    n.drive
        .write(
            &rosa,
            &form.id,
            None,
            None,
            &serde_json::to_vec(&serde_json::json!({
                "kind": "form",
                "content": {
                    "questions": [{
                        "prompt": "Which plot",
                        "choices": ["Large bed", "Small bed"]
                    }],
                    "responses": [{
                        "answers": { "q1": "Alex covers the gate" }
                    }]
                }
            }))
            .unwrap(),
        )
        .unwrap();
    let named = n
        .drive
        .create(&rosa, None, "Pump schedule.sldoc", "file", None)
        .unwrap();

    let hose = n.drive.search(&rosa, "Hose").unwrap();
    assert_eq!(hose.len(), 1);
    assert_eq!(hose[0].id, sheet.id);
    assert_eq!(hose[0].parent_name, "My Drive");
    assert!(hose[0].snippet.contains("Hose"));
    assert!(n.drive.search(&rosa, "SUM").unwrap().is_empty());

    let notes = n.drive.search(&rosa, "shed").unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, deck.id);
    assert!(notes[0].snippet.contains("shed"));
    let table = n.drive.search(&rosa, "North").unwrap();
    assert_eq!(table.len(), 1);
    assert_eq!(table[0].id, deck.id);

    let prompt = n.drive.search(&rosa, "Which plot").unwrap();
    assert_eq!(prompt.len(), 1);
    assert_eq!(prompt[0].id, form.id);
    let choice = n.drive.search(&rosa, "Large").unwrap();
    assert_eq!(choice.len(), 1);
    assert_eq!(choice[0].id, form.id);
    let answer = n.drive.search(&rosa, "gate").unwrap();
    assert_eq!(answer.len(), 1);
    assert_eq!(answer[0].id, form.id);

    let by_name = n.drive.search(&rosa, "Pump").unwrap();
    assert_eq!(by_name.len(), 1);
    assert_eq!(by_name[0].id, named.id);
    assert_eq!(by_name[0].parent_name, "My Drive");
    assert!(by_name[0].snippet.contains("Pump"));
    assert!(by_name[0].snippet.chars().count() <= 80);
}

#[test]
fn search_reads_every_document_tab_and_names_it() {
    let n = node();
    let rosa = user("rosa");
    let meeting = n
        .drive
        .create(&rosa, None, "October meeting.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(
            &rosa,
            &meeting.id,
            None,
            Some("application/vnd.suiteleaf.doc+json"),
            &serde_json::to_vec(&serde_json::json!({
                "kind": "doc",
                "tabTitle": "Agenda",
                "content": {
                    "type": "doc",
                    "content": [{
                        "type": "paragraph",
                        "content": [{
                            "type": "text",
                            "text": "Call to order. Treasurer's report."
                        }]
                    }]
                },
                "tabs": [{
                    "id": "minutes",
                    "title": "Minutes",
                    "content": {
                        "type": "doc",
                        "content": [{
                            "type": "paragraph",
                            "content": [{
                                "type": "text",
                                "text": "Voted to buy compost."
                            }]
                        }]
                    }
                }]
            }))
            .unwrap(),
        )
        .unwrap();

    let compost = n.drive.search(&rosa, "compost").unwrap();
    assert_eq!(compost.len(), 1);
    assert_eq!(compost[0].id, meeting.id);
    assert!(compost[0].snippet.starts_with("Minutes:"));
    assert!(compost[0].snippet.contains("Voted to buy compost."));
    assert!(compost[0].snippet.chars().count() <= 80);

    let order = n.drive.search(&rosa, "order").unwrap();
    assert_eq!(order.len(), 1);
    assert!(order[0].snippet.starts_with("Agenda:"));
    assert!(order[0].snippet.contains("Call to order."));

    let old = n
        .drive
        .create(&rosa, None, "Old notes.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(
            &rosa,
            &old.id,
            None,
            Some("application/vnd.suiteleaf.doc+json"),
            &serde_json::to_vec(&serde_json::json!({
                "kind": "doc",
                "content": {
                    "type": "doc",
                    "content": [{
                        "type": "paragraph",
                        "content": [{
                            "type": "text",
                            "text": "Bring the hose."
                        }]
                    }]
                }
            }))
            .unwrap(),
        )
        .unwrap();
    let hose = n.drive.search(&rosa, "hose").unwrap();
    assert_eq!(hose.len(), 1);
    assert_eq!(hose[0].id, old.id);
    assert!(hose[0].snippet.contains("Bring the hose."));
    assert!(!hose[0].snippet.starts_with("Document:"));
}

#[test]
fn presence_names_other_people_and_drops_stale_beats() {
    let n = node();
    let sam = user("sam");
    let jordan = user("jordan");
    let casey = user("casey");
    let file = n
        .drive
        .create(&sam, None, "Bake sale flyer.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&sam, &file.id, "user", "jordan", Some(Role::Viewer))
        .unwrap();
    n.drive
        .share(&sam, &file.id, "user", "casey", Some(Role::Commenter))
        .unwrap();
    let now = SystemTime::now();

    n.drive
        .report_presence(&jordan, &file.id, "Jordan", false, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Jordan".into(),
            editing: false,
        }]
    );

    n.drive
        .report_presence(&sam, &file.id, "Sam Okafor", true, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Jordan".into(),
            editing: false,
        }],
        "Sam does not see himself"
    );
    assert_eq!(
        n.drive.presence(&jordan, &file.id, now).unwrap(),
        vec![Presence {
            name: "Sam Okafor".into(),
            editing: true,
        }]
    );

    n.drive
        .report_presence(&jordan, &file.id, "Jordan", true, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Jordan".into(),
            editing: true,
        }]
    );
    assert!(
        matches!(
            n.drive.write(&jordan, &file.id, None, None, b"changed"),
            Err(DriveError::Forbidden)
        ),
        "an editing beat does not let a viewer write"
    );

    n.drive
        .report_presence(&casey, &file.id, "Casey", false, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![
            Presence {
                name: "Casey".into(),
                editing: false,
            },
            Presence {
                name: "Jordan".into(),
                editing: true,
            },
        ]
    );
    assert!(matches!(
        n.drive.write(&casey, &file.id, None, None, b"changed"),
        Err(DriveError::Forbidden)
    ));

    let stale = now - (PRESENCE_TTL + Duration::from_secs(1));
    n.drive
        .report_presence(&jordan, &file.id, "Jordan", true, stale)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Casey".into(),
            editing: false,
        }],
        "a beat older than 15 seconds is absent"
    );

    let stranger = user("stranger");
    assert!(matches!(
        n.drive
            .report_presence(&stranger, &file.id, "Pat", false, now),
        Err(DriveError::Forbidden)
    ));
}

#[test]
fn list_spreadsheets_offers_a_sheet_the_caller_has_not_opened() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let club = n
        .drive
        .create(&rosa, None, "Garden club", "folder", None)
        .unwrap();
    let plans = n
        .drive
        .create(&rosa, None, "Thursday plans", "folder", None)
        .unwrap();
    let roster = n
        .drive
        .create(
            &rosa,
            Some(&club.id),
            "Garden members.slsheet",
            "file",
            None,
        )
        .unwrap();
    n.drive
        .write(
            &rosa,
            &roster.id,
            None,
            Some("application/vnd.suiteleaf.sheet+json"),
            br#"{"kind":"sheet"}"#,
        )
        .unwrap();
    let twin = n
        .drive
        .create(
            &rosa,
            Some(&plans.id),
            "Garden members.slsheet",
            "file",
            None,
        )
        .unwrap();
    let top = n
        .drive
        .create(&rosa, None, "Beds.slsheet", "file", None)
        .unwrap();
    let letter = n
        .drive
        .create(&rosa, Some(&club.id), "Plot letter.sldoc", "file", None)
        .unwrap();
    let secret = n
        .drive
        .create(&sam, None, "Secret.slsheet", "file", None)
        .unwrap();
    let shared_folder = n
        .drive
        .create(&sam, None, "Shared plots", "folder", None)
        .unwrap();
    let shared = n
        .drive
        .create(
            &sam,
            Some(&shared_folder.id),
            "Shared.slsheet",
            "file",
            None,
        )
        .unwrap();
    n.drive
        .share(&sam, &shared_folder.id, "user", "rosa", Some(Role::Viewer))
        .unwrap();
    let old = n
        .drive
        .create(&rosa, Some(&club.id), "Old.slsheet", "file", None)
        .unwrap();
    n.drive
        .update(&rosa, &old.id, None, None, Some(true))
        .unwrap();
    let archive = n
        .drive
        .create(&rosa, None, "Archive", "folder", None)
        .unwrap();
    let buried = n
        .drive
        .create(&rosa, Some(&archive.id), "Buried.slsheet", "file", None)
        .unwrap();
    n.drive
        .update(&rosa, &archive.id, None, None, Some(true))
        .unwrap();

    // Listing does not read the file. The dialog can offer it before anyone
    // opens it on this computer.
    let hits = n.drive.list_spreadsheets(&rosa).unwrap();
    let garden = hits.iter().find(|hit| hit.id == roster.id).unwrap();
    assert_eq!(garden.name, "Garden members.slsheet");
    assert_eq!(garden.parent_name, "Garden club");
    let other = hits.iter().find(|hit| hit.id == twin.id).unwrap();
    assert_eq!(other.name, garden.name);
    assert_eq!(other.parent_name, "Thursday plans");
    assert_ne!(garden.parent_name, other.parent_name);
    assert_eq!(
        hits.iter()
            .find(|hit| hit.id == top.id)
            .unwrap()
            .parent_name,
        "My Drive"
    );
    assert!(
        hits.iter()
            .any(|hit| { hit.id == shared.id && hit.parent_name == "Shared plots" })
    );
    assert!(hits.iter().all(|hit| hit.id != letter.id));
    assert!(hits.iter().all(|hit| hit.id != secret.id));
    assert!(hits.iter().all(|hit| hit.id != old.id));
    assert!(hits.iter().all(|hit| hit.id != buried.id));
    assert!(
        n.drive
            .list_folders(&rosa)
            .unwrap()
            .iter()
            .all(|folder| folder.id != shared_folder.id)
    );

    let listed = serde_json::to_value(garden).unwrap();
    assert_eq!(listed["parentName"], "Garden club");
    assert!(listed.get("bytes").is_none());
    assert!(listed.get("content").is_none());
    assert!(
        n.drive
            .list_spreadsheets(&sam)
            .unwrap()
            .iter()
            .all(|hit| hit.id != roster.id)
    );
}
