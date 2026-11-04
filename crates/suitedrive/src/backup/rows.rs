//! Row helpers shared by the restores: copied columns, accounts, and comments.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::Result;
use suitedb::Value;

pub(super) fn owner_ids(rows: &[BTreeMap<String, Value>]) -> BTreeSet<String> {
    rows.iter()
        .filter_map(|row| text_of(row, "ownerId"))
        .filter(|id| !id.is_empty())
        .collect()
}

pub(super) fn missing_accounts(
    archive: &suitedb::Db,
    live: &suitedb::Db,
    grants: &[BTreeMap<String, Value>],
    owners: &BTreeSet<String>,
) -> Result<Vec<BTreeMap<String, Value>>> {
    let has_user = |db: &suitedb::Db| db.schema().tables.iter().any(|table| table.name == "user");
    if !has_user(archive) || !has_user(live) {
        return Ok(Vec::new());
    }
    let mut wanted = grants
        .iter()
        .filter(|row| text_of(row, "principalType").as_deref() == Some("user"))
        .filter_map(|row| text_of(row, "principalId"))
        .collect::<BTreeSet<_>>();
    wanted.extend(owners.iter().cloned());
    let mut accounts = Vec::new();
    for row in archive.query("SELECT * FROM user", &[])? {
        let Some(id) = text_of(&row, "id") else {
            continue;
        };
        if !wanted.contains(&id) {
            continue;
        }
        if live.get("user", &id)?.is_some() {
            continue;
        }
        accounts.push(row);
    }
    Ok(accounts)
}

pub(super) fn folder_rows(
    items: &[BTreeMap<String, Value>],
    folder_id: &str,
) -> Vec<BTreeMap<String, Value>> {
    let mut chosen = Vec::new();
    let mut pending = vec![folder_id.to_owned()];
    while let Some(id) = pending.pop() {
        for row in items {
            if text_of(row, "id").as_deref() != Some(id.as_str()) {
                continue;
            }
            chosen.push(row.clone());
            for child in items {
                if text_of(child, "parentId").as_deref() == Some(id.as_str())
                    && let Some(child_id) = text_of(child, "id")
                {
                    pending.push(child_id);
                }
            }
        }
    }
    chosen
}

pub(super) fn secret_column(key: &str) -> bool {
    let folded = key.to_ascii_lowercase().replace(['-', '_'], "");
    folded.contains("password")
        || folded.contains("passwd")
        || folded.contains("secret")
        || folded.contains("token")
        || folded.contains("authorization")
        || folded.contains("apikey")
        || folded.contains("credential")
        || folded.contains("privatekey")
}

pub(super) fn account_columns(row: &BTreeMap<String, Value>) -> Vec<(String, Value)> {
    columns(row)
        .into_iter()
        .filter(|(key, _)| !secret_column(key))
        .collect()
}

/// Comments on the named items whose ids are not already in the live database.
pub(super) fn missing_comments(
    archive: &suitedb::Db,
    live: &suitedb::Db,
    item_ids: &BTreeSet<String>,
) -> Result<Vec<BTreeMap<String, Value>>> {
    let live_ids = live
        .query("SELECT id FROM drive_comment", &[])?
        .into_iter()
        .filter_map(|row| text_of(&row, "id"))
        .collect::<BTreeSet<_>>();
    Ok(archive
        .query("SELECT * FROM drive_comment", &[])?
        .into_iter()
        .filter(|row| text_of(row, "itemId").is_some_and(|id| item_ids.contains(&id)))
        .filter(|row| text_of(row, "id").is_some_and(|id| !live_ids.contains(&id)))
        .collect())
}

pub(super) fn columns(row: &BTreeMap<String, Value>) -> Vec<(String, Value)> {
    row.iter()
        .filter(|(key, _)| key.as_str() != "id")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

pub(super) fn text_of(row: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::Text(text)) => Some(text.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_passwd_column_is_not_copied() {
        assert!(secret_column("passwd"));
        assert!(secret_column("password"));
        assert!(!secret_column("name"));
        assert!(!secret_column("email"));
    }
}
