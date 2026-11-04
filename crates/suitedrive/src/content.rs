//! File bytes: whole saves, resumable upload slices, the storage budget, and reads.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;
use suitedb::{Value, hlc::iso_now};

use crate::{
    Drive, DriveError, DriveResult, Hash, Item, Principal, Role,
    forms::form_without_responses,
    row::{Row, text},
};

pub(crate) struct OpenUpload {
    total: usize,
    bytes: Vec<u8>,
}

pub(crate) fn load_partials(dir: &Path) -> BTreeMap<String, OpenUpload> {
    let mut map = BTreeMap::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return map;
    };
    for entry in entries.flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if id.is_empty()
            || id.len() > 80
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()) else {
            continue;
        };
        if bytes.len() < 8 {
            continue;
        }
        let total = u64::from_le_bytes(bytes[..8].try_into().unwrap_or([0; 8])) as usize;
        let body = bytes[8..].to_vec();
        if total == 0 || total > 256 * 1024 * 1024 || body.len() >= total {
            continue;
        }
        map.insert(id, OpenUpload { total, bytes: body });
    }
    map
}

impl Drive {
    pub(crate) fn head_bytes(&self, row: &Row) -> DriveResult<Option<Vec<u8>>> {
        let Some(version) = text(row, "headVersionId") else {
            return Ok(None);
        };
        let version_row = self
            .db
            .get("drive_version", &version)?
            .ok_or(DriveError::NotFound)?;
        let Some(hash) = text(&version_row, "contentHash") else {
            return Ok(None);
        };
        let hash = hash
            .parse()
            .map_err(|_| DriveError::Other(anyhow::anyhow!("corrupt content hash")))?;
        Ok(self.blobs.get_content(&hash)?)
    }

    /// Save new content. `if_match` is the head version the caller last saw;
    /// a different head means someone else saved first.
    ///
    /// Editors and owners may write any bytes. A responder may write a
    /// `.slform` file only to append responses. Viewers and commenters may
    /// not change file bytes.
    pub fn write(
        &self,
        who: &Principal,
        id: &str,
        if_match: Option<&str>,
        mime: Option<&str>,
        bytes: &[u8],
    ) -> DriveResult<Item> {
        let allowed = match self.role(who, id)? {
            Some(role) if role >= Role::Editor => true,
            Some(Role::Responder) => self.responder_may_append(id, bytes)?,
            _ => false,
        };
        if !allowed {
            return Err(DriveError::Forbidden);
        }
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let head = text(&row, "headVersionId");
        if let Some(expected) = if_match.map(|m| m.trim_matches('"'))
            && expected != "*"
            && Some(expected) != head.as_deref()
        {
            let role = self.role(who, id)?;
            return Err(DriveError::Conflict(Box::new(self.to_item(&row, role)?)));
        }
        self.ensure_room(u64::try_from(bytes.len()).unwrap_or(u64::MAX))?;
        self.commit_bytes(id, &who.id, mime, bytes)?;
        self.get(who, id)
    }

    /// A blank value means there is no budget. A value that is not a whole number is not repeated.
    pub fn storage_budget_from(raw: &str) -> DriveResult<Option<u64>> {
        if raw.trim().is_empty() {
            return Ok(None);
        }
        raw.trim().parse::<u64>().map(Some).map_err(|_| {
            DriveError::BadRequest("The storage budget is not a whole number of bytes.".into())
        })
    }

    pub fn set_storage_budget(&self, budget: Option<u64>) {
        *self.storage_budget.lock().expect("storage budget") = budget;
    }

    fn ensure_room(&self, incoming: u64) -> DriveResult<()> {
        let budget = *self.storage_budget.lock().expect("storage budget");
        let Some(budget) = budget else {
            return Ok(());
        };
        let stored = self.blobs.stored_bytes().map_err(DriveError::Other)?;
        if stored.saturating_add(incoming) > budget {
            return Err(DriveError::NoRoom);
        }
        Ok(())
    }

    /// `bytes start-end/total`, with `end` inclusive. A bad header is none.
    pub fn content_range(header: &str) -> Option<(usize, usize, usize)> {
        let rest = header.trim().strip_prefix("bytes ")?;
        let (range, total_text) = rest.split_once('/')?;
        let (start_text, end_text) = range.split_once('-')?;
        let start = start_text.parse::<usize>().ok()?;
        let end = end_text.parse::<usize>().ok()?;
        let total = total_text.parse::<usize>().ok()?;
        if total == 0 {
            return (start == 0 && end == 0).then_some((0, 0, 0));
        }
        if end < start || end >= total {
            return None;
        }
        Some((start, end, total))
    }

    /// Store one slice of a file. A finished slice becomes a version.
    /// A slice that does not continue the saved part is refused, and that
    /// part stays. The error does not include the slice.
    #[allow(clippy::too_many_arguments)]
    pub fn write_span(
        &self,
        who: &Principal,
        id: &str,
        if_match: Option<&str>,
        mime: Option<&str>,
        start: usize,
        total: usize,
        chunk: &[u8],
    ) -> DriveResult<Option<Item>> {
        let allowed = matches!(self.role(who, id)?, Some(role) if role >= Role::Editor);
        if !allowed {
            return Err(DriveError::Forbidden);
        }
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        self.ensure_room(u64::try_from(total).unwrap_or(u64::MAX))?;
        let head = text(&row, "headVersionId");
        if let Some(expected) = if_match.map(|m| m.trim_matches('"'))
            && expected != "*"
            && Some(expected) != head.as_deref()
        {
            let role = self.role(who, id)?;
            return Err(DriveError::Conflict(Box::new(self.to_item(&row, role)?)));
        }
        if total > 256 * 1024 * 1024 || start > total || chunk.len() > total - start {
            return Err(DriveError::BadRequest(
                "That upload does not continue the saved part.".into(),
            ));
        }
        if total == 0 {
            self.commit_bytes(id, &who.id, mime, &[])?;
            return Ok(Some(self.get(who, id)?));
        }
        let finished = {
            let mut partials = self.partials.lock().expect("uploads");
            if start == 0 {
                partials.insert(
                    id.to_owned(),
                    OpenUpload {
                        total,
                        bytes: chunk.to_vec(),
                    },
                );
            } else {
                let Some(entry) = partials.get_mut(id) else {
                    return Err(DriveError::BadRequest(
                        "That upload does not continue the saved part.".into(),
                    ));
                };
                if entry.total != total || entry.bytes.len() != start {
                    return Err(DriveError::BadRequest(
                        "That upload does not continue the saved part.".into(),
                    ));
                }
                entry.bytes.extend_from_slice(chunk);
            }
            let entry = partials.get(id).expect("upload");
            if entry.bytes.len() < entry.total {
                let copy = OpenUpload {
                    total: entry.total,
                    bytes: entry.bytes.clone(),
                };
                drop(partials);
                self.store_partial(id, &copy);
                return Ok(None);
            }
            partials.remove(id).expect("upload").bytes
        };
        self.clear_partial_file(id);
        self.commit_bytes(id, &who.id, mime, &finished)?;
        Ok(Some(self.get(who, id)?))
    }

    fn store_partial(&self, id: &str, upload: &OpenUpload) {
        let Some(path) = self.partial_path(id) else {
            return;
        };
        let mut bytes = (upload.total as u64).to_le_bytes().to_vec();
        bytes.extend_from_slice(&upload.bytes);
        let _ = fs::write(path, bytes);
    }

    fn clear_partial_file(&self, id: &str) {
        if let Some(path) = self.partial_path(id) {
            let _ = fs::remove_file(path);
        }
    }

    fn partial_path(&self, id: &str) -> Option<PathBuf> {
        if id.is_empty()
            || id.len() > 80
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return None;
        }
        Some(self.partial_dir.join(id))
    }

    pub(crate) fn commit_bytes(
        &self,
        id: &str,
        author_id: &str,
        mime: Option<&str>,
        bytes: &[u8],
    ) -> DriveResult<()> {
        let hash = self.blobs.put_content(bytes).context("store content")?;
        let row = self.item_row(id)?;
        if let Some(head) = text(&row, "headVersionId")
            && let Some(current) = self.db.get("drive_version", &head)?
            && text(&current, "contentHash").as_deref() == Some(hash.to_string().as_str())
        {
            return Ok(());
        }
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        let size = bytes.len() as i64;
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::from(id)),
                    ("contentHash", hash.to_string().into()),
                    ("size", Value::Integer(size)),
                    ("authorId", author_id.to_owned().into()),
                    ("createdAt", now.clone().into()),
                ],
            )?;
            let mut cols = vec![
                ("headVersionId", Value::Text(version.clone())),
                ("size", Value::Integer(size)),
                ("updatedAt", now.clone().into()),
            ];
            if let Some(mime) = mime {
                cols.push(("mime", mime.into()));
            }
            tx.upsert("drive_item", id, cols)
        })?;
        Ok(())
    }

    /// Write file bytes without an If-Match check. Used when a collaboration
    /// room compacts, after the last writer has gone idle.
    pub fn write_head(&self, author_id: &str, id: &str, bytes: &[u8]) -> DriveResult<Item> {
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let hash = self.blobs.put_content(bytes).context("store content")?;
        if let Some(head) = text(&row, "headVersionId")
            && let Some(current) = self.db.get("drive_version", &head)?
            && text(&current, "contentHash").as_deref() == Some(hash.to_string().as_str())
        {
            return self.get(
                &Principal {
                    id: author_id.to_owned(),
                    admin: true,
                },
                id,
            );
        }
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        let size = bytes.len() as i64;
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::from(id)),
                    ("contentHash", hash.to_string().into()),
                    ("size", Value::Integer(size)),
                    ("authorId", author_id.into()),
                    ("createdAt", now.clone().into()),
                ],
            )?;
            tx.upsert(
                "drive_item",
                id,
                [
                    ("headVersionId", Value::Text(version)),
                    ("size", Value::Integer(size)),
                    ("updatedAt", now.into()),
                ],
            )
        })?;
        let role = self.role(
            &Principal {
                id: author_id.to_owned(),
                admin: true,
            },
            id,
        )?;
        self.to_item(&self.item_row(id)?, role)
    }

    /// The item and the bytes of `version` (default: head).
    pub fn read(
        &self,
        who: &Principal,
        id: &str,
        version: Option<&str>,
    ) -> DriveResult<(Item, Vec<u8>)> {
        let item = self.get(who, id)?;
        let hash = self.content_hash(&item, version)?;
        let mut bytes = match hash {
            Some(hash) => self
                .blobs
                .get_content(&hash)?
                .ok_or(DriveError::Unavailable)?,
            None => Vec::new(),
        };
        if item.role == Some(Role::Responder)
            && let Some(redacted) = form_without_responses(&bytes)
        {
            bytes = redacted;
        }
        Ok((item, bytes))
    }

    /// The content hash of an item version, for on-demand fetching.
    pub fn content_hash(&self, item: &Item, version: Option<&str>) -> DriveResult<Option<Hash>> {
        let version = match version {
            Some(v) => {
                let row = self
                    .db
                    .get("drive_version", v)?
                    .ok_or(DriveError::NotFound)?;
                if text(&row, "itemId").as_deref() != Some(item.id.as_str()) {
                    return Err(DriveError::NotFound);
                }
                text(&row, "contentHash")
            }
            None => item.content_hash.clone(),
        };
        version
            .map(|h| {
                h.parse()
                    .map_err(|_| DriveError::Other(anyhow::anyhow!("corrupt content hash")))
            })
            .transpose()
    }
}
