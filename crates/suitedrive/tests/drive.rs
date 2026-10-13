use std::sync::Arc;

use libp2p_identity::ed25519;
use suitedb::{Db, Schema};
use suitedrive::{BlobTransport, CHUNK_SIZE, Drive, DriveError, Principal, Role, tables};
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
