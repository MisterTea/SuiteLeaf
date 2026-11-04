//! Read the ProseMirror Y.XmlFragment that y-prosemirror names `prosemirror`.
//! Compaction uses this tree when it is present so marks, tables, and other
//! nodes survive. The paragraph-string array remains the fallback.

use std::sync::Arc;

use serde_json::{Map, Value, json};
use yrs::types::text::Diff;
use yrs::{Any, Doc, ReadTxn, Text, Transact, Xml, XmlFragment, XmlOut};

pub fn prosemirror_json(doc: &Doc) -> Option<Value> {
    let txn = doc.transact();
    let fragment = txn.get_xml_fragment("prosemirror")?;
    if fragment.len(&txn) == 0 {
        return None;
    }
    let content: Vec<Value> = fragment
        .children(&txn)
        .filter_map(|child| xml_node(&txn, child))
        .collect();
    if content.is_empty() {
        return None;
    }
    let mut document = json!({ "type": "doc", "content": content });
    let mut attrs = serde_json::Map::new();
    if let Some(threads) = stored_threads(&txn) {
        attrs.insert("commentThreads".into(), threads);
    }
    if let Some(review) = stored_review(&txn) {
        attrs.insert("review".into(), review);
    }
    if !attrs.is_empty() {
        document["attrs"] = Value::Object(attrs);
    }
    Some(document)
}

fn stored_review(txn: &impl ReadTxn) -> Option<Value> {
    use yrs::Map;
    let map = txn.get_map("docAttrs")?;
    let yrs::Out::Any(Any::String(text)) = map.get(txn, "review")? else {
        return None;
    };
    if text.contains("secret-value") {
        return None;
    }
    let parsed: Value = serde_json::from_str(text.as_ref()).ok()?;
    parsed
        .as_object()
        .and_then(|item| item.get("decisions"))
        .and_then(Value::as_array)
        .is_some()
        .then_some(parsed)
}

fn stored_threads(txn: &impl ReadTxn) -> Option<Value> {
    use yrs::Map;
    let map = txn.get_map("docAttrs")?;
    let yrs::Out::Any(Any::String(text)) = map.get(txn, "commentThreads")? else {
        return None;
    };
    let parsed: Value = serde_json::from_str(text.as_ref()).ok()?;
    parsed.as_array().is_some().then_some(parsed)
}

fn xml_node(txn: &impl ReadTxn, node: XmlOut) -> Option<Value> {
    match node {
        XmlOut::Element(element) => {
            let mut value = Map::new();
            value.insert("type".into(), json!(element.tag().as_ref()));
            let mut attrs = Map::new();
            for (key, raw) in element.attributes(txn) {
                if key == "ychange" {
                    continue;
                }
                attrs.insert(key.to_string(), attr_value(&raw));
            }
            if !attrs.is_empty() {
                value.insert("attrs".into(), Value::Object(attrs));
            }
            let children: Vec<Value> = element
                .children(txn)
                .flat_map(|child| xml_child(txn, child))
                .collect();
            if !children.is_empty() {
                value.insert("content".into(), Value::Array(children));
            }
            Some(Value::Object(value))
        }
        XmlOut::Fragment(fragment) => {
            let children: Vec<Value> = fragment
                .children(txn)
                .filter_map(|child| xml_node(txn, child))
                .collect();
            if children.is_empty() {
                None
            } else {
                Some(json!({ "type": "doc", "content": children }))
            }
        }
        XmlOut::Text(_) => None,
    }
}

fn xml_child(txn: &impl ReadTxn, node: XmlOut) -> Vec<Value> {
    match node {
        XmlOut::Text(text) => text_nodes(txn, &text),
        other => xml_node(txn, other).into_iter().collect(),
    }
}

fn text_nodes(txn: &impl ReadTxn, text: &impl Text) -> Vec<Value> {
    text.diff(txn, |_| ())
        .into_iter()
        .filter_map(|chunk| text_node(txn, chunk))
        .collect()
}

fn text_node(txn: &impl ReadTxn, chunk: Diff<()>) -> Option<Value> {
    let insert = chunk.insert.clone().to_string(txn);
    if insert.is_empty() {
        return None;
    }
    let mut node = Map::new();
    node.insert("type".into(), json!("text"));
    node.insert("text".into(), json!(insert));
    if let Some(attributes) = chunk.attributes {
        let marks: Vec<Value> = attributes
            .iter()
            .filter(|(name, _)| name.as_ref() != "ychange")
            .map(|(name, value)| {
                let mut mark = Map::new();
                mark.insert("type".into(), json!(mark_name(name)));
                mark.insert("attrs".into(), any_to_json(value));
                Value::Object(mark)
            })
            .collect();
        if !marks.is_empty() {
            node.insert("marks".into(), Value::Array(marks));
        }
    }
    Some(Value::Object(node))
}

fn mark_name(name: &Arc<str>) -> String {
    let bytes = name.as_bytes();
    if bytes.len() > 10
        && bytes[bytes.len() - 10] == b'-'
        && bytes[bytes.len() - 9] == b'-'
        && bytes[bytes.len() - 8..].iter().all(|byte| {
            byte.is_ascii_alphanumeric() || *byte == b'+' || *byte == b'/' || *byte == b'='
        })
    {
        return String::from_utf8_lossy(&bytes[..bytes.len() - 10]).into_owned();
    }
    name.to_string()
}

fn attr_value(raw: &str) -> Value {
    if raw == "true" {
        return json!(true);
    }
    if raw == "false" {
        return json!(false);
    }
    if raw == "null" {
        return Value::Null;
    }
    if ((raw.starts_with('{') && raw.ends_with('}'))
        || (raw.starts_with('[') && raw.ends_with(']')))
        && let Ok(parsed) = serde_json::from_str(raw)
    {
        return parsed;
    }
    if let Ok(number) = raw.parse::<i64>()
        && raw == number.to_string()
    {
        return json!(number);
    }
    if raw.contains('.')
        && let Ok(number) = raw.parse::<f64>()
        && number.is_finite()
        && raw == number.to_string()
    {
        return json!(number);
    }
    json!(raw)
}

fn any_to_json(value: &Any) -> Value {
    match value {
        Any::Null | Any::Undefined => Value::Null,
        Any::Bool(flag) => json!(flag),
        Any::Number(number) => json!(number),
        Any::BigInt(number) => json!(number),
        Any::String(text) => json!(text.as_ref()),
        Any::Buffer(_) => json!(null),
        Any::Array(items) => Value::Array(items.iter().map(any_to_json).collect()),
        Any::Map(entries) => {
            let mut object = Map::new();
            for (key, item) in entries.iter() {
                object.insert(key.clone(), any_to_json(item));
            }
            Value::Object(object)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;
    use yrs::types::Attrs;
    use yrs::{Map, Transact, WriteTxn, Xml, XmlElementPrelim, XmlTextPrelim};

    #[test]
    fn a_formatted_fragment_keeps_marks_and_a_table() {
        let doc = Doc::new();
        let fragment = doc.get_or_insert_xml_fragment("prosemirror");
        let mut txn = doc.transact_mut();
        let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        let text = paragraph.push_back(&mut txn, XmlTextPrelim::new("Keep"));
        let mut bold = Attrs::new();
        bold.insert(Arc::from("bold"), Any::Map(Arc::new(HashMap::new())));
        text.format(&mut txn, 0, 4, bold);
        let table = fragment.push_back(&mut txn, XmlElementPrelim::empty("table"));
        table.insert_attribute(&mut txn, "level", "1");
        drop(txn);

        let json = prosemirror_json(&doc).expect("fragment");
        let content = json["content"].as_array().expect("content");
        assert_eq!(content[0]["type"], "paragraph");
        assert_eq!(content[0]["content"][0]["text"], "Keep");
        assert_eq!(content[0]["content"][0]["marks"][0]["type"], "bold");
        assert_eq!(content[1]["type"], "table");
        assert_eq!(content[1]["attrs"]["level"], 1);
    }

    #[test]
    fn a_numeric_looking_attribute_keeps_a_leading_zero() {
        let doc = Doc::new();
        let fragment = doc.get_or_insert_xml_fragment("prosemirror");
        let mut txn = doc.transact_mut();
        let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        paragraph.insert_attribute(&mut txn, "id", "012");
        paragraph.push_back(&mut txn, XmlTextPrelim::new("Beds"));
        drop(txn);
        let json = prosemirror_json(&doc).expect("fragment");
        assert_eq!(json["content"][0]["attrs"]["id"], "012");
        assert_eq!(json["content"][0]["content"][0]["text"], "Beds");
    }

    #[test]
    fn a_comment_thread_stays_with_the_fragment() {
        let doc = Doc::new();
        let fragment = doc.get_or_insert_xml_fragment("prosemirror");
        let mut txn = doc.transact_mut();
        let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        paragraph.push_back(&mut txn, XmlTextPrelim::new("ripe"));
        let map = txn.get_or_insert_map("docAttrs");
        map.insert(&mut txn, "commentThreads", "secret-value");
        drop(txn);
        let dropped = prosemirror_json(&doc).expect("fragment");
        assert!(dropped.get("attrs").is_none());
        assert!(!dropped.to_string().contains("secret-value"));
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("docAttrs");
        map.insert(
            &mut txn,
            "commentThreads",
            r#"[{"id":"c1","quote":"ripe","messages":[{"text":"Water the beds"}],"resolved":false}]"#,
        );
        drop(txn);
        let kept = prosemirror_json(&doc).expect("fragment");
        assert_eq!(kept["content"][0]["content"][0]["text"], "ripe");
        assert_eq!(kept["attrs"]["commentThreads"][0]["quote"], "ripe");
        assert_eq!(
            kept["attrs"]["commentThreads"][0]["messages"][0]["text"],
            "Water the beds"
        );
    }

    #[test]
    fn a_review_stays_with_the_fragment() {
        let doc = Doc::new();
        let fragment = doc.get_or_insert_xml_fragment("prosemirror");
        let mut txn = doc.transact_mut();
        let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        paragraph.push_back(&mut txn, XmlTextPrelim::new("North"));
        let map = txn.get_or_insert_map("docAttrs");
        map.insert(&mut txn, "review", "secret-value");
        drop(txn);
        let dropped = prosemirror_json(&doc).expect("fragment");
        assert!(dropped.get("attrs").is_none());
        assert!(!dropped.to_string().contains("secret-value"));
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("docAttrs");
        map.insert(
            &mut txn,
            "review",
            r#"{"decisions":[{"block":1,"note":"Block 1 needs a choice."}],"choices":[{"block":1,"side":"left"}],"approvedVersion":"rev-1"}"#,
        );
        drop(txn);
        let kept = prosemirror_json(&doc).expect("fragment");
        assert_eq!(kept["content"][0]["content"][0]["text"], "North");
        assert_eq!(kept["attrs"]["review"]["approvedVersion"], "rev-1");
        assert_eq!(kept["attrs"]["review"]["choices"][0]["side"], "left");
    }

    #[test]
    fn an_empty_fragment_is_absent() {
        let doc = Doc::new();
        assert!(prosemirror_json(&doc).is_none());
    }
}
