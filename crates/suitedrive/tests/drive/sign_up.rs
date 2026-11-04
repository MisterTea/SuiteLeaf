//! Sign-up links: answers from someone without an account.

use suitedrive::{DriveError, Role};

use crate::support::{answer_map, node, user};

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
fn a_sign_up_link_stores_a_trimmed_choice_and_refuses_another_answer() {
    let n = node();
    let rosa = user("rosa");
    let file = n
        .drive
        .create(
            &rosa,
            None,
            "Plot size.slform",
            "file",
            Some("application/vnd.suiteleaf.form+json"),
        )
        .unwrap();
    let seeded = serde_json::to_vec(&serde_json::json!({
        "format": "suiteleaf",
        "version": 1,
        "id": "form-choice",
        "title": "Plot size",
        "kind": "form",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "content": {
            "questions": [{
                "id": "plot",
                "prompt": "Plot size",
                "kind": "choice",
                "required": true,
                "choices": [" Beds ", "Paths"]
            }],
            "responses": []
        }
    }))
    .unwrap();
    n.drive.write(&rosa, &file.id, None, None, &seeded).unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let Err(DriveError::BadRequest(message)) = n
        .drive
        .submit_public_response(&token, &answer_map(&[("plot", "secret-value")]))
    else {
        panic!("expected the choice to be refused");
    };
    assert_eq!(message, "Plot size must be one of the choices");
    assert!(!message.contains("secret-value"));
    n.drive
        .submit_public_response(&token, &answer_map(&[("plot", " Beds ")]))
        .unwrap();
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["questions"][0]["choices"][0], " Beds ");
    assert_eq!(saved["content"]["responses"][0]["answers"]["plot"], "Beds");
    assert!(!saved.to_string().contains("secret-value"));
}

#[test]
fn a_sign_up_link_stores_a_trimmed_grid_and_refuses_another_answer() {
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
        "id": "form-grid-trim",
        "title": "Day grid",
        "kind": "form",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
        "content": {
            "questions": [{
                "id": "days",
                "prompt": "Which days?",
                "kind": "grid",
                "required": true,
                "rows": [" Mon "],
                "columns": [" Yes "]
            }],
            "responses": []
        }
    }))
    .unwrap();
    n.drive.write(&rosa, &file.id, None, None, &seeded).unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let Err(DriveError::BadRequest(message)) = n.drive.submit_public_response(
        &token,
        &answer_map(&[("days", r#"{"Mon":"secret-value"}"#)]),
    ) else {
        panic!("expected the column to be refused");
    };
    assert_eq!(message, "Which days? must be one of the columns");
    assert!(!message.contains("secret-value"));
    n.drive
        .submit_public_response(&token, &answer_map(&[("days", r#"{" Mon ":" Yes "}"#)]))
        .unwrap();
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["questions"][0]["columns"][0], " Yes ");
    assert_eq!(
        saved["content"]["responses"][0]["answers"]["days"],
        r#"{"Mon":"Yes"}"#
    );
    assert!(!saved.to_string().contains("secret-value"));
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
