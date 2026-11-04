//! Presentation rooms: selections, objects on two nodes, and a restart.

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::time::sleep;

use crate::support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_slide_selection_reaches_the_other_person_without_changing_the_text() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let editors = cluster.editors(0, &notes, &["maya", "sam"]).await;
    let before = editors[1].paragraphs();
    editors[0].send(&json!({
        "type": "selection",
        "slideId": "secret-value\ns2",
        "elementId": "title",
        "title": "North beds",
        "notes": "Water the beds"
    }));
    editors[0].send(&json!({
        "type": "selection",
        "slideId": "s2",
        "elementId": "title"
    }));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if editors[1].slide_selection() == Some(("Maya".into(), "s2".into(), Some("title".into())))
        {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "Sam did not see Maya's slide: {:?}",
                editors[1].slide_selection()
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    assert_eq!(editors[1].paragraphs(), before);
    assert!(editors[1].caret().is_none());
    assert!(editors[1].sheet_selection().is_none());
    let shown = format!("{:?}", editors[1].slide_selection());
    assert!(!shown.contains("secret-value"));
    assert!(!shown.contains("North beds"));
    assert!(!shown.contains("Water the beds"));
}

#[tokio::test(flavor = "multi_thread")]
async fn two_slide_objects_converge_on_two_nodes_and_reopen() {
    let mut cluster = Cluster::boot().await;
    let item = cluster
        .publish(
            "Beds.slslide",
            "slide-two",
            envelope(
                "slide",
                "Beds",
                json!({
                    "name": "slide-two",
                    "slideOrder": ["s1"],
                    "slides": {
                        "s1": { "id": "s1", "notes": "Water the beds", "elements": [] }
                    }
                }),
            ),
        )
        .await;
    let mut editors = cluster.editors(0, &item, &["maya", "sam"]).await;
    let shell_key = "s1";
    let west_key = "s1\u{1f}a";
    let north_key = "s1\u{1f}b";
    let bad_key = "s1\u{1f}secret-value\nx";
    let shell = r#"{"id":"s1","notes":"Water the beds","elementOrder":["a"]}"#;
    let west = r#"{"id":"a","text":"West"}"#;
    let north = r#"{"id":"b","text":"North"}"#;
    let bad = r#"{"id":"x","text":"secret-value"}"#;
    let (left_shell, left_object, right_object, bad_object) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        (
            put_map(&maya.doc, "slides", shell_key, shell),
            put_map(&maya.doc, "slideElements", west_key, west),
            put_map(&sam.doc, "slideElements", north_key, north),
            put_map(&sam.doc, "slideElements", bad_key, bad),
        )
    };
    editors[0].send_update(&left_shell, "slide", shell_key);
    editors[0].send_update(&left_object, "object", west_key);
    editors[1].send_update(&right_object, "object", north_key);
    editors[1].send_update(&bad_object, "object", bad_key);
    wait_entries(&editors, "slides", &[(shell_key, shell)]).await;
    wait_entries(
        &editors,
        "slideElements",
        &[(west_key, west), (north_key, north)],
    )
    .await;

    let remote = cluster.connect(1, &item, "ravi").await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if remote.entry("slideElements", west_key).as_deref() == Some(west)
            && remote.entry("slideElements", north_key).as_deref() == Some(north)
            && remote.entry("slides", shell_key).as_deref() == Some(shell)
        {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "the other node showed west {:?} north {:?} shell {:?}",
                remote.entry("slideElements", west_key),
                remote.entry("slideElements", north_key),
                remote.entry("slides", shell_key)
            );
        }
        sleep(Duration::from_millis(40)).await;
    }

    drop(editors.remove(0));
    let returned = cluster.connect(0, &item, "maya").await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let back = returned.entry("slideElements", west_key).as_deref() == Some(west)
            && returned.entry("slideElements", north_key).as_deref() == Some(north);
        if back {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "after reconnect Maya showed west {:?} north {:?}",
                returned.entry("slideElements", west_key),
                returned.entry("slideElements", north_key)
            );
        }
        sleep(Duration::from_millis(40)).await;
    }
    drop(editors);
    drop(returned);
    drop(remote);
    cluster
        .wait_until(
            "both slide objects are in the saved presentation",
            || async {
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
                    let notes = &file["content"]["slides"]["s1"]["notes"];
                    let elements = file["content"]["slides"]["s1"]["elements"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    let texts: Vec<_> = elements
                        .iter()
                        .filter_map(|item| item.get("text").and_then(|value| value.as_str()))
                        .collect();
                    if notes != "Water the beds" || texts != ["West", "North"] {
                        return false;
                    }
                }
                true
            },
        )
        .await;
    cluster.assert_alive();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restart_keeps_both_slide_objects_and_the_saved_transition() {
    let mut cluster = Cluster::boot().await;
    let item = cluster
        .publish(
            "Restart.slslides",
            "slide-restart",
            envelope(
                "slide",
                "Restart",
                json!({
                    "name": "slide-restart",
                    "slideOrder": ["s1"],
                    "slides": {
                        "s1": { "id": "s1", "notes": "Water the beds", "elements": [] }
                    }
                }),
            ),
        )
        .await;
    let editors = cluster.editors(0, &item, &["maya", "sam"]).await;
    let shell_key = "s1";
    let west_key = "s1\u{1f}a";
    let north_key = "s1\u{1f}b";
    let bad_key = "s1\u{1f}secret-value\nx";
    let shell = r##"{"id":"s1","notes":"Water the beds","layout":"title-body","background":{"color":"#112233"},"transition":{"type":"fade","duration":0.5},"elementOrder":["a"]}"##;
    let west = r#"{"id":"a","text":"West"}"#;
    let north = r#"{"id":"b","text":"North","animation":"fade","animationOrder":1,"animationTrigger":"click"}"#;
    let bad = r#"{"id":"x","text":"secret-value"}"#;
    let (left_shell, left_object, right_object, bad_object) = {
        let maya = editors[0].state.lock().expect("client");
        let sam = editors[1].state.lock().expect("client");
        (
            put_map(&maya.doc, "slides", shell_key, shell),
            put_map(&maya.doc, "slideElements", west_key, west),
            put_map(&sam.doc, "slideElements", north_key, north),
            put_map(&sam.doc, "slideElements", bad_key, bad),
        )
    };
    editors[0].send_update(&left_shell, "slide", shell_key);
    editors[0].send_update(&left_object, "object", west_key);
    editors[1].send_update(&right_object, "object", north_key);
    editors[1].send_update(&bad_object, "object", bad_key);
    wait_entries(&editors, "slides", &[(shell_key, shell)]).await;
    wait_entries(
        &editors,
        "slideElements",
        &[(west_key, west), (north_key, north)],
    )
    .await;
    cluster
        .wait_until("the slide edit is stored before the node stops", || async {
            let updates = cluster
                .db(
                    0,
                    json!({
                        "op": "findMany",
                        "model": "drive_room_update",
                        "where": [{ "field": "itemId", "value": item }]
                    }),
                )
                .await;
            updates.as_array().is_some_and(|rows| !rows.is_empty())
        })
        .await;
    cluster.restart(0);
    drop(editors);
    let again = cluster.connect(0, &item, "maya").await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let back = again.entry("slideElements", west_key).as_deref() == Some(west)
            && again.entry("slideElements", north_key).as_deref() == Some(north)
            && again.entry("slides", shell_key).as_deref() == Some(shell);
        if back {
            break;
        }
        if Instant::now() >= deadline {
            panic!(
                "after restart Maya showed west {:?} north {:?} shell {:?}",
                again.entry("slideElements", west_key),
                again.entry("slideElements", north_key),
                again.entry("slides", shell_key)
            );
        }
        sleep(Duration::from_millis(100)).await;
    }
    cluster
        .db(
            0,
            json!({
                "op": "deleteMany",
                "model": "drive_presence",
                "where": [{ "field": "itemId", "value": item }]
            }),
        )
        .await;
    drop(again);
    cluster
        .wait_until(
            "the restarted presentation keeps both objects and the fade",
            || async {
                let Some(bytes) = cluster.read_content(0, cluster.person("maya"), &item).await
                else {
                    return false;
                };
                if contains(&bytes, "secret-value") {
                    return false;
                }
                let Ok(file) = serde_json::from_slice::<Value>(&bytes) else {
                    return false;
                };
                let slide = &file["content"]["slides"]["s1"];
                let elements = slide["elements"].as_array().cloned().unwrap_or_default();
                let texts: Vec<_> = elements
                    .iter()
                    .filter_map(|item| item.get("text").and_then(|value| value.as_str()))
                    .collect();
                let north_animation = elements.iter().find_map(|item| {
                    if item.get("text").and_then(|value| value.as_str()) == Some("North") {
                        item.get("animation").and_then(|value| value.as_str())
                    } else {
                        None
                    }
                });
                slide["notes"] == "Water the beds"
                    && slide["layout"] == "title-body"
                    && slide["background"]["color"] == "#112233"
                    && slide["transition"]["type"] == "fade"
                    && slide["transition"]["duration"] == 0.5
                    && texts == ["West", "North"]
                    && north_animation == Some("fade")
            },
        )
        .await;
    cluster.assert_alive();
}
