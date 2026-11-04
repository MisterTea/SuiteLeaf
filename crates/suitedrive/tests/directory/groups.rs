//! Group membership: nesting, loops, group grants, and planned membership changes.

use suitedb::Value;
use suitedrive::{DriveError, Role};

use crate::support::{edge, node, user};

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
