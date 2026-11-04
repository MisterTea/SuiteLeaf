//! One document room: acknowledgements, viewers, carets, undo, restarts, and lost access.

use std::time::{Duration, Instant};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::connect_async;

use crate::support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_viewer_who_opened_first_hears_when_the_room_is_shared() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let lars = cluster.connect(0, &notes, "lars").await;
    assert_eq!(lars.mode(), "solo");
    let maya = cluster.connect(0, &notes, "maya").await;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if lars.mode() == "multiuser" {
            break;
        }
        if Instant::now() >= deadline {
            panic!("viewer stayed {}", lars.mode());
        }
        sleep(Duration::from_millis(40)).await;
    }
    maya.append_paragraph("Tomatoes are in");
    wait_paragraphs(&[lars, maya], &["Tomatoes are in"]).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stored_edit_is_acknowledged_and_a_viewer_edit_is_refused() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let update = {
        let inner = editors[0].state.lock().expect("client");
        seed_paragraphs(&inner.doc, &["Tomatoes are in"])
    };
    editors[0].send(&json!({
        "type": "update",
        "id": "edit-1",
        "update": STANDARD.encode(update),
        "unit": "paragraph",
        "key": "0",
        "at": AT
    }));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[0].reply() == Some(("ack".into(), "edit-1".into())) {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the stored edit was not acknowledged: {:?}",
                editors[0].reply()
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    wait_paragraphs(&editors, &["Tomatoes are in"]).await;
    let lars = cluster.connect(0, &notes, "lars").await;
    lars.send(&json!({
        "type": "update",
        "id": "view-1",
        "update": STANDARD.encode(root_update("viewerIntrusion", "VIEWER SHOULD NOT LAND")),
        "unit": "paragraph",
        "key": "0",
        "at": AT
    }));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if lars.reply() == Some(("reject".into(), "view-1".into())) {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the viewer edit was not refused: {:?}", lars.reply());
        }
        sleep(Duration::from_millis(40)).await;
    }
    assert_eq!(editors[0].root("viewerIntrusion"), "");
    assert_eq!(editors[0].paragraphs(), ["Tomatoes are in"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_live_caret_reaches_the_other_person_without_changing_the_text() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let before = editors[1].paragraphs();
    editors[0]
        .send(&json!({"type": "selection", "anchor": 1, "head": 4, "text": "Tomatoes are in"}));
    editors[0].send(&json!({"type": "selection", "anchor": 1, "head": 4}));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[1].caret() == Some(("Maya".into(), 1, 4)) {
            break;
        }
        if Instant::now() >= deadline {
            panic!("Sam did not see Maya's caret: {:?}", editors[1].caret());
        }
        sleep(Duration::from_millis(40)).await;
    }
    assert_eq!(editors[1].paragraphs(), before);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restart_keeps_an_edit_that_was_written_to_the_log() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    cluster
        .wait_until("the edit is stored before the node stops", || async {
            let updates = cluster
                .db(
                    0,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            updates.as_array().is_some_and(|rows| !rows.is_empty())
        })
        .await;
    cluster.restart(0);
    drop(editors);
    let again = cluster.connect(0, &notes, "maya").await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if again.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "after restart the room showed {:?}, mode {}",
                again.paragraphs(),
                again.mode()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dropped_connection_and_a_duplicate_edit_keep_the_saved_text() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let mut editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    drop(editors.remove(0));
    let bytes = editors[0].edit_paragraph(1, "Beans are picked");
    editors[0].send_update(&bytes, "paragraph", "1");
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are picked".to_owned()];
    let returned = cluster.connect(0, &notes, "maya").await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if editors[0].paragraphs() == expected && returned.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "after the dropped connection Sam showed {:?} and Maya showed {:?}",
                editors[0].paragraphs(),
                returned.paragraphs()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    cluster
        .db(
            0,
            json!({
                "op": "update",
                "model": "session",
                "where": [{ "field": "id", "value": "maya-session" }],
                "update": { "expiresAt": "2000-01-01T00:00:00.000Z" }
            }),
        )
        .await;
    assert!(
        connection_is_refused(&cluster, &notes, "maya").await,
        "an expired session opened the room"
    );
    assert_eq!(editors[0].paragraphs(), expected);
    drop(returned);
    drop(editors);
    cluster.assert_alive();
}

async fn connection_is_refused(cluster: &Cluster, item: &str, person_id: &str) -> bool {
    let person = cluster.person(person_id);
    let url = format!(
        "{}/api/drive/items/{item}/session?access_token={}",
        cluster.nodes[0].http.replacen("http", "ws", 1),
        person.token
    );
    !matches!(
        timeout(Duration::from_secs(5), connect_async(&url)).await,
        Ok(Ok(_))
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn an_expired_session_cannot_change_the_open_room() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    cluster
        .db(
            0,
            json!({
                "op": "update",
                "model": "session",
                "where": [{ "field": "id", "value": "maya-session" }],
                "update": { "expiresAt": "2000-01-01T00:00:00.000Z" }
            }),
        )
        .await;
    let update = {
        let inner = editors[0].state.lock().expect("client");
        replace_paragraph(&inner.doc, 0, "Tomatoes are gone")
    };
    let _ = editors[0].try_send_update(&update, "paragraph", "0");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let sam = editors[1].paragraphs();
        if sam != expected {
            panic!("an expired session changed the room to {sam:?}");
        }
        if editors[0].closed() {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the expired session stayed connected");
        }
        sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(editors[1].paragraphs(), expected);
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_access_closes_the_open_room_and_keeps_the_saved_text() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let maya = Person {
        id: "maya".into(),
        name: "Maya".into(),
        token: cluster.person("maya").token.clone(),
    };
    let removed = cluster
        .request(
            0,
            &maya,
            reqwest::Method::PUT,
            &format!("/api/drive/items/{notes}/acl"),
            Some(
                serde_json::to_vec(&json!({
                    "principalType": "user",
                    "principalId": "sam",
                    "role": null
                }))
                .unwrap(),
            ),
            None,
        )
        .await;
    assert!(
        removed.status().is_success(),
        "removing access failed: {}",
        removed.status()
    );
    let update = {
        let inner = editors[1].state.lock().expect("client");
        replace_paragraph(&inner.doc, 0, "Tomatoes are gone")
    };
    let _ = editors[1].try_send_update(&update, "paragraph", "0");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let maya_text = editors[0].paragraphs();
        if maya_text != expected {
            panic!("a removed editor changed the room to {maya_text:?}");
        }
        if editors[1].closed() {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the removed editor stayed connected");
        }
        sleep(Duration::from_millis(50)).await;
    }
    let sam = Person {
        id: "sam".into(),
        name: "Sam".into(),
        token: cluster.person("sam").token.clone(),
    };
    let read = cluster
        .request(
            0,
            &sam,
            reqwest::Method::GET,
            &format!("/api/drive/items/{notes}/content"),
            None,
            None,
        )
        .await;
    assert!(
        !read.status().is_success(),
        "a removed editor could still read the file"
    );
    assert_eq!(editors[0].paragraphs(), expected);
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn undoing_one_paragraph_keeps_the_other_persons_text() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let mut maya_undo = editors[0].track_own_paragraphs();
    editors[0].append_own_paragraph("Tomatoes are in");
    wait_paragraphs(&editors, &["Tomatoes are in"]).await;
    editors[1].append_paragraph("Beans are staked");
    wait_paragraphs(&editors, &["Tomatoes are in", "Beans are staked"]).await;
    editors[0].undo_own_paragraph(&mut maya_undo);
    wait_paragraphs(&editors, &["Beans are staked"]).await;
    drop(editors);
    cluster.assert_alive();
}
