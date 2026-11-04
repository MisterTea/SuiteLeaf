//! Comments stored beside a file, separate from its content.

use serde::Serialize;
use suitedb::{Value, hlc::iso_now};

use crate::{Drive, DriveError, DriveResult, Principal, Role, row::text};

/// A comment stored beside a file, separate from the file's content.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriveComment {
    pub id: String,
    pub item_id: String,
    pub author_id: String,
    pub body: String,
    pub created_at: String,
}

impl Drive {
    /// Comments on an item. Viewers can read them; writing is [`add_comment`].
    pub fn comments(&self, who: &Principal, id: &str) -> DriveResult<Vec<DriveComment>> {
        self.require(who, id, Role::Viewer)?;
        Ok(self
            .db
            .query(
                "SELECT * FROM drive_comment WHERE itemId = ?1 ORDER BY createdAt, id",
                &[Value::Text(id.into())],
            )?
            .into_iter()
            .map(|r| DriveComment {
                id: text(&r, "id").unwrap_or_default(),
                item_id: text(&r, "itemId").unwrap_or_default(),
                author_id: text(&r, "authorId").unwrap_or_default(),
                body: text(&r, "body").unwrap_or_default(),
                created_at: text(&r, "createdAt").unwrap_or_default(),
            })
            .collect())
    }

    /// Add a comment. Commenters and every higher role may do this. Changing
    /// the file itself still requires an editor (`write` returns forbidden),
    /// except a responder appending form responses.
    pub fn add_comment(&self, who: &Principal, id: &str, body: &str) -> DriveResult<DriveComment> {
        self.require(who, id, Role::Commenter)?;
        let body = body.trim();
        if body.is_empty() || body.len() > 8_000 {
            return Err(DriveError::BadRequest(
                "Write a comment of 1–8000 characters.".into(),
            ));
        }
        let comment_id = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_comment",
                &comment_id,
                [
                    ("itemId", Value::from(id)),
                    ("authorId", who.id.clone().into()),
                    ("body", body.into()),
                    ("createdAt", now.clone().into()),
                ],
            )
        })?;
        Ok(DriveComment {
            id: comment_id,
            item_id: id.to_owned(),
            author_id: who.id.clone(),
            body: body.to_owned(),
            created_at: now,
        })
    }
}
