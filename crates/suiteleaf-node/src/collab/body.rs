//! The shared document body: its paragraphs and a plain snapshot for comparison.

use anyhow::Context;
use yrs::{Array, Doc, GetString, ReadTxn, Transact, Update, updates::decoder::Decode};

pub(super) fn paragraph_texts(doc: &Doc) -> Vec<String> {
    let txn = doc.transact();
    let Some(arr) = txn.get_array("paragraphs") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for index in 0..arr.len(&txn) {
        if let Some(yrs::Out::YText(text)) = arr.get(&txn, index) {
            out.push(text.get_string(&txn));
        }
    }
    out
}

/// A comment label is not enough. The update is applied on a copy first.
/// Paragraphs, the ProseMirror fragment, and the sheet, slide, and drawing
/// maps must stay as they are. A comment stored as its own text may change.
pub(super) fn body_changed(doc: &Doc, bytes: &[u8]) -> anyhow::Result<bool> {
    let before = body_snapshot(doc);
    let probe = Doc::new();
    let state = doc
        .transact()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    if state.len() > 2 {
        probe
            .transact_mut()
            .apply_update(Update::decode_v1(&state).context("decode room")?)
            .context("copy room")?;
    }
    probe
        .transact_mut()
        .apply_update(Update::decode_v1(bytes).context("decode Yjs update")?)
        .context("probe update")?;
    Ok(body_snapshot(&probe) != before)
}

pub(super) fn body_snapshot(doc: &Doc) -> String {
    use yrs::Map;
    let paragraphs = paragraph_texts(doc).join("\u{1f}");
    let rich = crate::collab_rich::prosemirror_json(doc)
        .map(|value| value.to_string())
        .unwrap_or_default();
    let txn = doc.transact();
    let mut maps = String::new();
    for name in ["cells", "slides", "lines"] {
        let Some(map) = txn.get_map(name) else {
            continue;
        };
        let mut rows: Vec<String> = map
            .iter(&txn)
            .map(|(key, value)| format!("{key}={}", shared_plain(&txn, &value, 0)))
            .collect();
        rows.sort();
        maps.push_str(name);
        maps.push('\n');
        maps.push_str(&rows.join("\n"));
    }
    if let Some(map) = txn.get_map("docAttrs") {
        let mut rows: Vec<String> = map
            .iter(&txn)
            .filter(|(key, _)| *key != "commentThreads")
            .map(|(key, value)| format!("{key}={}", shared_plain(&txn, &value, 0)))
            .collect();
        if !rows.is_empty() {
            rows.sort();
            maps.push_str("docAttrs\n");
            maps.push_str(&rows.join("\n"));
        }
    }
    let mut extra = Vec::new();
    for (name, value) in txn.root_refs() {
        if matches!(
            name,
            "cells" | "slides" | "lines" | "docAttrs" | "prosemirror"
        ) {
            continue;
        }
        match value {
            yrs::Out::YMap(map) => {
                let mut rows: Vec<String> = map
                    .iter(&txn)
                    .map(|(key, value)| format!("{key}={}", shared_plain(&txn, &value, 0)))
                    .collect();
                rows.sort();
                extra.push(format!("{name}\n{}", rows.join("\n")));
            }
            yrs::Out::YArray(arr) => {
                let mut parts = Vec::new();
                for index in 0..arr.len(&txn) {
                    if let Some(value) = arr.get(&txn, index) {
                        parts.push(shared_plain(&txn, &value, 0));
                    }
                }
                extra.push(format!("{name}=[{}]", parts.join(",")));
            }
            // A comment is its own text root. The document body is the paragraph
            // list, the ProseMirror fragment, and the sheet, slide, and drawing maps.
            yrs::Out::YText(_) | yrs::Out::YXmlText(_) => {}
            yrs::Out::YXmlFragment(fragment) => {
                extra.push(format!("{name}={}", xml_plain(&txn, &fragment)))
            }
            yrs::Out::YXmlElement(element) => {
                extra.push(format!("{name}={}", xml_plain(&txn, &element)))
            }
            yrs::Out::UndefinedRef(ptr) => {
                use yrs::Map;
                let map_empty = yrs::MapRef::from(ptr).iter(&txn).next().is_none();
                let words = yrs::TextRef::from(ptr).get_string(&txn);
                // A text root shows up here before its type is integrated.
                // That is how a comment is stored. A map or list is still compared.
                if map_empty && !words.is_empty() {
                    continue;
                }
                extra.push(format!("{name}={}", branch_plain(&txn, ptr, 0)));
            }
            other => extra.push(format!("{name}={}", shared_plain(&txn, &other, 0))),
        }
    }
    extra.sort();
    format!("{paragraphs}\n{rich}\n{maps}\n{}", extra.join("\n"))
}

fn shared_plain(txn: &impl yrs::ReadTxn, value: &yrs::Out, depth: u8) -> String {
    use yrs::Map;
    if depth > 8 {
        return "other".into();
    }
    match value {
        yrs::Out::Any(any) => format!("{any:?}"),
        yrs::Out::YText(text) => text.get_string(txn),
        yrs::Out::YXmlText(text) => text.get_string(txn),
        yrs::Out::YXmlFragment(fragment) => xml_plain(txn, fragment),
        yrs::Out::YXmlElement(element) => xml_plain(txn, element),
        yrs::Out::YMap(map) => {
            let mut rows: Vec<String> = map
                .iter(txn)
                .map(|(key, nested)| format!("{key}={}", shared_plain(txn, &nested, depth + 1)))
                .collect();
            rows.sort();
            rows.join(",")
        }
        yrs::Out::YArray(arr) => {
            let mut parts = Vec::new();
            for index in 0..arr.len(txn) {
                if let Some(nested) = arr.get(txn, index) {
                    parts.push(shared_plain(txn, &nested, depth + 1));
                }
            }
            format!("[{}]", parts.join(","))
        }
        yrs::Out::YDoc(_) => "doc".into(),
        yrs::Out::UndefinedRef(ptr) => branch_plain(txn, *ptr, depth),
    }
}

fn branch_plain<P>(txn: &impl yrs::ReadTxn, ptr: P, depth: u8) -> String
where
    P: Copy,
    yrs::MapRef: From<P>,
    yrs::ArrayRef: From<P>,
    yrs::TextRef: From<P>,
    yrs::XmlTextRef: From<P>,
{
    use yrs::{Array, Map};
    let mut parts = Vec::new();
    let map = yrs::MapRef::from(ptr);
    let mut rows: Vec<String> = map
        .iter(txn)
        .map(|(key, nested)| format!("{key}={}", shared_plain(txn, &nested, depth + 1)))
        .collect();
    rows.sort();
    if !rows.is_empty() {
        parts.push(rows.join(","));
    }
    let list = yrs::ArrayRef::from(ptr);
    let mut items = Vec::new();
    for index in 0..list.len(txn) {
        if let Some(nested) = list.get(txn, index) {
            items.push(shared_plain(txn, &nested, depth + 1));
        }
    }
    if !items.is_empty() {
        parts.push(format!("[{}]", items.join(",")));
    }
    let words = yrs::TextRef::from(ptr).get_string(txn);
    if !words.is_empty() {
        parts.push(words.clone());
    }
    let xml = yrs::XmlTextRef::from(ptr).get_string(txn);
    if !xml.is_empty() && xml != words {
        parts.push(xml);
    }
    if parts.is_empty() {
        "other".into()
    } else {
        parts.join(" ")
    }
}

fn xml_plain(txn: &impl yrs::ReadTxn, node: &impl yrs::XmlFragment) -> String {
    let mut out = String::new();
    for child in node.children(txn) {
        match child {
            yrs::XmlOut::Text(text) => out.push_str(&text.get_string(txn)),
            yrs::XmlOut::Element(element) => {
                out.push_str(element.tag().as_ref());
                out.push('\n');
                out.push_str(&xml_plain(txn, &element));
            }
            yrs::XmlOut::Fragment(fragment) => out.push_str(&xml_plain(txn, &fragment)),
        }
    }
    out
}
