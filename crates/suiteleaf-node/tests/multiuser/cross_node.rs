//! An edit saved on one node reaching a room on another node.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::time::sleep;
use yrs::{
    Any, Doc, GetString, ReadTxn, Text, Transact, Xml, XmlElementPrelim, XmlFragment, XmlOut,
    XmlTextPrelim, types::Attrs,
};

use crate::support::*;

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_on_one_node_is_in_the_room_on_another() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    cluster
        .wait_until("the collaboration log reaches another node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            let updates = cluster
                .db(
                    1,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
                && updates.as_array().is_some_and(|rows| !rows.is_empty())
        })
        .await;
    let remote = cluster.connect(1, &notes, "ravi").await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the other node's room showed {:?}, mode {}",
                remote.paragraphs(),
                remote.mode()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn an_open_room_on_another_node_reads_a_later_edit() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    cluster
        .wait_until("the collaboration log reaches another node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
        })
        .await;
    let remote = cluster.connect(1, &notes, "ravi").await;
    let first = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.paragraphs() == first {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the open room started as {:?}", remote.paragraphs());
        }
        sleep(Duration::from_millis(100)).await;
    }
    let before = cluster
        .db(
            1,
            json!({
                "op": "findMany",
                "model": "drive_room_update",
                "where": [{ "field": "itemId", "value": notes }]
            }),
        )
        .await
        .as_array()
        .map(|rows| rows.len())
        .unwrap_or(0);
    editors[0].edit_paragraph(0, "Tomatoes are picked");
    cluster
        .wait_until("the later edit reaches the other node's log", || async {
            let updates = cluster
                .db(
                    1,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            updates.as_array().is_some_and(|rows| rows.len() > before)
        })
        .await;
    let expected = vec![
        "Tomatoes are picked".to_owned(),
        "Beans are staked".to_owned(),
    ];
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the room that was already open showed {:?}, mode {}",
                remote.paragraphs(),
                remote.mode()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn formatted_text_a_table_and_an_image_converge_on_another_node() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    cluster
        .wait_until("the room is multiuser on another node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
        })
        .await;
    let remote = cluster.connect(1, &notes, "ravi").await;
    let update = {
        let maya = editors[0].state.lock().expect("client");
        insert_rich(&maya.doc)
    };
    editors[0].send_update(&update, "paragraph", "rich");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let (sam_rich, remote_rich) = {
            let sam = editors[1].state.lock().expect("client");
            let remote_doc = remote.state.lock().expect("client");
            (rich_snapshot(&sam.doc), rich_snapshot(&remote_doc.doc))
        };
        let ready = |text: &str| {
            text.contains("Keep")
                && text.contains("bold")
                && text.contains("table level=1")
                && text.contains("tableCell")
                && text.contains("Beds")
                && text.contains("image alt=North beds")
                && text.contains("src=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        };
        if ready(&sam_rich) && remote_rich == sam_rich {
            break;
        }
        if Instant::now() >= deadline {
            panic!("the other node showed {remote_rich:?} and the first node showed {sam_rich:?}");
        }
        sleep(Duration::from_millis(100)).await;
    }
    drop(editors);
    drop(remote);
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    cluster
        .wait_until(
            "the saved document on both nodes keeps the formatting, table, and image",
            || async {
                for node in [0, 1] {
                    let Some(bytes) = cluster
                        .read_content(node, cluster.person("maya"), &notes)
                        .await
                    else {
                        return false;
                    };
                    let Ok(file) = serde_json::from_slice::<Value>(&bytes) else {
                        return false;
                    };
                    let saved = file["content"].to_string();
                    if !saved.contains("Keep")
                        || !saved.contains("bold")
                        || !saved.contains("tableCell")
                        || !saved.contains("Beds")
                        || !saved.contains("North beds")
                        || !saved.contains(png)
                    {
                        return false;
                    }
                }
                true
            },
        )
        .await;
    let again = cluster.connect(1, &notes, "ravi").await;
    // A node that already compacted the room hands a lone person a room to seed
    // (or a solo room), and that person opens the saved file checked above.
    if again.mode() == "solo" || again.seed_requested() {
        drop(again);
        cluster.assert_alive();
        return;
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let text = {
            let doc = again.state.lock().expect("client");
            rich_snapshot(&doc.doc)
        };
        if text.contains("Keep")
            && text.contains("bold")
            && text.contains("tableCell")
            && text.contains("Beds")
            && text.contains("image alt=North beds")
            && text.contains(png)
        {
            break;
        }
        if Instant::now() >= deadline {
            panic!("reopening the room showed {text:?}");
        }
        sleep(Duration::from_millis(100)).await;
    }
    drop(again);
    cluster.assert_alive();
}

fn insert_rich(doc: &Doc) -> Vec<u8> {
    let fragment = doc.get_or_insert_xml_fragment("prosemirror");
    let before = doc.transact().state_vector();
    let mut txn = doc.transact_mut();
    let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
    let text = paragraph.push_back(&mut txn, XmlTextPrelim::new("Keep"));
    let mut bold = Attrs::new();
    bold.insert(Arc::from("bold"), Any::Map(Arc::new(HashMap::new())));
    text.format(&mut txn, 0, 4, bold);
    let table = fragment.push_back(&mut txn, XmlElementPrelim::empty("table"));
    table.insert_attribute(&mut txn, "level", "1");
    let row = table.push_back(&mut txn, XmlElementPrelim::empty("tableRow"));
    let cell = row.push_back(&mut txn, XmlElementPrelim::empty("tableCell"));
    cell.push_back(&mut txn, XmlTextPrelim::new("Beds"));
    let image = fragment.push_back(&mut txn, XmlElementPrelim::empty("image"));
    image.insert_attribute(&mut txn, "alt", "North beds");
    image.insert_attribute(
        &mut txn,
        "src",
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    );
    drop(txn);
    doc.transact().encode_state_as_update_v1(&before)
}

fn rich_snapshot(doc: &Doc) -> String {
    let txn = doc.transact();
    let Some(fragment) = txn.get_xml_fragment("prosemirror") else {
        return String::new();
    };
    let mut out = String::new();
    for child in fragment.children(&txn) {
        let XmlOut::Element(element) = child else {
            continue;
        };
        out.push_str(element.tag().as_ref());
        let mut attrs: Vec<_> = element
            .attributes(&txn)
            .map(|(key, value)| format!("{key}={value}"))
            .collect();
        attrs.sort();
        for attr in attrs {
            out.push(' ');
            out.push_str(&attr);
        }
        out.push('\n');
        write_xml_children(&txn, &element, &mut out);
    }
    out
}

fn write_xml_children(txn: &impl ReadTxn, element: &impl XmlFragment, out: &mut String) {
    for grandchild in element.children(txn) {
        match grandchild {
            XmlOut::Text(text) => {
                out.push_str(&text.get_string(txn));
                for chunk in text.diff(txn, |_| ()) {
                    let Some(attributes) = chunk.attributes else {
                        continue;
                    };
                    let mut names: Vec<_> = attributes
                        .keys()
                        .map(|name| name.as_ref().to_owned())
                        .collect();
                    names.sort();
                    for name in names {
                        out.push(' ');
                        out.push_str(&name);
                    }
                }
                out.push('\n');
            }
            XmlOut::Element(child) => {
                out.push_str(child.tag().as_ref());
                out.push('\n');
                write_xml_children(txn, &child, out);
            }
            XmlOut::Fragment(_) => {}
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn simultaneous_joins_see_the_saved_edit() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    cluster
        .wait_until("the saved edit is on the other node", || async {
            let room = cluster
                .db(
                    1,
                    json!({
                        "op": "findOne",
                        "model": "drive_room",
                        "where": [{ "field": "id", "value": notes }]
                    }),
                )
                .await;
            let updates = cluster
                .db(
                    1,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            room["mode"].as_str() == Some("multiuser")
                // The seed reaches this log before either paragraph edit. Wait
                // for all three distinct updates before testing initial joins.
                && updates.as_array().is_some_and(|rows| rows.len() >= 3)
        })
        .await;
    let (ravi, noor) = tokio::join!(
        cluster.connect(1, &notes, "ravi"),
        cluster.connect(1, &notes, "noor"),
    );
    assert_eq!(ravi.paragraphs(), expected);
    assert_eq!(noor.paragraphs(), expected);
    assert_eq!(editors[0].paragraphs(), expected);
    assert_eq!(editors[1].paragraphs(), expected);
    drop(ravi);
    drop(noor);
    drop(editors);
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn joins_before_the_log_arrives_still_see_the_edit() {
    let mut cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let (ravi, noor) = tokio::join!(
        cluster.connect(1, &notes, "ravi"),
        cluster.connect(1, &notes, "noor"),
    );
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    different_paragraphs_converge(&editors).await;
    let expected = vec!["Tomatoes are in".to_owned(), "Beans are staked".to_owned()];
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if ravi.paragraphs() == expected && noor.paragraphs() == expected {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "opened before the log: Ravi showed {:?} and Noor showed {:?}",
                ravi.paragraphs(),
                noor.paragraphs()
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(editors[0].paragraphs(), expected);
    assert_eq!(editors[1].paragraphs(), expected);
    drop(ravi);
    drop(noor);
    drop(editors);
    cluster.assert_alive();
}
