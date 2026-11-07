use crate::support::{node, user};
use suitedrive::{DriveError, Principal, Role};

#[test]
fn public_links_require_ownership_and_only_read_current_sanitized_content() {
    let n = node();
    let owner = user("owner");
    let viewer = user("viewer");
    let stranger = user("stranger");
    let folder = n
        .drive
        .create(&owner, None, "Folder", "folder", None)
        .unwrap();
    let file = n
        .drive
        .create(&owner, Some(&folder.id), "Example.sldoc", "file", None)
        .unwrap();
    let first = br#"{"kind":"doc","title":"First","content":{"text":"current","picture":"\u0000slmedia:0"},"versions":[{"content":"secret","image":"\u0000slmedia:1"}],"edits":[{"by":"private person"}],"sharedMedia":["visible picture","private picture"]}"#;
    let saved = n.drive.write(&owner, &file.id, None, None, first).unwrap();
    assert!(n.drive.public_sharing_allowed().unwrap());
    assert!(
        n.drive
            .public_link(&owner, &file.id)
            .unwrap()
            .token
            .is_none()
    );
    assert!(matches!(
        n.drive.create_public_link(&owner, &folder.id),
        Err(DriveError::BadRequest(_))
    ));
    n.drive
        .share(&owner, &file.id, "user", "viewer", Some(Role::Editor))
        .unwrap();
    assert!(matches!(
        n.drive.create_public_link(&viewer, &file.id),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive.public_link(&stranger, &file.id),
        Err(DriveError::Forbidden)
    ));
    let token = n
        .drive
        .create_public_link(&owner, &file.id)
        .unwrap()
        .token
        .unwrap();
    assert_eq!(token.len(), 64);
    assert_eq!(
        n.drive
            .create_public_link(&owner, &file.id)
            .unwrap()
            .token
            .unwrap(),
        token
    );
    let public: serde_json::Value =
        serde_json::from_slice(&n.drive.public_file(&token).unwrap()).unwrap();
    assert_eq!(public["content"]["text"], "current");
    assert!(public.get("versions").is_none());
    assert!(public.get("edits").is_none());
    assert_eq!(
        public["sharedMedia"],
        serde_json::json!(["visible picture", ""])
    );
    assert!(matches!(
        n.drive.read(&stranger, &file.id, None),
        Err(DriveError::Forbidden)
    ));
    assert!(matches!(
        n.drive.public_file(&file.id),
        Err(DriveError::NotFound)
    ));
    assert!(matches!(
        n.drive.public_file(&"f".repeat(64)),
        Err(DriveError::NotFound)
    ));
    assert!(matches!(
        n.drive.public_file(&"z".repeat(64)),
        Err(DriveError::NotFound)
    ));
    n.drive
        .write(
            &owner,
            &file.id,
            saved.head_version_id.as_deref(),
            None,
            br#"{"kind":"doc","content":{"text":"new"}}"#,
        )
        .unwrap();
    let current: serde_json::Value =
        serde_json::from_slice(&n.drive.public_file(&token).unwrap()).unwrap();
    assert_eq!(current["content"]["text"], "new");
    n.drive
        .update(&owner, &folder.id, None, None, Some(true))
        .unwrap();
    assert!(matches!(
        n.drive.public_file(&token),
        Err(DriveError::NotFound)
    ));
    n.drive
        .update(&owner, &folder.id, None, None, Some(false))
        .unwrap();
    assert!(n.drive.public_file(&token).is_ok());
    assert!(matches!(
        n.drive.clear_public_link(&viewer, &file.id),
        Err(DriveError::Forbidden)
    ));
    n.drive.clear_public_link(&owner, &file.id).unwrap();
    assert!(matches!(
        n.drive.public_file(&token),
        Err(DriveError::NotFound)
    ));
    let replacement = n
        .drive
        .create_public_link(&owner, &file.id)
        .unwrap()
        .token
        .unwrap();
    assert_ne!(replacement, token);
    n.drive
        .update(&owner, &file.id, None, None, Some(true))
        .unwrap();
    assert!(matches!(
        n.drive.public_file(&replacement),
        Err(DriveError::NotFound)
    ));
    n.drive.delete_forever(&owner, &file.id).unwrap();
    assert!(matches!(
        n.drive.public_file(&replacement),
        Err(DriveError::NotFound)
    ));
}

#[test]
fn admin_policy_revokes_all_links_and_cannot_be_bypassed_or_revived() {
    let n = node();
    let owner = user("owner");
    let admin = Principal {
        id: "admin".into(),
        admin: true,
    };
    let file = n
        .drive
        .create(&owner, None, "Example.sldoc", "file", None)
        .unwrap();
    n.drive
        .write(
            &owner,
            &file.id,
            None,
            None,
            br#"{"kind":"doc","content":{}}"#,
        )
        .unwrap();
    let token = n
        .drive
        .create_public_link(&owner, &file.id)
        .unwrap()
        .token
        .unwrap();
    assert!(matches!(
        n.drive.set_public_sharing(&owner, false),
        Err(DriveError::Forbidden)
    ));
    n.drive.set_public_sharing(&admin, false).unwrap();
    let status = n.drive.public_link(&owner, &file.id).unwrap();
    assert!(!status.allowed);
    assert!(status.token.is_none());
    assert!(matches!(
        n.drive.public_file(&token),
        Err(DriveError::NotFound)
    ));
    assert!(matches!(
        n.drive.create_public_link(&owner, &file.id),
        Err(DriveError::Forbidden)
    ));
    n.drive.set_public_sharing(&admin, true).unwrap();
    assert!(matches!(
        n.drive.public_file(&token),
        Err(DriveError::NotFound)
    ));
    assert_ne!(
        n.drive
            .create_public_link(&admin, &file.id)
            .unwrap()
            .token
            .unwrap(),
        token
    );
}

#[test]
fn forms_never_publish_responses_answer_keys_or_response_media() {
    let n = node();
    let owner = user("owner");
    let file = n
        .drive
        .create(&owner, None, "Survey.slform", "file", None)
        .unwrap();
    n.drive.write(&owner, &file.id, None, None, br#"{"kind":"form","content":{"questions":[{"prompt":"Name?","answer":"secret key"}],"responses":[{"answer":"private name","attachment":"\u0000slmedia:0"}]},"sharedMedia":["private attachment"]}"#).unwrap();
    let token = n
        .drive
        .create_public_link(&owner, &file.id)
        .unwrap()
        .token
        .unwrap();
    let public: serde_json::Value =
        serde_json::from_slice(&n.drive.public_file(&token).unwrap()).unwrap();
    assert_eq!(public["content"]["responses"], serde_json::json!([]));
    assert!(public["content"]["questions"][0].get("answer").is_none());
    assert_eq!(public["sharedMedia"][0], "");
}
