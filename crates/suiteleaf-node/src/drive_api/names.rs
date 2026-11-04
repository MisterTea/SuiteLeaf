//! Editor and author names added to item and version responses.

use serde_json::{Value as JsonValue, json};
use std::collections::BTreeMap;
use suitedb::{Db, Value};
use suitedrive::{DriveError, Item, Version};

use crate::http::AppState;

use super::{ApiError, ApiResult};

fn display_name(row: &BTreeMap<String, Value>) -> Option<String> {
    match row.get("name") {
        Some(Value::Text(name)) if !name.trim().is_empty() => Some(name.clone()),
        _ => match row.get("email") {
            Some(Value::Text(email)) if !email.trim().is_empty() => Some(email.clone()),
            _ => None,
        },
    }
}

fn names_for(db: &Db, ids: &[String]) -> BTreeMap<String, String> {
    let mut names = BTreeMap::new();
    for id in ids {
        if id.is_empty() || names.contains_key(id) {
            continue;
        }
        let name = db
            .get("user", id)
            .ok()
            .flatten()
            .and_then(|row| display_name(&row))
            .unwrap_or_else(|| "Former member".into());
        names.insert(id.clone(), name);
    }
    names
}

pub(super) fn author_names(db: &Db, versions: &[Version]) -> BTreeMap<String, String> {
    let ids: Vec<String> = versions.iter().map(|v| v.author_id.clone()).collect();
    names_for(db, &ids)
}

fn author_ids(value: &JsonValue) -> Vec<String> {
    let mut ids = Vec::new();
    let rows = value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(std::slice::from_ref(value));
    for row in rows {
        if let Some(id) = row
            .get("lastAuthorId")
            .and_then(|v| v.as_str())
            .filter(|id| !id.is_empty())
            && !ids.iter().any(|existing| existing == id)
        {
            ids.push(id.to_owned());
        }
    }
    ids
}

fn insert_editor_name(row: &mut JsonValue, names: &BTreeMap<String, String>) {
    let Some(object) = row.as_object_mut() else {
        return;
    };
    let Some(id) = object
        .get("lastAuthorId")
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
    else {
        return;
    };
    let name = names
        .get(id)
        .cloned()
        .unwrap_or_else(|| "Former member".into());
    object.insert("lastAuthorName".into(), JsonValue::String(name));
}

/// The display name version history uses for the head version's author.
pub(super) async fn with_editor_names(
    state: &AppState,
    mut payload: JsonValue,
) -> ApiResult<JsonValue> {
    let ids = author_ids(&payload);
    if ids.is_empty() {
        return Ok(payload);
    }
    let db = state.db.clone();
    let names = tokio::task::spawn_blocking(move || names_for(&db, &ids))
        .await
        .map_err(|e| ApiError(DriveError::Other(e.into())))?;
    if let Some(rows) = payload.as_array_mut() {
        for row in rows {
            insert_editor_name(row, &names);
        }
    } else {
        insert_editor_name(&mut payload, &names);
    }
    Ok(payload)
}

pub(super) async fn item_body(state: &AppState, item: &Item) -> ApiResult<JsonValue> {
    let payload = serde_json::to_value(item).map_err(|e| ApiError(DriveError::Other(e.into())))?;
    with_editor_names(state, payload).await
}

pub(super) fn version_json(version: &Version, names: &BTreeMap<String, String>) -> JsonValue {
    let mut value = serde_json::to_value(version).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "authorName".into(),
            JsonValue::String(
                names
                    .get(&version.author_id)
                    .cloned()
                    .unwrap_or_else(|| "Former member".into()),
            ),
        );
    }
    value
}
