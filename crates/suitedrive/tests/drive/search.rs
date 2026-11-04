//! Search by name and file text, and the spreadsheet picker.

use suitedrive::Role;

use crate::support::{node, user};

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
