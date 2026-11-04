//! Writing a room's Yjs document back into the saved SuiteLeaf file.

use anyhow::Context;
use serde_json::{Value, json};

use super::Touch;

fn embedded_image_src(node: &Value) -> bool {
    let src = node
        .get("attrs")
        .and_then(|attrs| attrs.get("src"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let lower = src.to_ascii_lowercase();
    lower.starts_with("data:image/png;base64,")
        || lower.starts_with("data:image/jpeg;base64,")
        || lower.starts_with("data:image/gif;base64,")
        || lower.starts_with("data:image/webp;base64,")
        || lower.starts_with("data:image/svg+xml;base64,")
}

/// A picture whose source is embedded data stays, including those bytes.
/// A source that is only a file name is removed so the saved file can still open.
fn keep_embedded_images(node: &mut Value) {
    let Some(nodes) = node
        .get_mut("content")
        .and_then(|value| value.as_array_mut())
    else {
        return;
    };
    nodes.retain(|child| {
        let kind = child
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if kind != "image" && kind != "inlineImage" {
            return true;
        }
        embedded_image_src(child)
    });
    for child in nodes {
        keep_embedded_images(child);
    }
}

pub(super) fn compact_bytes(
    bytes: &[u8],
    paragraphs: &[String],
    rich: Option<&Value>,
    touches: &[Touch],
    at: &str,
) -> anyhow::Result<Vec<u8>> {
    let mut file: Value = serde_json::from_slice(bytes).context("file json")?;
    let before = file.get("content").cloned().unwrap_or(Value::Null);
    let mut content = before.clone();
    if let Some(rich) = rich {
        content = rich.clone();
        keep_embedded_images(&mut content);
    } else {
        apply_paragraphs(&mut content, paragraphs);
    }
    let regions = changed_paragraphs(&before, &content);
    let mut edits = file
        .get("edits")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut versions = file
        .get("versions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut through = String::new();
    let mut last_by = json!({ "id": "local", "name": "You" });
    if regions.is_empty() && before != content {
        let id = uuid::Uuid::now_v7().to_string();
        through = id.clone();
        edits.push(json!({
            "id": id,
            "at": at,
            "by": last_by,
            "op": { "kind": "region", "unit": "paragraph", "key": "0" }
        }));
    }
    for key in regions {
        let matched: Vec<&Touch> = touches
            .iter()
            .filter(|touch| touch.unit == "paragraph" && touch.key == key)
            .collect();
        let authors: Vec<&Touch> = if matched.is_empty() {
            touches.iter().rev().take(1).collect()
        } else {
            matched
        };
        let mut seen = std::collections::BTreeSet::new();
        for touch in authors {
            if !seen.insert(touch.user_id.clone()) {
                continue;
            }
            let id = uuid::Uuid::now_v7().to_string();
            through = id.clone();
            last_by = json!({ "id": touch.user_id, "name": touch.name });
            edits.push(json!({
                "id": id,
                "at": touch.at,
                "by": last_by,
                "op": { "kind": "region", "unit": "paragraph", "key": key }
            }));
        }
    }
    if !through.is_empty() {
        versions.push(json!({
            "id": uuid::Uuid::now_v7().to_string(),
            "at": at,
            "by": last_by,
            "summary": "Edited a paragraph",
            "title": file.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled"),
            "throughEdit": through,
            "content": content
        }));
    }
    if content == before && through.is_empty() {
        return Ok(bytes.to_vec());
    }
    file["content"] = content;
    file["updatedAt"] = json!(at);
    if !edits.is_empty() {
        file["edits"] = Value::Array(edits);
    }
    if !versions.is_empty() {
        file["versions"] = Value::Array(versions);
    }
    Ok(serde_json::to_vec(&file)?)
}

fn apply_paragraphs(content: &mut Value, paragraphs: &[String]) {
    let mut index = 0;
    fn walk(node: &mut Value, paragraphs: &[String], index: &mut usize) {
        let Some(kind) = node.get("type").and_then(|v| v.as_str()) else {
            return;
        };
        if kind == "paragraph" || kind == "heading" {
            if let Some(text) = paragraphs.get(*index) {
                node["content"] = if text.is_empty() {
                    json!([])
                } else {
                    json!([{ "type": "text", "text": text }])
                };
            }
            *index += 1;
            return;
        }
        if let Some(children) = node.get_mut("content").and_then(|v| v.as_array_mut()) {
            for child in children {
                walk(child, paragraphs, index);
            }
        }
    }
    walk(content, paragraphs, &mut index);
}

fn changed_paragraphs(before: &Value, after: &Value) -> Vec<String> {
    let left = paragraph_list(before);
    let right = paragraph_list(after);
    let count = left.len().max(right.len());
    let mut keys = Vec::new();
    for index in 0..count {
        if left.get(index) != right.get(index) {
            keys.push(index.to_string());
        }
    }
    keys
}

fn paragraph_list(content: &Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(node: &Value, out: &mut Vec<String>) {
        let Some(kind) = node.get("type").and_then(|v| v.as_str()) else {
            return;
        };
        if kind == "paragraph" || kind == "heading" {
            let text = node
                .get("content")
                .and_then(|v| v.as_array())
                .map(|parts| {
                    parts
                        .iter()
                        .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                        .collect::<String>()
                })
                .unwrap_or_default();
            if !text.trim().is_empty() {
                out.push(text);
            }
            return;
        }
        if let Some(children) = node.get("content").and_then(|v| v.as_array()) {
            for child in children {
                walk(child, out);
            }
        }
    }
    walk(content, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compaction_keeps_both_paragraphs_and_skips_the_yjs_log() {
        let file = br#"{
            "format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes",
            "createdAt":"2026-10-13T18:00:00.000Z","updatedAt":"2026-10-13T18:00:00.000Z",
            "content":{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"One"}]},
                {"type":"paragraph","content":[{"type":"text","text":"Two"}]}
            ]}
        }"#;
        let touches = vec![
            Touch {
                user_id: "maya".into(),
                name: "Maya".into(),
                at: "2026-10-13T18:05:00.000Z".into(),
                unit: "paragraph".into(),
                key: "0".into(),
            },
            Touch {
                user_id: "sam".into(),
                name: "Sam".into(),
                at: "2026-10-13T18:06:00.000Z".into(),
                unit: "paragraph".into(),
                key: "1".into(),
            },
        ];
        let next = compact_bytes(
            file,
            &["One more".into(), "Two more".into()],
            None,
            &touches,
            "2026-10-13T18:30:00.000Z",
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&next).unwrap();
        let texts = paragraph_list(value.get("content").unwrap());
        assert_eq!(texts, vec!["One more", "Two more"]);
        assert_eq!(value["edits"].as_array().unwrap().len(), 2);
        assert_eq!(value["versions"].as_array().unwrap().len(), 1);
        assert!(!String::from_utf8_lossy(&next).contains("yjs"));
    }

    #[test]
    fn an_unchanged_compact_keeps_the_saved_time() {
        let file = br#"{
            "format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes",
            "createdAt":"2026-10-13T18:00:00.000Z","updatedAt":"2026-10-13T18:00:00.000Z",
            "content":{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"One"}]},
                {"type":"paragraph","content":[{"type":"text","text":"Two"}]}
            ]}
        }"#;
        let same = compact_bytes(
            file,
            &["One".into(), "Two".into()],
            None,
            &[],
            "2099-01-01T00:00:00.000Z",
        )
        .unwrap();
        assert_eq!(same, file);
        let changed = compact_bytes(
            file,
            &["One more".into(), "Two".into()],
            None,
            &[],
            "2026-11-03T00:00:00.000Z",
        )
        .unwrap();
        let again = compact_bytes(
            &changed,
            &["One more".into(), "Two".into()],
            None,
            &[],
            "secret-value",
        )
        .unwrap();
        assert_eq!(again, changed);
        assert!(!String::from_utf8_lossy(&again).contains("secret-value"));
        assert!(String::from_utf8_lossy(&changed).contains("2026-11-03T00:00:00.000Z"));
    }

    #[test]
    fn compaction_keeps_embedded_image_bytes_and_drops_a_file_name() {
        let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let file = br#"{
            "format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes",
            "createdAt":"2026-10-13T18:00:00.000Z","updatedAt":"2026-10-13T18:00:00.000Z",
            "content":{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"One"}]}
            ]}
        }"#;
        let rich = json!({
            "type": "doc",
            "content": [
                {"type":"paragraph","content":[{"type":"text","text":"One"}]},
                {"type":"image","attrs":{"alt":"North beds","src": png}},
                {"type":"image","attrs":{"alt":"Missing","src":"bed.png"}}
            ]
        });
        let next = compact_bytes(
            file,
            &["One".into()],
            Some(&rich),
            &[],
            "2026-10-31T12:00:00.000Z",
        )
        .unwrap();
        let saved = String::from_utf8(next).unwrap();
        assert!(saved.contains(png));
        assert!(!saved.contains("bed.png"));
        assert!(saved.contains("North beds"));
        assert!(!saved.contains("Missing"));
    }
}
