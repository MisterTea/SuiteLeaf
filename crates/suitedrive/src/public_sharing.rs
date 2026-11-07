//! Revocable, read-only capability links. These never grant an anonymous ACL.
use std::collections::BTreeSet;

use serde::Serialize;
use suitedb::Value;

use crate::{
    Drive, DriveError, DriveResult, MAX_DEPTH, Principal, Role,
    row::{int, text},
};

#[derive(Serialize)]
pub struct PublicLink {
    pub allowed: bool,
    pub token: Option<String>,
}

impl Drive {
    pub fn public_sharing_allowed(&self) -> DriveResult<bool> {
        Ok(self
            .db
            .get("drive_setting", "public-sharing")?
            .and_then(|row| text(&row, "value"))
            .as_deref()
            != Some("0"))
    }

    /// Disabling also revokes tokens permanently; enabling cannot revive them.
    pub fn set_public_sharing(&self, who: &Principal, allowed: bool) -> DriveResult<()> {
        if !who.admin {
            return Err(DriveError::Forbidden);
        }
        let _guard = self.public_sharing_lock.lock().unwrap();
        let links = self.db.query("SELECT id FROM drive_public_link", &[])?;
        self.db.transact(|tx| {
            tx.upsert(
                "drive_setting",
                "public-sharing",
                [("value", Value::from(if allowed { "1" } else { "0" }))],
            )?;
            if !allowed {
                for row in &links {
                    if let Some(id) = text(row, "id") {
                        tx.delete("drive_public_link", &id)?;
                    }
                }
            }
            Ok(())
        })?;
        Ok(())
    }

    pub fn public_link(&self, who: &Principal, id: &str) -> DriveResult<PublicLink> {
        self.require(who, id, Role::Viewer)?;
        let allowed = self.public_sharing_allowed()?;
        let token = if allowed {
            self.db
                .get("drive_public_link", id)?
                .and_then(|row| text(&row, "token"))
        } else {
            None
        };
        Ok(PublicLink { allowed, token })
    }

    pub fn create_public_link(&self, who: &Principal, id: &str) -> DriveResult<PublicLink> {
        let _guard = self.public_sharing_lock.lock().unwrap();
        self.require(who, id, Role::Owner)?;
        if !self.public_sharing_allowed()? {
            return Err(DriveError::Forbidden);
        }
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest(
                "Public links are only available for files.".into(),
            ));
        }
        self.check_public_ancestors(id)?;
        if self.public_link(who, id)?.token.is_none() {
            let token = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            self.db.transact(|tx| {
                tx.upsert("drive_public_link", id, [("token", Value::from(token))])
            })?;
        }
        self.public_link(who, id)
    }

    pub fn clear_public_link(&self, who: &Principal, id: &str) -> DriveResult<()> {
        let _guard = self.public_sharing_lock.lock().unwrap();
        self.require(who, id, Role::Owner)?;
        self.db.transact(|tx| tx.delete("drive_public_link", id))?;
        Ok(())
    }

    fn check_public_ancestors(&self, id: &str) -> DriveResult<()> {
        let mut next = Some(id.to_owned());
        let mut seen = BTreeSet::new();
        while let Some(id) = next {
            if !seen.insert(id.clone()) || seen.len() > MAX_DEPTH {
                return Err(DriveError::NotFound);
            }
            let row = self.item_row(&id)?;
            if int(&row, "trashed") != 0 {
                return Err(DriveError::NotFound);
            }
            next = text(&row, "parentId").filter(|id| !id.is_empty());
        }
        Ok(())
    }

    /// Only the current document, without historical content or form responses.
    pub fn public_file(&self, token: &str) -> DriveResult<Vec<u8>> {
        if token.len() != 64
            || !token.bytes().all(|c| c.is_ascii_hexdigit())
            || !self.public_sharing_allowed()?
        {
            return Err(DriveError::NotFound);
        }
        let links = self.db.query(
            "SELECT id FROM drive_public_link WHERE token = ?1",
            &[Value::from(token)],
        )?;
        let id = links
            .first()
            .and_then(|row| text(row, "id"))
            .ok_or(DriveError::NotFound)?;
        self.check_public_ancestors(&id)?;
        let row = self.item_row(&id)?;
        let bytes = self.head_bytes(&row)?.ok_or(DriveError::Unavailable)?;
        public_document(&bytes)
    }
}

fn public_document(bytes: &[u8]) -> DriveResult<Vec<u8>> {
    let mut file: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| DriveError::BadRequest("This file cannot be viewed publicly.".into()))?;
    let object = file.as_object_mut().ok_or(DriveError::NotFound)?;
    object.remove("edits");
    object.remove("versions");
    if object.get("kind").and_then(|v| v.as_str()) == Some("form") {
        if let Some(content) = object.get_mut("content").and_then(|v| v.as_object_mut()) {
            content.insert("responses".into(), serde_json::json!([]));
            if let Some(questions) = content.get_mut("questions").and_then(|v| v.as_array_mut()) {
                for q in questions {
                    if let Some(q) = q.as_object_mut() {
                        q.remove("answer");
                    }
                }
            }
        }
    }
    // Packed media may contain pictures used only in history or form responses.
    // Retain only entries referenced by the remaining document.
    if let Some(mut media) = object.remove("sharedMedia") {
        let mut used = BTreeSet::new();
        media_references(&file, &mut used);
        if let Some(assets) = media.as_array_mut() {
            for (index, asset) in assets.iter_mut().enumerate() {
                if !used.contains(&index) {
                    *asset = serde_json::json!("");
                }
            }
            file.as_object_mut()
                .unwrap()
                .insert("sharedMedia".into(), media);
        }
    }
    serde_json::to_vec(&file).map_err(|e| DriveError::Other(e.into()))
}

fn media_references(value: &serde_json::Value, used: &mut BTreeSet<usize>) {
    match value {
        serde_json::Value::String(s) => {
            if let Some(index) = s.strip_prefix("\0slmedia:").and_then(|s| s.parse().ok()) {
                used.insert(index);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                media_references(value, used);
            }
        }
        serde_json::Value::Object(values) => {
            for value in values.values() {
                media_references(value, used);
            }
        }
        _ => {}
    }
}
