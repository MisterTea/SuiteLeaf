//! Restricted folders and who loses access when one is restricted.

use std::sync::Arc;

use libp2p_identity::ed25519;
use suitedb::{ColumnType, Db, Schema, TableDef, Value};
use suitedrive::{AccessReason, Drive, Role, tables};

use crate::support::{node, user};

#[test]
fn a_restricted_folder_blocks_a_grant_from_the_folder_above_it() {
    let n = node();
    let rosa = user("rosa");
    let sam = user("sam");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let beds = n
        .drive
        .create(&rosa, Some(&garden.id), "Beds", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&beds.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    n.drive.set_restricted(&rosa, &beds.id, true).unwrap();
    assert!(n.drive.set_restricted(&sam, &beds.id, false).is_err());
    assert!(n.drive.set_restricted(&rosa, &file.id, true).is_err());
    let blocked = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(blocked.role, None);
    assert_eq!(blocked.role, n.drive.role(&sam, &file.id).unwrap());
    assert!(matches!(
        blocked.reason,
        AccessReason::Restricted { ref item_id, ref item_name, .. }
            if item_id == &beds.id && item_name == "Beds"
    ));
    let noor = n
        .drive
        .explain_visible(&user("noor"), &file.id)
        .unwrap_err();
    assert_eq!(noor.to_string(), "not found");
    assert!(!noor.to_string().contains("Watering"));
    assert!(!noor.to_string().contains(&file.id));
    let sam_visible = n.drive.explain_visible(&sam, &file.id).unwrap();
    assert!(matches!(
        sam_visible.reason,
        AccessReason::Restricted { ref item_name, .. } if item_name == "Beds"
    ));
    let hidden = n.drive.explain(&user("noor"), &file.id).unwrap();
    assert_eq!(hidden.role, None);
    assert!(matches!(
        hidden.reason,
        AccessReason::Restricted { ref item_id, ref item_name, .. }
            if item_id.is_empty() && item_name.is_empty()
    ));
    assert!(
        n.drive
            .write(&sam, &file.id, None, Some("text/plain"), b"no")
            .is_err()
    );

    n.drive
        .share(&rosa, &beds.id, "user", "sam", Some(Role::Viewer))
        .unwrap();
    let from_beds = n.drive.explain(&sam, &file.id).unwrap();
    assert_eq!(from_beds.role, Some(Role::Viewer));
    assert!(matches!(
        from_beds.reason,
        AccessReason::Grant { inherited: true, ref item_id, .. } if item_id == &beds.id
    ));
}

#[test]
fn restricting_a_folder_lists_who_loses_access_and_can_be_undone() {
    let n = node();
    let rosa = user("rosa");
    let garden = n
        .drive
        .create(&rosa, None, "Garden", "folder", None)
        .unwrap();
    let beds = n
        .drive
        .create(&rosa, Some(&garden.id), "Beds", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&rosa, Some(&beds.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "user", "sam", Some(Role::Editor))
        .unwrap();
    let club = n.drive.create_group("rosa", "Garden club").unwrap();
    n.drive
        .add_member("rosa", &club.id, "user", "priya")
        .unwrap();
    n.drive
        .share(&rosa, &garden.id, "group", &club.id, Some(Role::Viewer))
        .unwrap();

    let plan = n.drive.plan_restrict(&rosa, &beds.id).unwrap();
    assert_eq!(plan.folder_name, "Beds");
    assert!(plan.recovery.contains("Beds"));
    assert!(plan.recovery.contains("Grants stay"));
    assert!(n.drive.role(&user("sam"), &file.id).unwrap() == Some(Role::Editor));
    let sam_file = plan
        .changes
        .iter()
        .find(|change| change.principal_id == "sam" && change.item_id == file.id)
        .unwrap();
    assert_eq!(sam_file.before, Some(Role::Editor));
    assert_eq!(sam_file.after, None);
    let priya_file = plan
        .changes
        .iter()
        .find(|change| change.principal_id == "priya" && change.item_id == file.id)
        .unwrap();
    assert_eq!(priya_file.before, Some(Role::Viewer));
    assert_eq!(priya_file.after, None);

    let applied = n.drive.restrict_folder(&rosa, &beds.id).unwrap();
    assert_eq!(applied.changes.len(), plan.changes.len());
    assert_eq!(n.drive.role(&user("sam"), &file.id).unwrap(), None);
    n.drive.restore_inheritance(&rosa, &beds.id).unwrap();
    assert_eq!(
        n.drive.role(&user("sam"), &file.id).unwrap(),
        Some(Role::Editor)
    );
    assert_eq!(
        n.drive.role(&user("priya"), &file.id).unwrap(),
        Some(Role::Viewer)
    );
}

#[test]
fn restricting_a_folder_names_a_person_in_an_organization_grant() {
    let dir = tempfile::tempdir().unwrap();
    let mut defined = tables();
    defined.push(
        TableDef::new("member", "id")
            .column("userId", ColumnType::Text)
            .column("organizationId", ColumnType::Text),
    );
    let db = Arc::new(
        Db::open(
            &dir.path().join("db.sqlite"),
            ed25519::Keypair::generate(),
            Schema {
                version: 1,
                tables: defined,
            },
        )
        .unwrap(),
    );
    let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
    let rosa = user("rosa");
    let garden = drive.create(&rosa, None, "Garden", "folder", None).unwrap();
    let beds = drive
        .create(&rosa, Some(&garden.id), "Beds", "folder", None)
        .unwrap();
    let file = drive
        .create(&rosa, Some(&beds.id), "Watering rota.sldoc", "file", None)
        .unwrap();
    drive
        .share(&rosa, &garden.id, "org", "club", Some(Role::Editor))
        .unwrap();
    db.transact(|tx| {
        tx.upsert(
            "member",
            "noor-club",
            [
                ("userId", Value::Text("noor".into())),
                ("organizationId", Value::Text("club".into())),
            ],
        )
    })
    .unwrap();
    let plan = drive.plan_restrict(&rosa, &beds.id).unwrap();
    let noor = plan
        .changes
        .iter()
        .find(|change| change.principal_id == "noor" && change.item_id == file.id)
        .unwrap();
    assert_eq!(noor.before, Some(Role::Editor));
    assert_eq!(noor.after, None);
    assert!(
        !plan
            .changes
            .iter()
            .any(|change| change.principal_id == "club")
    );
    assert_eq!(
        drive.role(&user("noor"), &file.id).unwrap(),
        Some(Role::Editor)
    );
}
