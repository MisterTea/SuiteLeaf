//! Sharing, inherited access, notices, ownership, and grants that end.

use suitedrive::{DriveError, Principal, Role};

use crate::support::{node, sync, user};

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
