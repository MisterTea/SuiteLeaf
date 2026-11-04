//! The shared slide maps of a presentation room.

use anyhow::Context;
use serde_json::{Value, json};
use yrs::Doc;

use super::sheet_room::map_strings;

#[derive(PartialEq)]
pub(super) struct SlideRoom {
    slides: Vec<(String, String)>,
    elements: Vec<(String, String)>,
    order: Option<String>,
    removed: Vec<String>,
    master: Option<String>,
}

pub(super) fn slide_room(doc: &Doc) -> SlideRoom {
    let order = map_strings(doc, "slideOrder")
        .into_iter()
        .find(|(key, _)| key == "order")
        .map(|(_, value)| value);
    let master = map_strings(doc, "deck")
        .into_iter()
        .find(|(key, _)| key == "master")
        .map(|(_, value)| value);
    SlideRoom {
        slides: map_strings(doc, "slides"),
        elements: map_strings(doc, "slideElements"),
        order,
        removed: map_strings(doc, "slideRemoved")
            .into_iter()
            .filter(|(_, value)| value == "1")
            .map(|(id, _)| id)
            .collect(),
        master,
    }
}

fn slide_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && !id.chars().any(|c| c.is_control())
}

/// Write the shared slide maps into a presentation file. A spreadsheet is left alone.
pub(super) fn apply_slide_room(bytes: &[u8], room: &SlideRoom) -> anyhow::Result<Option<Vec<u8>>> {
    if room.slides.is_empty()
        && room.elements.is_empty()
        && room.order.is_none()
        && room.removed.is_empty()
        && room.master.is_none()
    {
        return Ok(None);
    }
    let mut file: Value = serde_json::from_slice(bytes).context("file json")?;
    let original = file.clone();
    if file.get("kind").and_then(|value| value.as_str()) != Some("slide") {
        return Ok(None);
    }
    let Some(content) = file
        .pointer_mut("/content")
        .and_then(|value| value.as_object_mut())
    else {
        return Ok(None);
    };
    let slides = content
        .entry("slides")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .context("slides")?;
    for (id, json) in &room.slides {
        if !slide_id_ok(id) {
            continue;
        }
        let Ok(mut shell) = serde_json::from_str::<Value>(json) else {
            continue;
        };
        let Some(shell_object) = shell.as_object_mut() else {
            continue;
        };
        let order = shell_object
            .remove("elementOrder")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();
        let mut bodies = std::collections::BTreeMap::new();
        for (key, body_json) in &room.elements {
            let Some((slide, element)) = key.split_once('\u{1f}') else {
                continue;
            };
            if slide != id || !slide_id_ok(element) {
                continue;
            }
            let Ok(body) = serde_json::from_str::<Value>(body_json) else {
                continue;
            };
            bodies.insert(element.to_owned(), body);
        }
        let mut list = Vec::new();
        for item in order {
            let Some(element) = item.as_str() else {
                continue;
            };
            if let Some(body) = bodies.remove(element) {
                list.push(body);
            }
        }
        list.extend(bodies.into_values());
        shell_object.insert("elements".into(), Value::Array(list));
        slides.insert(id.clone(), shell);
    }
    for id in &room.removed {
        slides.remove(id);
    }
    if let Some(order_json) = &room.order
        && let Ok(Value::Array(items)) = serde_json::from_str::<Value>(order_json)
    {
        let mut ids = Vec::new();
        for item in items {
            let Some(id) = item.as_str() else {
                continue;
            };
            if room.removed.iter().any(|removed| removed == id) || !slides.contains_key(id) {
                continue;
            }
            if !ids.iter().any(|seen: &String| seen == id) {
                ids.push(id.to_owned());
            }
        }
        content.insert("slideOrder".into(), json!(ids));
    }
    if let Some(master_json) = &room.master
        && let Ok(master) = serde_json::from_str::<Value>(master_json)
        && master.is_object()
    {
        content.insert("master".into(), master);
    }
    if file == original {
        return Ok(Some(bytes.to_vec()));
    }
    Ok(Some(serde_json::to_vec(&file).context("slide json")?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compaction_writes_slide_notes_objects_and_master_into_the_saved_file() {
        let file = br#"{
            "format":"suiteleaf","version":1,"id":"f","kind":"slide","title":"Show",
            "createdAt":"2026-11-03T15:00:00.000Z","updatedAt":"2026-11-03T15:00:00.000Z",
            "content":{"slideOrder":["s1","s3"],"slides":{"s1":{"id":"s1","elements":[]},"s3":{"id":"s3","title":"Gone","elements":[]}}}
        }"#;
        let picture = "data:image/png;base64,iVBORw0KGgo=";
        let room = SlideRoom {
            slides: vec![
                (
                    "s1".into(),
                    r#"{"id":"s1","title":"Beds","notes":"Water the beds","comments":[{"id":"thread-1","elementId":"pic"}],"elementOrder":["pic"]}"#.into(),
                ),
                ("s2".into(), r#"{"id":"s2","title":"North","elementOrder":[]}"#.into()),
            ],
            elements: vec![(
                "s1\u{1f}pic".into(),
                format!(r#"{{"id":"pic","type":"image","src":"{picture}","alt":"North beds"}}"#),
            )],
            order: Some(r#"["s2","s1","s3"]"#.into()),
            removed: vec!["s3".into()],
            master: Some(format!(r#"{{"elements":[{{"id":"logo","src":"{picture}"}}]}}"#)),
        };
        let next = apply_slide_room(file, &room).unwrap().expect("slide file");
        let value: Value = serde_json::from_slice(&next).unwrap();
        assert_eq!(value["content"]["slides"]["s1"]["notes"], "Water the beds");
        assert_eq!(
            value["content"]["slides"]["s1"]["comments"][0]["id"],
            "thread-1"
        );
        assert_eq!(
            value["content"]["slides"]["s1"]["elements"][0]["src"],
            picture
        );
        assert_eq!(value["content"]["slides"]["s2"]["title"], "North");
        assert!(value["content"]["slides"].get("s3").is_none());
        assert_eq!(value["content"]["slideOrder"], json!(["s2", "s1"]));
        assert_eq!(value["content"]["master"]["elements"][0]["src"], picture);
        assert!(!String::from_utf8_lossy(&next).contains("secret-value"));
        let sheet = br#"{"kind":"sheet","content":{"workbook":{"sheets":{}}}}"#;
        assert!(apply_slide_room(sheet, &room).unwrap().is_none());
    }

    #[test]
    fn an_unchanged_slide_keeps_the_saved_bytes() {
        let file = br#"{"format":"suiteleaf","version":1,"id":"f","kind":"slide","title":"Show","createdAt":"2026-11-03T15:00:00.000Z","updatedAt":"2026-11-03T15:00:00.000Z","content":{"slideOrder":["s1"],"slides":{"s1":{"id":"s1","elements":[]}}}}"#;
        let same = SlideRoom {
            slides: vec![("s1".into(), r#"{"id":"s1","elementOrder":[]}"#.into())],
            elements: vec![],
            order: Some(r#"["s1"]"#.into()),
            removed: vec![],
            master: None,
        };
        let kept = apply_slide_room(file, &same).unwrap().expect("slide");
        assert_eq!(kept, file);
        let changed = SlideRoom {
            slides: vec![(
                "s1".into(),
                r#"{"id":"s1","title":"West","elementOrder":[]}"#.into(),
            )],
            elements: vec![],
            order: Some(r#"["s1"]"#.into()),
            removed: vec![],
            master: None,
        };
        let next = apply_slide_room(file, &changed).unwrap().expect("slide");
        assert_ne!(next, file);
        assert!(String::from_utf8_lossy(&next).contains("West"));
        assert!(!String::from_utf8_lossy(&next).contains("secret-value"));
    }
}
