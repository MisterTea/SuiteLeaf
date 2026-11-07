use super::*;

impl Drive {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn write_cloud_span(
        &self,
        who: &Principal,
        id: &str,
        expected: Option<&str>,
        mime: Option<&str>,
        start: usize,
        total: usize,
        chunk: &[u8],
    ) -> DriveResult<Option<Item>> {
        if !matches!(self.role(who,id)?,Some(role) if role>=Role::Editor) {
            return Err(DriveError::Forbidden);
        }
        if total > 1024 * 1024 * 1024
            || chunk.len() > 1024 * 1024
            || start.checked_add(chunk.len()).is_none_or(|n| n > total)
        {
            return Err(DriveError::BadRequest("Invalid upload range.".into()));
        }
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let head = text(&row, "headVersionId");
        if let Some(expected) = expected.map(|s| s.trim_matches('"'))
            && expected != "*"
            && head.as_deref() != Some(expected)
        {
            return Err(DriveError::Conflict(Box::new(self.get(who, id)?)));
        }
        let upload = self.db.get("drive_upload", id)?;
        let offset = upload
            .as_ref()
            .and_then(|r| r.get("offset"))
            .and_then(|v| {
                if let Value::Integer(n) = v {
                    Some(*n as usize)
                } else {
                    None
                }
            })
            .unwrap_or(0);
        if let Some(upload) = &upload {
            let previous = upload.get("total");
            if text(upload, "ownerId").as_deref() != Some(&who.id)
                || previous != Some(&Value::Integer(total as i64))
                || text(upload, "baseVersion") != head
            {
                return Err(DriveError::BadRequest(
                    "That upload does not continue the saved part.".into(),
                ));
            }
        }
        let chunk_id = format!("{id}:{start}");
        let accepted = if start < offset {
            let stored = self.db.get("drive_upload_chunk", &chunk_id)?;
            if stored.as_ref().and_then(|r| r.get("bytes")) != Some(&Value::Blob(chunk.to_vec())) {
                return Err(DriveError::BadRequest(
                    "That upload does not continue the saved part.".into(),
                ));
            }
            offset
        } else {
            if start != offset || (chunk.is_empty() && total != 0) {
                return Err(DriveError::BadRequest(
                    "That upload does not continue the saved part.".into(),
                ));
            }
            let accepted = start + chunk.len();
            self.db.transact(|tx| {
                tx.upsert(
                    "drive_upload_chunk",
                    &chunk_id,
                    [
                        ("itemId", id.into()),
                        ("offset", Value::Integer(start as i64)),
                        ("bytes", Value::Blob(chunk.to_vec())),
                    ],
                )?;
                tx.upsert(
                    "drive_upload",
                    id,
                    [
                        ("ownerId", who.id.clone().into()),
                        ("total", Value::Integer(total as i64)),
                        ("offset", Value::Integer(accepted as i64)),
                        (
                            "baseVersion",
                            head.clone().map(Value::Text).unwrap_or(Value::Null),
                        ),
                        ("mime", mime.map(Value::from).unwrap_or(Value::Null)),
                    ],
                )
            })?;
            accepted
        };
        if accepted < total {
            return Ok(None);
        }
        let parts = self.db.query(
            "SELECT id, bytes FROM drive_upload_chunk WHERE itemId=?1 ORDER BY offset",
            &[id.into()],
        )?;
        let mut bytes = Vec::with_capacity(total);
        for part in &parts {
            if let Some(Value::Blob(body)) = part.get("bytes") {
                bytes.extend_from_slice(body)
            }
        }
        if bytes.len() != total {
            return Err(DriveError::Unavailable);
        }
        self.ensure_room(total as u64)?;
        self.commit_bytes(id, &who.id, mime, &bytes)?;
        self.db.transact(|tx| {
            for part in parts {
                if let Some(chunk_id) = text(&part, "id") {
                    tx.delete("drive_upload_chunk", &chunk_id)?;
                }
            }
            tx.delete("drive_upload", id)
        })?;
        Ok(Some(self.get(who, id)?))
    }
}
