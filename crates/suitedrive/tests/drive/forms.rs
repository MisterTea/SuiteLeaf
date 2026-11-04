//! A responder appending to a form file it shares with the owner.

use suitedrive::{DriveError, Role};

use crate::support::{node, user};

fn form_bytes(prompt: &str, responses: serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "kind": "form",
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
    let mut titled = serde_json::from_slice::<serde_json::Value>(&two).unwrap();
    titled["title"] = serde_json::json!("secret-value");
    if let Some(rows) = titled
        .pointer_mut("/content/responses")
        .and_then(|value| value.as_array_mut())
    {
        rows.push(serde_json::json!({ "id": "r3", "answers": { "name": "Ada" } }));
    }
    let titled_bytes = serde_json::to_vec(&titled).unwrap();
    assert!(matches!(
        n.drive.write(&sam, &file.id, None, None, &titled_bytes),
        Err(DriveError::Forbidden)
    ));
    let (_, kept) = n.drive.read(&rosa, &file.id, None).unwrap();
    assert!(!String::from_utf8(kept).unwrap().contains("secret-value"));
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

#[test]
fn a_repeated_form_response_is_not_stored_twice() {
    let n = node();
    let (rosa, sam) = (user("rosa"), user("sam"));
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
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            &form_bytes("Plot", serde_json::json!([])),
        )
        .unwrap();
    n.drive
        .share(&rosa, &file.id, "user", "sam", Some(Role::Responder))
        .unwrap();
    let one = form_bytes(
        "Plot",
        serde_json::json!([{ "id": "r1", "answers": { "name": "North" } }]),
    );
    n.drive.write(&sam, &file.id, None, None, &one).unwrap();
    let again = form_bytes(
        "Plot",
        serde_json::json!([
            { "id": "r1", "answers": { "name": "North" } },
            { "id": "r1", "answers": { "name": "secret-value" } }
        ]),
    );
    let refused = n
        .drive
        .write(&sam, &file.id, None, None, &again)
        .unwrap_err();
    assert!(matches!(refused, DriveError::Forbidden));
    assert!(!refused.to_string().contains("secret-value"));
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["responses"].as_array().unwrap().len(), 1);
    assert_eq!(saved["content"]["responses"][0]["answers"]["name"], "North");
    assert!(!saved.to_string().contains("secret-value"));
    let (_, responder) = n.drive.read(&sam, &file.id, None).unwrap();
    let responder: serde_json::Value = serde_json::from_slice(&responder).unwrap();
    assert_eq!(responder["content"]["questions"][0]["prompt"], "Plot");
    assert_eq!(
        responder["content"]["responses"].as_array().unwrap().len(),
        0
    );
    assert!(!responder.to_string().contains("North"));
    assert!(!responder.to_string().contains("secret-value"));
    assert!(n.drive.search(&sam, "North").unwrap().is_empty());
    assert!(n.drive.search(&sam, "secret-value").unwrap().is_empty());
    let prompt = n.drive.search(&sam, "Plot").unwrap();
    assert_eq!(prompt.len(), 1);
    assert!(!prompt[0].snippet.contains("North"));
    assert!(!prompt[0].snippet.contains("secret-value"));
    let owner = n.drive.search(&rosa, "North").unwrap();
    assert_eq!(owner.len(), 1);
    assert!(owner[0].snippet.contains("North"));
    let blank = form_bytes(
        "Plot",
        serde_json::json!([
            { "id": "r1", "answers": { "name": "North" } },
            { "id": "r2", "answers": { "name": "  ", "note": "secret-value" } }
        ]),
    );
    let required = n
        .drive
        .write(&sam, &file.id, None, None, &blank)
        .unwrap_err();
    match required {
        DriveError::BadRequest(message) => {
            assert_eq!(message, "Plot is required");
            assert!(!message.contains("secret-value"));
        }
        other => panic!("expected a required-question refusal, got {other}"),
    }
    let (_, still) = n.drive.read(&rosa, &file.id, None).unwrap();
    let still: serde_json::Value = serde_json::from_slice(&still).unwrap();
    assert_eq!(still["content"]["responses"].as_array().unwrap().len(), 1);
    let closed = serde_json::json!({
        "kind": "form",
        "content": {
            "accepting": false,
            "questions": [{ "id": "name", "prompt": "Plot", "kind": "text", "required": true }],
            "responses": [{ "id": "r1", "answers": { "name": "North" } }]
        }
    });
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            &serde_json::to_vec(&closed).unwrap(),
        )
        .unwrap();
    let more = form_bytes(
        "Plot",
        serde_json::json!([
            { "id": "r1", "answers": { "name": "North" } },
            { "id": "r4", "answers": { "name": "Ada" } }
        ]),
    );
    let stopped = n
        .drive
        .write(&sam, &file.id, None, None, &more)
        .unwrap_err();
    match stopped {
        DriveError::BadRequest(message) => {
            assert_eq!(message, "This form is not taking more responses.");
            assert!(!message.contains("Ada"));
        }
        other => panic!("expected a closed form, got {other}"),
    }
    let (_, after_close) = n.drive.read(&rosa, &file.id, None).unwrap();
    let after_close: serde_json::Value = serde_json::from_slice(&after_close).unwrap();
    assert_eq!(
        after_close["content"]["responses"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
