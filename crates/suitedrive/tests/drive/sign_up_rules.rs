//! Sign-up rules: a closed form, a deadline, a skipped question, a number range, and an upload.

use suitedrive::DriveError;

use crate::support::{answer_map, node, user};

#[test]
fn a_closed_form_refuses_a_sign_up() {
    let n = node();
    let rosa = user("rosa");
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
    let body = serde_json::json!({
        "kind": "form",
        "content": {
            "accepting": false,
            "questions": [{ "id": "name", "prompt": "Plot", "kind": "text", "required": true }],
            "responses": []
        }
    });
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            &serde_json::to_vec(&body).unwrap(),
        )
        .unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let public = n.drive.public_form(&token).unwrap();
    assert!(!public.accepting);
    assert_eq!(public.questions.len(), 1);
    let refused = n
        .drive
        .submit_public_response(&token, &answer_map(&[("name", "secret-value")]))
        .unwrap_err();
    match refused {
        DriveError::BadRequest(message) => {
            assert_eq!(message, "This form is not taking more responses.");
            assert!(!message.contains("secret-value"));
        }
        other => panic!("expected a closed sign-up, got {other}"),
    }
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["responses"].as_array().unwrap().len(), 0);
    assert!(!saved.to_string().contains("secret-value"));
}

#[test]
fn a_large_plot_skips_the_beds_question() {
    let n = node();
    let rosa = user("rosa");
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
    let body = serde_json::json!({
        "kind": "form",
        "content": {
            "questions": [
                {
                    "id": "size",
                    "prompt": "Size",
                    "kind": "choice",
                    "required": true,
                    "choices": ["Small", "Large"],
                    "branches": [{ "when": "Large", "next": "note" }],
                    "points": 1,
                    "answer": "Large"
                },
                { "id": "beds", "prompt": "Beds", "kind": "text", "required": true, "points": 2, "answer": "North" },
                { "id": "note", "prompt": "Note", "kind": "text", "required": true, "points": 1, "answer": "Ok" }
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
            &serde_json::to_vec(&body).unwrap(),
        )
        .unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let public = n.drive.public_form(&token).unwrap();
    assert!(public.questions[0].get("branches").is_some());
    assert!(
        !public
            .questions
            .iter()
            .any(|question| question.get("answer").is_some())
    );
    assert!(
        !serde_json::to_string(&public.questions)
            .unwrap()
            .contains("North")
    );
    n.drive
        .submit_public_response(
            &token,
            &answer_map(&[
                ("size", "Large"),
                ("beds", "secret-value"),
                ("note", "North"),
            ]),
        )
        .unwrap();
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    let answers = &saved["content"]["responses"][0]["answers"];
    assert_eq!(answers["size"], "Large");
    assert_eq!(answers["note"], "North");
    assert!(answers.get("beds").is_none());
    assert_eq!(saved["content"]["responses"][0]["score"], 1);
    assert_eq!(saved["content"]["responses"][0]["possible"], 2);
    assert!(!answers.to_string().contains("secret-value"));
    let missing = n
        .drive
        .submit_public_response(&token, &answer_map(&[("size", "Small"), ("note", "West")]))
        .unwrap_err();
    match missing {
        DriveError::BadRequest(message) => assert_eq!(message, "Beds is required"),
        other => panic!("expected the beds question, got {other}"),
    }
}

#[test]
fn a_form_upload_keeps_the_name_and_refuses_a_script() {
    let n = node();
    let rosa = user("rosa");
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
    let body = serde_json::json!({
        "kind": "form",
        "content": {
            "questions": [{ "id": "photo", "prompt": "Photo", "kind": "file", "required": true }],
            "responses": []
        }
    });
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            &serde_json::to_vec(&body).unwrap(),
        )
        .unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    n.drive
        .submit_public_response(&token, &answer_map(&[("photo", "Beds.png|12")]))
        .unwrap();
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(
        saved["content"]["responses"][0]["answers"]["photo"],
        "Beds.png (12 bytes)"
    );
    let refused = n
        .drive
        .submit_public_response(&token, &answer_map(&[("photo", "secret-value.png|12")]))
        .unwrap_err();
    match refused {
        DriveError::BadRequest(message) => {
            assert_eq!(message, "That file is not an allowed upload.");
            assert!(!message.contains("secret-value"));
        }
        other => panic!("expected a refused upload, got {other}"),
    }
    let huge = n
        .drive
        .submit_public_response(&token, &answer_map(&[("photo", "Beds.png|5000001")]))
        .unwrap_err();
    match huge {
        DriveError::BadRequest(message) => assert_eq!(message, "That file is too large."),
        other => panic!("expected a large file, got {other}"),
    }
    let (_, after) = n.drive.read(&rosa, &file.id, None).unwrap();
    let after: serde_json::Value = serde_json::from_slice(&after).unwrap();
    assert_eq!(after["content"]["responses"].as_array().unwrap().len(), 1);
    assert!(!after.to_string().contains("secret-value"));
}

#[test]
fn a_form_number_stays_inside_its_range() {
    let n = node();
    let rosa = user("rosa");
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
    let body = serde_json::json!({
        "kind": "form",
        "content": {
            "questions": [{
                "id": "beds",
                "prompt": "Beds",
                "kind": "number",
                "required": true,
                "min": 1,
                "max": 10
            }],
            "responses": []
        }
    });
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            &serde_json::to_vec(&body).unwrap(),
        )
        .unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let public = n.drive.public_form(&token).unwrap();
    assert_eq!(public.questions[0]["min"].as_f64(), Some(1.0));
    assert_eq!(public.questions[0]["max"].as_f64(), Some(10.0));
    n.drive
        .submit_public_response(&token, &answer_map(&[("beds", " 4 ")]))
        .unwrap();
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["responses"][0]["answers"]["beds"], "4");
    let refused = n
        .drive
        .submit_public_response(&token, &answer_map(&[("beds", "secret-value")]))
        .unwrap_err();
    match refused {
        DriveError::BadRequest(message) => {
            assert_eq!(message, "Enter a number.");
            assert!(!message.contains("secret-value"));
        }
        other => panic!("expected a number, got {other}"),
    }
    let outside = n
        .drive
        .submit_public_response(&token, &answer_map(&[("beds", "11")]))
        .unwrap_err();
    match outside {
        DriveError::BadRequest(message) => assert_eq!(message, "That number is outside the range."),
        other => panic!("expected a range, got {other}"),
    }
    let (_, after) = n.drive.read(&rosa, &file.id, None).unwrap();
    let after: serde_json::Value = serde_json::from_slice(&after).unwrap();
    assert_eq!(after["content"]["responses"].as_array().unwrap().len(), 1);
}

#[test]
fn a_past_deadline_refuses_a_sign_up() {
    let n = node();
    let rosa = user("rosa");
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
    let body = serde_json::json!({
        "kind": "form",
        "content": {
            "deadline": "2020-01-01T00:00:00.000Z",
            "questions": [{ "id": "name", "prompt": "Plot", "kind": "text", "required": true }],
            "responses": []
        }
    });
    n.drive
        .write(
            &rosa,
            &file.id,
            None,
            None,
            &serde_json::to_vec(&body).unwrap(),
        )
        .unwrap();
    let token = n.drive.create_respond_link(&rosa, &file.id).unwrap();
    let public = n.drive.public_form(&token).unwrap();
    assert_eq!(public.deadline.as_deref(), Some("2020-01-01T00:00:00.000Z"));
    let refused = n
        .drive
        .submit_public_response(&token, &answer_map(&[("name", "secret-value")]))
        .unwrap_err();
    match refused {
        DriveError::BadRequest(message) => {
            assert_eq!(message, "The deadline for this form has passed.");
            assert!(!message.contains("secret-value"));
        }
        other => panic!("expected a deadline, got {other}"),
    }
    let (_, saved) = n.drive.read(&rosa, &file.id, None).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(saved["content"]["responses"].as_array().unwrap().len(), 0);
    assert!(!saved.to_string().contains("secret-value"));
}
