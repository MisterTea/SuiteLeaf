//! Yjs updates and SuiteLeaf file bodies for the tests.

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use yrs::{
    Any, Array, Doc, GetString, Map, Out, ReadTxn, Text, TextPrelim, Transact, Update,
    updates::decoder::Decode,
};

use super::AT;

pub(super) fn transact_update(doc: &Doc, edit: impl FnOnce(&mut yrs::TransactionMut)) -> Vec<u8> {
    let before = doc.transact().state_vector();
    edit(&mut doc.transact_mut());
    doc.transact().encode_state_as_update_v1(&before)
}

pub(crate) fn seed_paragraphs(doc: &Doc, texts: &[&str]) -> Vec<u8> {
    let paragraphs = doc.get_or_insert_array("paragraphs");
    transact_update(doc, |txn| {
        for text in texts {
            let index = paragraphs.len(&*txn);
            paragraphs.insert(txn, index, TextPrelim::new(*text));
        }
    })
}

pub(crate) fn replace_paragraph(doc: &Doc, index: u32, text: &str) -> Vec<u8> {
    let paragraphs = doc.get_or_insert_array("paragraphs");
    transact_update(doc, |txn| {
        while paragraphs.len(&*txn) <= index {
            let at = paragraphs.len(&*txn);
            paragraphs.insert(txn, at, TextPrelim::new(""));
        }
        let Some(Out::YText(block)) = paragraphs.get(&*txn, index) else {
            panic!("paragraph {index} is not text");
        };
        let len = block.len(&*txn);
        if len > 0 {
            block.remove_range(txn, 0, len);
        }
        if !text.is_empty() {
            block.insert(txn, 0, text);
        }
    })
}

pub(crate) fn paragraph_strings(doc: &Doc) -> Vec<String> {
    let txn = doc.transact();
    let Some(array) = txn.get_array("paragraphs") else {
        return Vec::new();
    };
    (0..array.len(&txn))
        .filter_map(|index| match array.get(&txn, index) {
            Some(Out::YText(text)) => Some(text.get_string(&txn)),
            _ => None,
        })
        .collect()
}

pub(super) fn root_text(doc: &Doc, name: &str) -> String {
    let txn = doc.transact();
    txn.get_text(name)
        .map(|text| text.get_string(&txn))
        .unwrap_or_default()
}

pub(crate) fn integrate(doc: &Doc, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() <= 2 {
        return Ok(());
    }
    let update = Update::decode_v1(bytes).map_err(|err| err.to_string())?;
    doc.transact_mut()
        .apply_update(update)
        .map_err(|err| err.to_string())
}

pub(super) fn decode_b64(encoded: &str) -> Vec<u8> {
    STANDARD.decode(encoded).unwrap_or_default()
}

pub(crate) fn root_update(name: &str, text: &str) -> Vec<u8> {
    let doc = Doc::new();
    let root = doc.get_or_insert_text(name);
    transact_update(&doc, |txn| root.insert(txn, 0, text))
}

pub(crate) fn put_map(doc: &Doc, name: &str, key: &str, value: &str) -> Vec<u8> {
    let map = doc.get_or_insert_map(name);
    transact_update(doc, |txn| {
        map.insert(txn, key, value);
    })
}

pub(crate) fn read_map(doc: &Doc, name: &str, key: &str) -> Option<String> {
    let txn = doc.transact();
    let map = txn.get_map(name)?;
    match map.get(&txn, key)? {
        Out::Any(Any::String(text)) => Some(text.to_string()),
        other => Some(format!("{other:?}")),
    }
}

pub(crate) fn map_update(name: &str, key: &str, value: &str) -> Vec<u8> {
    let doc = Doc::new();
    put_map(&doc, name, key, value)
}

pub(crate) fn envelope(kind: &str, title: &str, content: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "format": "suiteleaf",
        "version": 1,
        "id": kind,
        "kind": kind,
        "title": title,
        "createdAt": AT,
        "updatedAt": AT,
        "content": content
    }))
    .unwrap()
}

pub(crate) fn document(title: &str, paragraphs: &[&str]) -> Vec<u8> {
    let content: Vec<_> = paragraphs
        .iter()
        .map(|text| json!({"type": "paragraph", "content": [{"type": "text", "text": text}]}))
        .collect();
    serde_json::to_vec(&json!({
        "format": "suiteleaf",
        "version": 1,
        "id": "notes",
        "kind": "doc",
        "title": title,
        "createdAt": AT,
        "updatedAt": AT,
        "content": {"type": "doc", "content": content}
    }))
    .unwrap()
}

pub(crate) fn contains(bytes: &[u8], text: &str) -> bool {
    bytes
        .windows(text.len())
        .any(|window| window == text.as_bytes())
}
