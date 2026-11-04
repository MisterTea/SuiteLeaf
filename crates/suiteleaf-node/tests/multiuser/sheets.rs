//! Spreadsheet rooms: selections, worksheets on two nodes, and the saved file.

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::time::sleep;

use crate::support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_sheet_selection_reaches_the_other_person_without_changing_the_text() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let before = editors[1].paragraphs();
    editors[0].send(&json!({
        "type": "selection",
        "sheetId": "secret-value\nfees",
        "startRow": 0,
        "startColumn": 0,
        "endRow": 1,
        "endColumn": 1,
        "text": "North"
    }));
    editors[0].send(&json!({
        "type": "selection",
        "sheetId": "fees",
        "startRow": 0,
        "startColumn": 0,
        "endRow": 1,
        "endColumn": 1
    }));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[1].sheet_selection() == Some(("Maya".into(), "fees".into(), 0, 0, 1, 1)) {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "Sam did not see Maya's range: {:?}",
                editors[1].sheet_selection()
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    assert_eq!(editors[1].paragraphs(), before);
    assert!(editors[1].caret().is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn two_worksheets_converge_on_two_nodes_and_after_reconnect() {
    let mut cluster = Cluster::boot().await;
    let item = cluster
        .publish(
            "Plots.slsheet",
            "sheet-two",
            envelope(
                "sheet",
                "Plots",
                json!({
                    "name": "sheet-two",
                    "workbook": {
                        "sheetOrder": ["fees", "beds"],
                        "sheets": {
                            "fees": { "id": "fees", "name": "Fees" },
                            "beds": { "id": "beds", "name": "Beds" }
                        }
                    }
                }),
            ),
        )
        .await;
    let mut editors = cluster.editors(0, &item, &["maya", "sam"]).await;
    let fees = "fees\u{1f}0\u{1f}0";
    let beds = "beds\u{1f}0\u{1f}0";
    let north = r#"{"v":"North"}"#;
    let west = r#"{"v":"West"}"#;
    let (left, right) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        (
            put_map(&maya.doc, "cells", fees, north),
            put_map(&sam.doc, "cells", beds, west),
        )
    };
    editors[0].send_update(&left, "cell", fees);
    editors[1].send_update(&right, "cell", beds);
    wait_entries(&editors, "cells", &[(fees, north), (beds, west)]).await;

    let remote = cluster.connect(1, &item, "ravi").await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.entry("cells", fees).as_deref() == Some(north)
            && remote.entry("cells", beds).as_deref() == Some(west)
        {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the other node showed fees {:?} and beds {:?}",
                remote.entry("cells", fees),
                remote.entry("cells", beds)
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    assert_ne!(remote.entry("cells", fees), remote.entry("cells", beds));

    drop(editors.remove(0));
    let fees_a2 = "fees\u{1f}1\u{1f}0";
    let formula = r#"{"f":"=A1"}"#;
    let later = {
        let sam = editors[0].state.lock().expect("client");
        put_map(&sam.doc, "cells", fees_a2, formula)
    };
    editors[0].send_update(&later, "cell", fees_a2);
    let returned = cluster.connect(0, &item, "maya").await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let back = returned.entry("cells", fees).as_deref() == Some(north)
            && returned.entry("cells", beds).as_deref() == Some(west)
            && returned.entry("cells", fees_a2).as_deref() == Some(formula)
            && editors[0].entry("cells", fees_a2).as_deref() == Some(formula);
        if back {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "after reconnect Maya showed fees {:?} beds {:?} A2 {:?}, Sam showed A2 {:?}",
                returned.entry("cells", fees),
                returned.entry("cells", beds),
                returned.entry("cells", fees_a2),
                editors[0].entry("cells", fees_a2)
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    let stored = format!(
        "{:?}{:?}{:?}",
        returned.entry("cells", fees),
        returned.entry("cells", beds),
        returned.entry("cells", fees_a2)
    );
    assert!(!stored.contains("secret-value"));
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sheet_room_writes_both_worksheets_into_the_file() {
    let mut cluster = Cluster::boot().await;
    let item = cluster
        .publish(
            "Saved.slsheet",
            "sheet-saved",
            envelope(
                "sheet",
                "Saved",
                json!({
                    "name": "sheet-saved",
                    "workbook": {
                        "sheetOrder": ["fees", "beds"],
                        "sheets": {
                            "fees": { "id": "fees", "name": "Fees", "cellData": {} },
                            "beds": { "id": "beds", "name": "Beds", "cellData": {} }
                        }
                    }
                }),
            ),
        )
        .await;
    let editors = cluster.editors(0, &item, &["maya", "sam"]).await;
    let fees = "fees\u{1f}0\u{1f}0";
    let beds = "beds\u{1f}0\u{1f}0";
    let north = r#"{"v":"North"}"#;
    let west = r#"{"v":"West"}"#;
    let (left, right) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        (
            put_map(&maya.doc, "cells", fees, north),
            put_map(&sam.doc, "cells", beds, west),
        )
    };
    editors[0].send_update(&left, "cell", fees);
    editors[1].send_update(&right, "cell", beds);
    wait_entries(&editors, "cells", &[(fees, north), (beds, west)]).await;
    drop(editors);
    cluster
        .wait_until("both worksheets are in the saved spreadsheet", || async {
            for node in [0, 1] {
                let Some(bytes) = cluster
                    .read_content(node, cluster.person("maya"), &item)
                    .await
                else {
                    return false;
                };
                if contains(&bytes, "secret-value") {
                    return false;
                }
                let Ok(file) = serde_json::from_slice::<Value>(&bytes) else {
                    return false;
                };
                let fees_cell =
                    &file["content"]["workbook"]["sheets"]["fees"]["cellData"]["0"]["0"]["v"];
                let beds_cell =
                    &file["content"]["workbook"]["sheets"]["beds"]["cellData"]["0"]["0"]["v"];
                if fees_cell != "North" || beds_cell != "West" {
                    return false;
                }
            }
            true
        })
        .await;
    cluster.assert_alive();
}
