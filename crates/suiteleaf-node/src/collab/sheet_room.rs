//! The shared worksheet maps of a spreadsheet room.

use anyhow::Context;
use serde_json::{Value, json};
use yrs::{Doc, ReadTxn, Transact};

/// Replace paragraph text in a SuiteLeaf file and append one edit per person
/// per changed paragraph, plus one version. The raw Yjs log is not stored.
pub(super) struct SheetRoom {
    cells: Vec<(String, String)>,
    names: Vec<(String, String)>,
    ranges: Vec<(String, String)>,
    rules: Vec<(String, String)>,
    charts: Vec<(String, String)>,
    removed_charts: Vec<String>,
    comments: Vec<(String, String)>,
    merges: Vec<(String, String)>,
    sizes: Vec<(String, String)>,
}

pub(super) fn map_strings(doc: &Doc, name: &str) -> Vec<(String, String)> {
    use yrs::Map;
    let txn = doc.transact();
    let Some(map) = txn.get_map(name) else {
        return Vec::new();
    };
    map.iter(&txn)
        .filter_map(|(key, value)| match value {
            yrs::Out::Any(yrs::Any::String(text)) => Some((key.to_string(), text.to_string())),
            _ => None,
        })
        .collect()
}

pub(super) fn sheet_room(doc: &Doc) -> SheetRoom {
    SheetRoom {
        cells: map_strings(doc, "cells"),
        names: map_strings(doc, "sheetNames"),
        ranges: map_strings(doc, "namedRanges"),
        rules: map_strings(doc, "validationRules"),
        charts: map_strings(doc, "charts"),
        removed_charts: map_strings(doc, "removedCharts")
            .into_iter()
            .map(|(id, _)| id)
            .collect(),
        comments: map_strings(doc, "sheetComments"),
        merges: map_strings(doc, "merges"),
        sizes: map_strings(doc, "sheetSizes"),
    }
}

fn sheet_key(key: &str) -> Option<(String, String, String)> {
    let mut parts = key.split('\u{1f}');
    let sheet = parts.next()?;
    let row = parts.next()?;
    let column = parts.next()?;
    if parts.next().is_some() || sheet.is_empty() || !row.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if !column.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((sheet.to_owned(), row.to_owned(), column.to_owned()))
}

/// Write the shared sheet maps into a spreadsheet file. A document is left alone.
pub(super) fn apply_sheet_room(bytes: &[u8], room: &SheetRoom) -> anyhow::Result<Option<Vec<u8>>> {
    if room.cells.is_empty()
        && room.names.is_empty()
        && room.ranges.is_empty()
        && room.rules.is_empty()
        && room.charts.is_empty()
        && room.removed_charts.is_empty()
        && room.comments.is_empty()
        && room.merges.is_empty()
        && room.sizes.is_empty()
    {
        return Ok(None);
    }
    let mut file: Value = serde_json::from_slice(bytes).context("file json")?;
    let original = file.clone();
    if file.get("kind").and_then(|value| value.as_str()) != Some("sheet") {
        return Ok(None);
    }
    let Some(sheets) = file
        .pointer_mut("/content/workbook/sheets")
        .and_then(|value| value.as_object_mut())
    else {
        return Ok(None);
    };
    for (key, json) in &room.cells {
        let Some((sheet_id, row, column)) = sheet_key(key) else {
            continue;
        };
        let Ok(cell) = serde_json::from_str::<Value>(json) else {
            continue;
        };
        let sheet = sheets.entry(sheet_id.clone()).or_insert_with(|| {
            json!({
                "id": sheet_id,
                "name": "Sheet",
                "rowCount": 200,
                "columnCount": 20,
                "cellData": {}
            })
        });
        if !sheet
            .get("cellData")
            .and_then(|value| value.as_object())
            .is_some()
        {
            sheet["cellData"] = json!({});
        }
        let grid = sheet["cellData"].as_object_mut().expect("cell data");
        let line = grid.entry(row).or_insert_with(|| json!({}));
        if !line.is_object() {
            *line = json!({});
        }
        line.as_object_mut().expect("row").insert(column, cell);
    }
    for (sheet_id, name) in &room.names {
        if name.is_empty() || name.chars().any(|c| c.is_control()) || name.len() > 31 {
            continue;
        }
        if let Some(sheet) = sheets.get_mut(sheet_id) {
            sheet["name"] = json!(name);
        }
    }
    for (sheet_id, json) in &room.merges {
        if let Ok(value) = serde_json::from_str::<Value>(json)
            && let Some(sheet) = sheets.get_mut(sheet_id)
        {
            sheet["mergeData"] = value;
        }
    }
    for (key, json) in &room.sizes {
        let mut parts = key.split('\u{1f}');
        let Some(sheet_id) = parts.next() else {
            continue;
        };
        let Some(axis) = parts.next() else { continue };
        let Some(index) = parts.next() else { continue };
        if parts.next().is_some() || !index.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let Ok(size) = serde_json::from_str::<Value>(json) else {
            continue;
        };
        if !size.is_number() {
            continue;
        }
        let Some(sheet) = sheets.get_mut(sheet_id) else {
            continue;
        };
        let field = if axis == "row" {
            "rowData"
        } else {
            "columnData"
        };
        let prop = if axis == "row" { "h" } else { "w" };
        if !sheet
            .get(field)
            .and_then(|value| value.as_object())
            .is_some()
        {
            sheet[field] = json!({});
        }
        let line = sheet[field].as_object_mut().expect("size table");
        let entry = line.entry(index).or_insert_with(|| json!({}));
        if !entry.is_object() {
            *entry = json!({});
        }
        entry
            .as_object_mut()
            .expect("size")
            .insert(prop.to_owned(), size);
    }
    let Some(workbook) = file.pointer_mut("/content/workbook") else {
        return Ok(None);
    };
    let mut ranges = serde_json::Map::new();
    for (id, json) in &room.ranges {
        if let Ok(value) = serde_json::from_str::<Value>(json) {
            ranges.insert(id.clone(), value);
        }
    }
    if !ranges.is_empty() {
        workbook["namedRanges"] = Value::Object(ranges);
    }
    let mut rules = serde_json::Map::new();
    for (id, json) in &room.rules {
        if let Ok(value) = serde_json::from_str::<Value>(json) {
            rules.insert(id.clone(), value);
        }
    }
    if !rules.is_empty() {
        workbook["dataValidation"] = Value::Object(rules);
    }
    let mut comments = serde_json::Map::new();
    for (id, json) in &room.comments {
        if let Ok(value) = serde_json::from_str::<Value>(json) {
            comments.insert(id.clone(), value);
        }
    }
    if !comments.is_empty() {
        workbook["sheetComments"] = Value::Object(comments);
    }
    for (key, _) in &room.cells {
        if let Some((sheet_id, _, _)) = sheet_key(key) {
            let order = workbook
                .get_mut("sheetOrder")
                .and_then(|value| value.as_array_mut());
            if let Some(order) = order {
                let present = order
                    .iter()
                    .any(|value| value.as_str() == Some(sheet_id.as_str()));
                if !present {
                    order.push(json!(sheet_id));
                }
            }
        }
    }
    if let Some(content) = file
        .get_mut("content")
        .and_then(|value| value.as_object_mut())
    {
        let mut list = content
            .get("charts")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        list.retain(|chart| {
            chart
                .get("id")
                .and_then(|value| value.as_str())
                .map(|id| !room.removed_charts.iter().any(|removed| removed == id))
                .unwrap_or(true)
        });
        for (id, json) in &room.charts {
            let Ok(chart) = serde_json::from_str::<Value>(json) else {
                continue;
            };
            if let Some(found) = list
                .iter_mut()
                .find(|item| item.get("id").and_then(|value| value.as_str()) == Some(id))
            {
                *found = chart;
            } else {
                list.push(chart);
            }
        }
        if !list.is_empty() || !room.removed_charts.is_empty() {
            content.insert("charts".into(), Value::Array(list));
        }
    }
    if file == original {
        return Ok(Some(bytes.to_vec()));
    }
    Ok(Some(serde_json::to_vec(&file).context("sheet json")?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compaction_writes_sheet_cells_into_the_saved_file() {
        let file = br#"{
            "format":"suiteleaf","version":1,"id":"f","kind":"sheet","title":"Beds",
            "createdAt":"2026-11-03T15:00:00.000Z","updatedAt":"2026-11-03T15:00:00.000Z",
            "content":{"workbook":{"id":"wb","sheetOrder":["fees"],"sheets":{"fees":{"id":"fees","name":"Sheet1","rowCount":100,"columnCount":20,"cellData":{}}}}}
        }"#;
        let room = SheetRoom {
            cells: vec![("fees\u{1f}0\u{1f}0".into(), r#"{"v":"North"}"#.into())],
            names: vec![("fees".into(), "Fees".into())],
            ranges: vec![(
                "fees-total".into(),
                r#"{"name":"Total","formula":"=A2","sheetId":"fees"}"#.into(),
            )],
            rules: vec![(
                "fees\u{1f}whole".into(),
                r#"{"id":"whole","type":"whole"}"#.into(),
            )],
            charts: vec![(
                "dues".into(),
                r#"{"id":"dues","title":"Dues","sheetId":"fees"}"#.into(),
            )],
            removed_charts: vec![],
            comments: vec![(
                "note-1".into(),
                r#"{"sheetId":"fees","body":{"id":"note-1","text":"Water the beds"}}"#.into(),
            )],
            merges: vec![(
                "fees".into(),
                r#"[{"startRow":0,"endRow":1,"startColumn":0,"endColumn":1}]"#.into(),
            )],
            sizes: vec![("fees\u{1f}column\u{1f}0".into(), "120".into())],
        };
        let next = apply_sheet_room(file, &room).unwrap().expect("sheet file");
        let value: Value = serde_json::from_slice(&next).unwrap();
        assert_eq!(
            value["content"]["workbook"]["sheets"]["fees"]["name"],
            "Fees"
        );
        assert_eq!(
            value["content"]["workbook"]["sheets"]["fees"]["cellData"]["0"]["0"]["v"],
            "North"
        );
        assert_eq!(
            value["content"]["workbook"]["namedRanges"]["fees-total"]["formula"],
            "=A2"
        );
        assert_eq!(
            value["content"]["workbook"]["dataValidation"]["fees\u{1f}whole"]["type"],
            "whole"
        );
        assert_eq!(value["content"]["charts"][0]["title"], "Dues");
        assert_eq!(
            value["content"]["workbook"]["sheetComments"]["note-1"]["body"]["text"],
            "Water the beds"
        );
        assert_eq!(
            value["content"]["workbook"]["sheets"]["fees"]["mergeData"][0]["endRow"],
            1
        );
        assert_eq!(
            value["content"]["workbook"]["sheets"]["fees"]["columnData"]["0"]["w"],
            120
        );
        assert!(!String::from_utf8_lossy(&next).contains("secret-value"));
        let document = br#"{"kind":"doc","content":{"type":"doc"}}"#;
        assert!(apply_sheet_room(document, &room).unwrap().is_none());
    }

    #[test]
    fn an_unchanged_sheet_cell_keeps_the_saved_bytes() {
        let file = br#"{"format":"suiteleaf","version":1,"id":"f","kind":"sheet","title":"Beds","createdAt":"2026-11-03T15:00:00.000Z","updatedAt":"2026-11-03T15:00:00.000Z","content":{"workbook":{"id":"wb","sheetOrder":["fees"],"sheets":{"fees":{"id":"fees","name":"Fees","rowCount":100,"columnCount":20,"cellData":{"0":{"0":{"v":"North"}}}}}}}}"#;
        let same = SheetRoom {
            cells: vec![("fees\u{1f}0\u{1f}0".into(), r#"{"v":"North"}"#.into())],
            names: vec![("fees".into(), "Fees".into())],
            ranges: vec![],
            rules: vec![],
            charts: vec![],
            removed_charts: vec![],
            comments: vec![],
            merges: vec![],
            sizes: vec![],
        };
        let kept = apply_sheet_room(file, &same).unwrap().expect("sheet");
        assert_eq!(kept, file);
        let changed = SheetRoom {
            cells: vec![("fees\u{1f}0\u{1f}0".into(), r#"{"v":"West"}"#.into())],
            names: vec![("fees".into(), "Fees".into())],
            ranges: vec![],
            rules: vec![],
            charts: vec![],
            removed_charts: vec![],
            comments: vec![],
            merges: vec![],
            sizes: vec![],
        };
        let next = apply_sheet_room(file, &changed).unwrap().expect("sheet");
        assert_ne!(next, file);
        assert!(String::from_utf8_lossy(&next).contains("West"));
        assert!(!String::from_utf8_lossy(&next).contains("secret-value"));
    }
}
