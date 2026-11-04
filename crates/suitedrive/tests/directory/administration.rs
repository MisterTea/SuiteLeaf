//! Administrator tools: handing over files, the editor policy, and a person's access.

use suitedrive::{DriveError, Principal, Role};

use crate::support::{node, user};

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

    let notes = n
        .drive
        .create(&rosa, Some(&garden.id), "Notes.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&rosa, &notes.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    n.drive
        .add_member("rosa", &club.id, "user", "noor")
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "group", &club.id, Some(Role::Editor))
        .unwrap();

    let plan = n.drive.plan_editor_policy(&rosa).unwrap();
    assert!(plan.changes.iter().any(|change| {
        change.principal_id == "sam" && change.item_name == "Garden" && change.after == Role::Viewer
    }));
    assert!(
        plan.changes
            .iter()
            .any(|change| change.item_name == "Notes.sldoc")
    );
    let rota = plan
        .effects
        .iter()
        .find(|change| change.item_name == "Watering rota.sldoc" && change.principal_id == "sam")
        .expect("the file inside the folder");
    assert_eq!(rota.before, Role::Editor);
    assert_eq!(rota.after, Role::Viewer);
    assert!(plan.effects.iter().any(|change| {
        change.principal_id == "noor" && change.item_name == "Watering rota.sldoc"
    }));
    assert!(
        !plan
            .effects
            .iter()
            .any(|change| change.item_name == "Notes.sldoc" && change.principal_id == "sam")
    );
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

#[test]
fn an_administrator_reviews_editor_access_on_someone_elses_file() {
    let n = node();
    let sam = user("sam");
    let admin = Principal {
        id: "rosa".into(),
        admin: true,
    };
    let garden = n
        .drive
        .create(&sam, None, "Garden", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&sam, Some(&garden.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(&sam, &file.id, None, Some("text/plain"), b"secret-value")
        .unwrap();
    n.drive
        .share(&sam, &garden.id, "user", "priya", Some(Role::Editor))
        .unwrap();

    assert!(
        n.drive
            .plan_editor_policy(&admin)
            .unwrap()
            .changes
            .is_empty()
    );
    assert!(matches!(
        n.drive.plan_org_editor_policy(&user("rosa")),
        Err(DriveError::Forbidden)
    ));
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Editor)
    );

    let plan = n.drive.plan_org_editor_policy(&admin).unwrap();
    assert!(
        plan.changes
            .iter()
            .any(|change| { change.principal_id == "priya" && change.item_name == "Garden" })
    );
    assert!(plan.effects.iter().any(|change| {
        change.principal_id == "priya"
            && change.item_name == "Watering rota.sldoc"
            && change.before == Role::Editor
            && change.after == Role::Viewer
    }));
    assert!(!format!("{plan:?}").contains("secret-value"));

    let stale = n
        .drive
        .apply_org_editor_policy(&admin, "secret-value")
        .unwrap_err();
    let DriveError::BadRequest(message) = stale else {
        panic!("expected the plan to be checked again");
    };
    assert_eq!(message, "The access plan changed. Review it again.");
    assert!(!message.contains("secret-value"));
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Editor)
    );

    n.drive
        .apply_org_editor_policy(&admin, &plan.stamp)
        .unwrap();
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Viewer)
    );
    let (_item, bytes) = n.drive.read(&sam, &file.id, None).unwrap();
    assert_eq!(bytes, b"secret-value");
    n.drive
        .rollback_editor_policy(&admin, &plan.changes)
        .unwrap();
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}

#[test]
fn a_person_access_list_names_their_files_and_not_other_members() {
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
    let hidden = n
        .drive
        .create(&rosa, None, "Hidden.sldoc", "file", None)
        .unwrap();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    n.drive.add_member("rosa", &club.id, "user", "sam").unwrap();
    n.drive
        .add_member("rosa", &club.id, "user", "priya")
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "group", &club.id, Some(Role::Editor))
        .unwrap();

    let blank = n.drive.inspect_person(&sam, "  ").unwrap_err();
    let DriveError::BadRequest(message) = blank else {
        panic!("expected a person to be named");
    };
    assert_eq!(message, "Name the person.");
    assert!(matches!(
        n.drive.inspect_person(&user("eve"), "sam"),
        Err(DriveError::Forbidden)
    ));

    let files = n.drive.inspect_person(&sam, "sam").unwrap();
    assert!(files.iter().any(|row| {
        row.item_name == "Watering rota.sldoc"
            && row.role == Role::Editor
            && row.source == "group"
            && row.inherited_from.as_deref() == Some("Garden")
            && row.group_name.as_deref() == Some("Garden club")
    }));
    assert!(
        files
            .iter()
            .any(|row| row.item_name == "Garden" && row.inherited_from.is_none())
    );
    assert!(!files.iter().any(|row| row.item_id == hidden.id));
    let shown = format!("{files:?}");
    assert!(!shown.contains("secret-value"));
    assert!(!shown.contains("priya"));
    assert!(!shown.contains(&club.id));
    assert_eq!(
        n.drive.role(&sam, &file.id).unwrap(),
        files
            .iter()
            .find(|row| row.item_id == file.id)
            .map(|row| row.role)
    );

    let admin = Principal {
        id: "rosa".into(),
        admin: true,
    };
    let reviewed = n.drive.inspect_person(&admin, "sam").unwrap();
    assert_eq!(reviewed.len(), files.len());
}
