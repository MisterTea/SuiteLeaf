//! Many clients editing one document, sheet, presentation, or drawing at once.

use std::time::{Duration, Instant};

use serde_json::json;
use tokio::time::sleep;
use yrs::{Doc, ReadTxn, StateVector, Transact};

use crate::support::*;

async fn same_paragraph_merges(cluster: &Cluster, item: &str, clients: &[LiveClient]) {
    clients[0].seed(&["Tomatoes are in", "Beans are staked"]);
    wait_paragraphs(clients, &["Tomatoes are in", "Beans are staked"]).await;
    let (snapshot, left, right) = {
        let maya = clients[0].state.lock().expect("client");
        let sam = clients[1].state.lock().expect("client");
        let snapshot = maya
            .doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let left = replace_paragraph(&maya.doc, 0, "Tomatoes and basil");
        let right = replace_paragraph(&sam.doc, 0, "Tomatoes and dill");
        (snapshot, left, right)
    };
    clients[0].send_update(&left, "paragraph", "0");
    clients[1].send_update(&right, "paragraph", "0");
    let referee = Doc::new();
    integrate(&referee, &snapshot).unwrap();
    integrate(&referee, &left).unwrap();
    integrate(&referee, &right).unwrap();
    let expected = paragraph_strings(&referee);
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if clients.iter().all(|client| client.paragraphs() == expected) {
            break;
        }
        if Instant::now() >= deadline {
            let got: Vec<_> = clients.iter().map(|client| client.paragraphs()).collect();
            panic!("same-paragraph edits did not match the merged document {expected:?}: {got:?}");
        }
        sleep(Duration::from_millis(40)).await;
    }
    let late = cluster.connect(0, item, "maya").await;
    assert_eq!(
        late.paragraphs(),
        expected,
        "a late joiner saw a different document"
    );
    assert_eq!(
        expected.get(1).map(String::as_str),
        Some("Beans are staked")
    );
}

async fn rejected_writers_leave_the_body(cluster: &Cluster, item: &str, editors: &[LiveClient]) {
    let lars = cluster.connect(0, item, "lars").await;
    assert!(lars.accepted(), "a viewer was turned away");
    assert_eq!(lars.paragraphs(), editors[0].paragraphs());
    lars.send_update(
        &root_update("viewerIntrusion", "VIEWER SHOULD NOT LAND"),
        "paragraph",
        "0",
    );
    let priya = cluster.connect(0, item, "priya").await;
    assert!(priya.accepted(), "a commenter was turned away");
    priya.send_update(
        &root_update("commenterBody", "COMMENTER SHOULD NOT LAND"),
        "paragraph",
        "0",
    );
    priya.send_update(
        &root_update("commentBody", "Bring the hose"),
        "comment",
        "0",
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[0].root("commentBody") == "Bring the hose" {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the comment never arrived: {:?}",
                editors[0].root("commentBody")
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    let seen = editors[0].joins();
    editors[0].send(&json!({"type": "join"}));
    editors[0].wait_joins(seen + 1).await;
    assert_eq!(editors[0].root("viewerIntrusion"), "");
    assert_eq!(editors[0].root("commenterBody"), "");
    assert_eq!(editors[0].root("commentBody"), "Bring the hose");
    for (id, node) in [("priya", 2usize), ("lars", 1)] {
        let status = cluster
            .request(
                node,
                cluster.person(id),
                reqwest::Method::PUT,
                &format!("/api/drive/items/{item}/content"),
                Some(document("Stolen", &["no"])),
                None,
            )
            .await
            .status();
        assert_eq!(status, 403, "{id} overwrote the shared notes");
    }
}

async fn own_paragraphs_survive_a_burst(
    cluster: &Cluster,
    item: &str,
    editors: &mut Vec<LiveClient>,
) {
    editors.extend(cluster.editors(0, item, &["ravi", "noor"]).await);
    wait_multi(editors).await;
    editors[0].append_paragraph("East bed");
    editors[0].append_paragraph("West bed");
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let texts = editors[0].paragraphs();
        if texts.len() == 4
            && texts[2] == "East bed"
            && texts[3] == "West bed"
            && editors.iter().all(|client| client.paragraphs() == texts)
        {
            break;
        }
        if Instant::now() >= deadline {
            let got: Vec<_> = editors.iter().map(|client| client.paragraphs()).collect();
            panic!("the four beds did not sync: {got:?}");
        }
        sleep(Duration::from_millis(40)).await;
    }
    let labels = ["north", "south", "east", "west"];
    for round in 0..8 {
        let writes = editors.iter().enumerate().map(|(index, client)| {
            let text = format!("{}-{round}", labels[index]);
            async move {
                client.edit_paragraph(index as u32, &text);
            }
        });
        futures::future::join_all(writes).await;
    }
    let expected = ["north-7", "south-7", "east-7", "west-7"];
    wait_paragraphs(editors, &expected).await;
    let late = cluster.connect(0, item, "sam").await;
    assert_eq!(
        late.paragraphs(),
        expected
            .iter()
            .map(|text| (*text).to_owned())
            .collect::<Vec<_>>()
    );
    assert_eq!(late.root("commentBody"), "Bring the hose");
    assert_eq!(late.root("viewerIntrusion"), "");
}

#[tokio::test(flavor = "multi_thread")]
async fn concurrent_clients_converge_across_a_cluster() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;

    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    drop(editors);
    cluster
        .wait_for_text_everywhere(&notes, &["Tomatoes are in", "Beans are staked"])
        .await;

    let mut editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    same_paragraph_merges(&cluster, &notes, &editors).await;
    rejected_writers_leave_the_body(&cluster, &notes, &editors).await;
    own_paragraphs_survive_a_burst(&cluster, &notes, &mut editors).await;
    drop(editors);

    cluster.concurrent_saves_stay_intact().await;
    cluster.heads_match().await;
    cluster.assert_alive();
}

struct MapCase {
    name: &'static str,
    file_name: &'static str,
    marker: &'static str,
    bytes: Vec<u8>,
    map: &'static str,
    unit: &'static str,
    left_key: &'static str,
    right_key: &'static str,
    left: &'static str,
    right: &'static str,
    left_alt: &'static str,
    right_alt: &'static str,
}

async fn maps_converge(cluster: &Cluster, case: &MapCase) {
    let item = cluster
        .publish(case.file_name, case.marker, case.bytes.clone())
        .await;
    let editors = cluster.editors(0, &item, &["maya", "sam"]).await;
    let (left, right) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        let left = put_map(&maya.doc, case.map, case.left_key, case.left);
        let right = put_map(&sam.doc, case.map, case.right_key, case.right);
        (left, right)
    };
    editors[0].send_update(&left, case.unit, case.left_key);
    editors[1].send_update(&right, case.unit, case.right_key);
    wait_entries(
        &editors,
        case.map,
        &[(case.left_key, case.left), (case.right_key, case.right)],
    )
    .await;
    editors[1].send_update(&right, case.unit, case.right_key);
    wait_entries(
        &editors,
        case.map,
        &[(case.left_key, case.left), (case.right_key, case.right)],
    )
    .await;

    let (snapshot, again_left, again_right) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        let snapshot = maya
            .doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let again_left = put_map(&maya.doc, case.map, case.left_key, case.left_alt);
        let again_right = put_map(&sam.doc, case.map, case.left_key, case.right_alt);
        (snapshot, again_left, again_right)
    };
    editors[0].send_update(&again_left, case.unit, case.left_key);
    editors[1].send_update(&again_right, case.unit, case.left_key);
    let referee = Doc::new();
    integrate(&referee, &snapshot).unwrap();
    integrate(&referee, &again_left).unwrap();
    integrate(&referee, &again_right).unwrap();
    let merged = read_map(&referee, case.map, case.left_key).unwrap_or_default();
    wait_entries(
        &editors,
        case.map,
        &[(case.left_key, &merged), (case.right_key, case.right)],
    )
    .await;
    let late = cluster.connect(0, &item, "maya").await;
    assert_eq!(
        late.entry(case.map, case.left_key).as_deref(),
        Some(merged.as_str())
    );
    assert_eq!(
        late.entry(case.map, case.right_key).as_deref(),
        Some(case.right)
    );
    drop(late);

    for round in 0..8 {
        let left = format!("{}-{round}", case.left_key);
        let right = format!("{}-{round}", case.right_key);
        tokio::join!(
            async {
                editors[0].set_entry(case.map, case.left_key, &left, case.unit);
            },
            async {
                editors[1].set_entry(case.map, case.right_key, &right, case.unit);
            },
        );
    }
    let left_final = format!("{}-7", case.left_key);
    let right_final = format!("{}-7", case.right_key);
    wait_entries(
        &editors,
        case.map,
        &[
            (case.left_key, left_final.as_str()),
            (case.right_key, right_final.as_str()),
        ],
    )
    .await;

    let lars = cluster.connect(0, &item, "lars").await;
    assert!(
        lars.accepted(),
        "a viewer was turned away from {}",
        case.name
    );
    assert_eq!(
        lars.entry(case.map, case.left_key),
        editors[0].entry(case.map, case.left_key),
        "{}",
        case.name
    );
    lars.send_update(
        &map_update(case.map, "intrusion", "VIEWER SHOULD NOT LAND"),
        case.unit,
        "intrusion",
    );
    let priya = cluster.connect(0, &item, "priya").await;
    assert!(
        priya.accepted(),
        "a commenter was turned away from {}",
        case.name
    );
    priya.send_update(
        &map_update(case.map, "body", "COMMENTER SHOULD NOT LAND"),
        case.unit,
        "body",
    );
    let seen = editors[0].joins();
    editors[0].send(&json!({"type": "join"}));
    editors[0].wait_joins(seen + 1).await;
    assert_eq!(
        editors[0].entry(case.map, "intrusion"),
        None,
        "{}",
        case.name
    );
    assert_eq!(editors[0].entry(case.map, "body"), None, "{}", case.name);
    drop(lars);
    drop(priya);
    drop(editors);
}

#[tokio::test(flavor = "multi_thread")]
async fn sheets_presentations_and_drawings_converge_across_a_cluster() {
    let mut cluster = Cluster::boot().await;
    let cases = [
        MapCase {
            name: "sheet",
            file_name: "Beds.slsheet",
            marker: "sheet-seed",
            bytes: envelope(
                "sheet",
                "Beds",
                json!({"name": "sheet-seed", "sheets": [{"id": "beds"}]}),
            ),
            map: "cells",
            unit: "cell",
            left_key: "0:0",
            right_key: "1:0",
            left: "\"Tomatoes\"",
            right: "\"Beans\"",
            left_alt: "\"Tomatoes and basil\"",
            right_alt: "\"Tomatoes and dill\"",
        },
        MapCase {
            name: "presentation",
            file_name: "Show.slslides",
            marker: "slide-seed",
            bytes: envelope(
                "slide",
                "Show",
                json!({
                    "title": "slide-seed",
                    "slideOrder": ["s1", "s2"],
                    "slides": {"s1": {"id": "s1"}, "s2": {"id": "s2"}}
                }),
            ),
            map: "slides",
            unit: "slide",
            left_key: "s1",
            right_key: "s2",
            left: "{\"id\":\"s1\",\"title\":\"Tomatoes\"}",
            right: "{\"id\":\"s2\",\"title\":\"Beans\"}",
            left_alt: "{\"id\":\"s1\",\"title\":\"Tomatoes and basil\"}",
            right_alt: "{\"id\":\"s1\",\"title\":\"Tomatoes and dill\"}",
        },
        MapCase {
            name: "drawing",
            file_name: "Plan.sldraw",
            marker: "drawing-seed",
            bytes: envelope(
                "drawing",
                "Plan",
                json!({"format": "svg", "source": "drawing-seed\nline two"}),
            ),
            map: "lines",
            unit: "paragraph",
            left_key: "0",
            right_key: "1",
            left: "rect tomatoes",
            right: "ellipse beans",
            left_alt: "rect tomatoes and basil",
            right_alt: "rect tomatoes and dill",
        },
    ];
    for case in &cases {
        maps_converge(&cluster, case).await;
    }
    cluster.heads_match().await;
    cluster.assert_alive();
}
