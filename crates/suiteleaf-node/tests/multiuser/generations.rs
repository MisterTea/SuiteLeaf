//! Each shared room has a generation. An edit made in another generation is
//! refused as stale, so its Yjs structure never mixes into a document built
//! from a different log.

use std::time::{Duration, Instant};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use tokio::time::sleep;

use crate::support::*;

async fn wait_reply(client: &LiveClient, kind: &str, id: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while client.reply() != Some((kind.into(), id.into())) {
        assert!(
            Instant::now() < deadline,
            "{} never got {kind} for {id}: {:?}",
            client.name,
            client.reply()
        );
        sleep(Duration::from_millis(40)).await;
    }
}

fn edit_in(client: &LiveClient, id: &str, bytes: &[u8], generation: i64) {
    client.send(&json!({
        "type": "update",
        "id": id,
        "generation": generation,
        "update": STANDARD.encode(bytes),
        "unit": "paragraph",
        "key": "0",
        "at": AT
    }));
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_from_another_generation_is_refused_as_stale_and_not_stored() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let generation = editors[0].generation();
    assert!(generation > 0, "a shared room named no generation");
    assert_eq!(editors[1].generation(), generation);
    let seed = {
        let inner = editors[0].state.lock().expect("client");
        seed_paragraphs(&inner.doc, &["Tomatoes are in"])
    };
    edit_in(&editors[0], "edit-1", &seed, generation);
    wait_reply(&editors[0], "ack", "edit-1").await;
    assert_eq!(editors[0].reject_reason(), None);
    wait_paragraphs(&editors, &["Tomatoes are in"]).await;

    let old = {
        let inner = editors[1].state.lock().expect("client");
        replace_paragraph(&inner.doc, 0, "Tomatoes are gone")
    };
    edit_in(&editors[1], "old-1", &old, generation - 1);
    wait_reply(&editors[1], "reject", "old-1").await;
    assert_eq!(editors[1].reject_reason().as_deref(), Some("stale"));
    sleep(Duration::from_millis(300)).await;
    assert_eq!(editors[0].paragraphs(), vec!["Tomatoes are in"]);

    // Everyone leaves, the room is written to the file, and it is shared again.
    drop(editors);
    cluster
        .wait_until("the room is written to the file", || async {
            cluster
                .read_content(0, cluster.person("maya"), &notes)
                .await
                .is_some_and(|bytes| contains(&bytes, "Tomatoes are in"))
        })
        .await;
    let again = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let next = again[0].generation();
    assert!(next > generation, "the shared room kept generation {generation}");
    // Sam's edit from the first room cannot be placed in this one.
    edit_in(&again[1], "old-2", &old, generation);
    wait_reply(&again[1], "reject", "old-2").await;
    assert_eq!(again[1].reject_reason().as_deref(), Some("stale"));
    let text = again[0].paragraphs().join("\n");
    assert!(!text.contains("Tomatoes are gone"), "a stale edit reached the room: {text}");
}
