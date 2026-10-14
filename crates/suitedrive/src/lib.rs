//! SuiteDrive: files replicated to every node.
//!
//! File bytes live in a content-addressed [`BlobStore`]; names, folders,
//! versions, and sharing live in SuiteDB tables, so metadata replicates with
//! the rest of the database. When a `drive_version` row arrives from a peer,
//! its blobs are queued and fetched over `/suiteleaf/drive/blob/1`.
//!
//! Every saved version is kept. If two nodes save the same file
//! concurrently, last-writer-wins picks the head version, and the other
//! version stays available in the file's history.

pub mod blobs;

use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;
use suitedb::{ColumnType, Db, TableDef, Value, hlc::iso_now};
use tokio::sync::Notify;

pub use blobs::{BlobStore, CHUNK_SIZE, Hash, Manifest};

/// Bump when the drive tables change.
pub const SCHEMA_VERSION: u32 = 4;
const MAX_BLOB_RESPONSE: usize = 24 * 1024 * 1024;
const MAX_DEPTH: usize = 64;

pub fn tables() -> Vec<TableDef> {
    use ColumnType::*;
    vec![
        TableDef::new("drive_item", "id")
            .column("parentId", Text)
            .column("name", Text)
            .column("kind", Text)
            .column("ownerId", Text)
            .column("mime", Text)
            .column("size", Integer)
            .column("headVersionId", Text)
            .column("createdAt", Text)
            .column("updatedAt", Text)
            .column("trashed", Integer)
            .index("parentId")
            .index("ownerId"),
        TableDef::new("drive_version", "id")
            .column("itemId", Text)
            .column("contentHash", Text)
            .column("size", Integer)
            .column("authorId", Text)
            .column("createdAt", Text)
            .column("name", Text)
            .column("restoredFrom", Text)
            .index("itemId")
            .index("contentHash"),
        TableDef::new("drive_acl", "id")
            .column("itemId", Text)
            .column("principalType", Text)
            .column("principalId", Text)
            .column("role", Text)
            .column("expiresAt", Text)
            .index("itemId")
            .index("principalId"),
        TableDef::new("drive_comment", "id")
            .column("itemId", Text)
            .column("authorId", Text)
            .column("body", Text)
            .column("createdAt", Text)
            .index("itemId"),
        // An in-app notice that a file was shared. Dismissal lives here because
        // drive_acl has no sharer, time, or seen flag, and there is no mail step.
        TableDef::new("drive_notice", "id")
            .column("itemId", Text)
            .column("recipientId", Text)
            .column("sharerId", Text)
            .column("role", Text)
            .column("createdAt", Text)
            .column("dismissedAt", Text)
            .index("recipientId")
            .index("itemId"),
        // A secret that lets someone add one form response without an account.
        // The token is the primary key so a public request looks up one row.
        TableDef::new("drive_respond_link", "token")
            .column("itemId", Text)
            .column("createdAt", Text)
            .index("itemId"),
        // Who currently has a file open with comment or edit access.
        // Dropped after 15 minutes without activity. Not shown in the editor.
        TableDef::new("drive_presence", "id")
            .column("itemId", Text)
            .column("userId", Text)
            .column("name", Text)
            .column("role", Text)
            .column("lastActiveMs", Integer)
            .index("itemId"),
        // One live collaboration room. generation stops two nodes compacting twice.
        TableDef::new("drive_room", "id")
            .column("mode", Text)
            .column("generation", Integer)
            .column("baseline", Text),
        // Yjs updates for the open room, so another node can catch up.
        TableDef::new("drive_room_update", "id")
            .column("itemId", Text)
            .column("generation", Integer)
            .column("bytes", Text)
            .column("userId", Text)
            .column("at", Text)
            .column("unit", Text)
            .column("key", Text)
            .index("itemId"),
    ]
}

/// Declaration order is the privilege order. [`Drive::require`] allows this
/// role or any role listed after it, and the highest grant wins.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    /// Can read and add comments, but cannot change the file.
    Commenter,
    /// Can append responses on a `.slform` file, and can comment, but cannot
    /// change the questions or write any other file.
    Responder,
    Editor,
    Owner,
}

impl Role {
    fn parse(s: &str) -> Option<Role> {
        match s {
            "viewer" => Some(Role::Viewer),
            "commenter" => Some(Role::Commenter),
            "responder" => Some(Role::Responder),
            "editor" => Some(Role::Editor),
            "owner" => Some(Role::Owner),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Role::Viewer => "viewer",
            Role::Commenter => "commenter",
            Role::Responder => "responder",
            Role::Editor => "editor",
            Role::Owner => "owner",
        }
    }
}

/// Questions are unchanged, and responses are the previous array plus one or
/// more new items. Earlier response objects are unchanged.
fn appends_form_responses(previous: &[u8], next: &[u8]) -> bool {
    let (Ok(previous), Ok(next)) = (
        serde_json::from_slice::<serde_json::Value>(previous),
        serde_json::from_slice::<serde_json::Value>(next),
    ) else {
        return false;
    };
    let (Some(previous_questions), Some(next_questions)) = (
        previous.pointer("/content/questions"),
        next.pointer("/content/questions"),
    ) else {
        return false;
    };
    if previous_questions.as_array().is_none() || previous_questions != next_questions {
        return false;
    }
    let (Some(previous_rows), Some(next_rows)) = (
        previous
            .pointer("/content/responses")
            .and_then(serde_json::Value::as_array),
        next.pointer("/content/responses")
            .and_then(serde_json::Value::as_array),
    ) else {
        return false;
    };
    next_rows.len() > previous_rows.len()
        && next_rows
            .iter()
            .zip(previous_rows)
            .all(|(next_row, previous_row)| next_row == previous_row)
}

fn is_form_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".slform")
}

fn valid_respond_token(token: &str) -> bool {
    uuid::Uuid::parse_str(token).is_ok()
}

fn question_prompt(question: &serde_json::Value) -> &str {
    question
        .get("prompt")
        .and_then(|value| value.as_str())
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or("This question")
}

/// Keep answers that satisfy the questions. A required text or choice must be
/// present, and a choice must be one of that question's choices.
fn checked_answers(
    questions: &[serde_json::Value],
    answers: &BTreeMap<String, String>,
) -> DriveResult<serde_json::Map<String, serde_json::Value>> {
    let mut clean = serde_json::Map::new();
    for question in questions {
        let Some(id) = question
            .get("id")
            .and_then(|value| value.as_str())
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        let prompt = question_prompt(question);
        let required = question
            .get("required")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let kind = question
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("text");
        let value = answers.get(id).map(|answer| answer.trim()).unwrap_or("");
        if value.chars().count() > 2000 {
            return Err(DriveError::BadRequest(format!("{prompt} is too long")));
        }
        if required && value.is_empty() {
            return Err(DriveError::BadRequest(format!("{prompt} is required")));
        }
        if kind == "choice" && !value.is_empty() {
            let allowed = question
                .get("choices")
                .and_then(|choices| choices.as_array())
                .is_some_and(|choices| choices.iter().any(|choice| choice.as_str() == Some(value)));
            if !allowed {
                return Err(DriveError::BadRequest(format!(
                    "{prompt} must be one of the choices"
                )));
            }
        }
        if !value.is_empty() {
            clean.insert(id.to_owned(), serde_json::Value::String(value.to_owned()));
        }
    }
    Ok(clean)
}

fn public_question(question: &serde_json::Value) -> Option<serde_json::Value> {
    let id = question.get("id").and_then(|value| value.as_str())?;
    if id.is_empty() {
        return None;
    }
    let kind = if question.get("kind").and_then(|value| value.as_str()) == Some("choice") {
        "choice"
    } else {
        "text"
    };
    let mut out = serde_json::json!({
        "id": id,
        "prompt": question.get("prompt").and_then(|value| value.as_str()).unwrap_or(""),
        "kind": kind,
        "required": question.get("required").and_then(|value| value.as_bool()).unwrap_or(false),
    });
    if kind == "choice" {
        let choices: Vec<&str> = question
            .get("choices")
            .and_then(|value| value.as_array())
            .map(|choices| {
                choices
                    .iter()
                    .filter_map(|choice| choice.as_str())
                    .collect()
            })
            .unwrap_or_default();
        out["choices"] = serde_json::json!(choices);
    }
    Some(out)
}

fn form_title(file: &serde_json::Value, name: &str) -> String {
    if let Some(title) = file
        .get("title")
        .and_then(|value| value.as_str())
        .filter(|title| !title.is_empty())
    {
        return title.to_owned();
    }
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".slform") && name.len() > 7 {
        return name[..name.len() - 7].to_owned();
    }
    name.to_owned()
}

/// The caller of a drive operation.
#[derive(Clone, Debug)]
pub struct Principal {
    pub id: String,
    pub admin: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub parent_id: Option<String>,
    /// The parent folder's name, when a trash listing looked it up.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_name: Option<String>,
    pub name: String,
    pub kind: String,
    pub owner_id: String,
    pub mime: Option<String>,
    pub size: i64,
    pub head_version_id: Option<String>,
    pub content_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Who wrote the head version, and when. Absent for folders and for files
    /// that have never been saved. This is the last editor, not the owner.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_author_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_edited_at: Option<String>,
    pub trashed: bool,
    pub role: Option<Role>,
    /// Whether this node holds every blob of the head version.
    pub available: bool,
}

/// One file found by [`Drive::search`]. The file's bytes are not included.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub name: String,
    /// The parent folder's name, or "My Drive" when the file is at the top.
    pub parent_name: String,
    /// About 80 characters of the name or file text, with the match in it.
    pub snippet: String,
}

/// One `.slsheet` the caller can read. The file's bytes are not included.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetHit {
    pub id: String,
    pub name: String,
    /// The parent folder's name, or "My Drive" when the file is at the top.
    pub parent_name: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    pub item_id: String,
    pub content_hash: String,
    pub size: i64,
    pub author_id: String,
    pub created_at: String,
    pub name: Option<String>,
    pub restored_from: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AclEntry {
    pub principal_type: String,
    pub principal_id: String,
    pub role: Role,
    /// When this grant stops working, as UTC `YYYY-MM-DDTHH:MM:SS.mmmZ`.
    /// Absent means it lasts until someone removes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// A folder whose sharing also applies to a file inside it.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InheritedFrom {
    pub id: String,
    pub name: String,
}

/// One person or organization who can open an item, including access inherited
/// from a folder. The file's owner uses `principal_type` `"owner"`.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccessGrant {
    pub principal_type: String,
    pub principal_id: String,
    pub role: Role,
    pub inherited_from: Option<InheritedFrom>,
    /// When a direct or inherited grant stops working.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    /// The moment has passed. The person can no longer open the file, but the
    /// owner still sees the row so they can remove it.
    #[serde(default)]
    pub expired: bool,
}

/// Who can open an item, and the folder it lives in.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemAccess {
    pub grants: Vec<AccessGrant>,
    pub parent: Option<InheritedFrom>,
    pub your_role: Role,
}

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

/// What someone with a sign-up link is allowed to see: the title and the
/// questions. Responses, the file's access list, and the owner's other files
/// are not part of this.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PublicForm {
    pub title: String,
    pub questions: Vec<serde_json::Value>,
}

/// How long another person's open-file beat stays visible.
/// A beat older than this is omitted. Nothing sweeps it in the background.
pub const PRESENCE_TTL: Duration = Duration::from_secs(15);

/// Someone else who currently has a file open.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Presence {
    pub name: String,
    pub editing: bool,
}

struct PresenceBeat {
    name: String,
    editing: bool,
    at: SystemTime,
}

fn presence_name(name: &str) -> String {
    let cleaned: String = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned: String = cleaned.chars().take(200).collect();
    if cleaned.is_empty() {
        "Someone".to_owned()
    } else {
        cleaned
    }
}

fn presence_fresh(at: SystemTime, now: SystemTime) -> bool {
    match now.duration_since(at) {
        Ok(age) => age <= PRESENCE_TTL,
        // A beat slightly ahead of this clock is still current.
        Err(_) => true,
    }
}

/// An undismissed in-app notice that `sharer_id` shared `item_id`.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareNotice {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub sharer_id: String,
    pub role: Role,
    pub created_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DriveError {
    #[error("not found")]
    NotFound,
    #[error("you do not have access to this item")]
    Forbidden,
    #[error("the file changed on another device")]
    Conflict(Box<Item>),
    #[error("{0}")]
    BadRequest(String),
    #[error("the file has not replicated to this node yet")]
    Unavailable,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl From<suitedb::Error> for DriveError {
    fn from(e: suitedb::Error) -> Self {
        DriveError::Other(e.into())
    }
}

pub type DriveResult<T> = Result<T, DriveError>;

type Row = BTreeMap<String, Value>;

fn text(row: &Row, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::Text(s)) => Some(s.clone()),
        _ => None,
    }
}

fn int(row: &Row, key: &str) -> i64 {
    match row.get(key) {
        Some(Value::Integer(i)) => *i,
        _ => 0,
    }
}

fn version_from_row(row: &Row) -> Version {
    Version {
        id: text(row, "id").unwrap_or_default(),
        item_id: text(row, "itemId").unwrap_or_default(),
        content_hash: text(row, "contentHash").unwrap_or_default(),
        size: int(row, "size"),
        author_id: text(row, "authorId").unwrap_or_default(),
        created_at: text(row, "createdAt").unwrap_or_default(),
        name: text(row, "name").filter(|s| !s.is_empty()),
        restored_from: text(row, "restoredFrom").filter(|s| !s.is_empty()),
    }
}

fn check_name(name: &str) -> DriveResult<String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\', '\0'])
        || name == "."
        || name == ".."
    {
        return Err(DriveError::BadRequest(
            "Use a name of 1–255 characters without slashes.".into(),
        ));
    }
    Ok(name.to_owned())
}

/// A grant with no end, or an end still in the future, still opens the file.
fn grant_live(expires_at: Option<&str>, now: &str) -> bool {
    match expires_at.map(str::trim).filter(|s| !s.is_empty()) {
        Some(at) => at > now,
        None => true,
    }
}

/// Store an end time in the same UTC shape as [`iso_now`], so a string
/// comparison is a time comparison.
fn normalize_expiry(raw: &str) -> DriveResult<String> {
    let s = raw.trim();
    let Some((date, time)) = s.split_once('T') else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    let mut ymd = date.split('-');
    let (Some(y), Some(m), Some(d), None) = (ymd.next(), ymd.next(), ymd.next(), ymd.next()) else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    let year: u16 = y.parse().unwrap_or(0);
    let month: u8 = m.parse().unwrap_or(0);
    let day: u8 = d.parse().unwrap_or(0);
    if y.len() != 4
        || m.len() != 2
        || d.len() != 2
        || !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
    {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    let time = time
        .strip_suffix('Z')
        .ok_or_else(|| DriveError::BadRequest("Choose the day access ends.".into()))?;
    let mut clock = time.split(':');
    let (Some(hh), Some(mm), Some(rest), None) =
        (clock.next(), clock.next(), clock.next(), clock.next())
    else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    let hour: u8 = hh.parse().unwrap_or(99);
    let minute: u8 = mm.parse().unwrap_or(99);
    let (sec, millis) = if let Some((sec, frac)) = rest.split_once('.') {
        let digits: String = frac.chars().take(3).collect();
        let millis: u16 = if digits.is_empty() {
            0
        } else {
            digits.parse().unwrap_or(1000)
        };
        (sec, millis)
    } else {
        (rest, 0)
    };
    let second: u8 = sec.parse().unwrap_or(99);
    if hh.len() != 2
        || mm.len() != 2
        || sec.len() != 2
        || hour > 23
        || minute > 59
        || second > 60
        || millis > 999
    {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    Ok(format!("{y}-{m}-{d}T{hh}:{mm}:{second:02}.{millis:03}Z"))
}

/// Requests and responses of the blob protocol.
#[derive(Debug, Serialize, Deserialize)]
pub struct BlobRequest {
    pub hashes: Vec<Hash>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BlobResponse {
    pub blobs: Vec<(Hash, Option<ByteBuf>)>,
}

const SEARCH_HITS: usize = 20;
const SNIPPET_CHARS: usize = 80;
const SEARCH_TEXT_LIMIT: usize = 200_000;

struct Words {
    text: String,
    len: usize,
}

impl Words {
    fn new() -> Self {
        Self {
            text: String::new(),
            len: 0,
        }
    }

    fn full(&self) -> bool {
        self.len >= SEARCH_TEXT_LIMIT
    }

    fn push(&mut self, raw: &str) {
        if self.full() {
            return;
        }
        let mut spaced = !self.text.is_empty();
        for ch in raw.chars() {
            if self.full() {
                break;
            }
            if ch.is_whitespace() {
                spaced = true;
                continue;
            }
            if spaced {
                self.text.push(' ');
                self.len += 1;
                spaced = false;
                if self.full() {
                    break;
                }
            }
            self.text.push(ch);
            self.len += 1;
        }
    }
}

fn collect_doc(node: &serde_json::Value, words: &mut Words, depth: usize) {
    if depth > MAX_DEPTH || words.full() {
        return;
    }
    if node.get("type").and_then(|value| value.as_str()) == Some("hardBreak") {
        words.push(" ");
    }
    if let Some(text) = node.get("text").and_then(|value| value.as_str()) {
        words.push(text);
    }
    if let Some(children) = node.get("content").and_then(|value| value.as_array()) {
        for child in children {
            collect_doc(child, words, depth + 1);
        }
    }
}

fn cell_display(cell: &serde_json::Value) -> Option<String> {
    match cell.get("v") {
        Some(serde_json::Value::String(text)) if !text.is_empty() => return Some(text.clone()),
        Some(serde_json::Value::Number(number)) => return Some(number.to_string()),
        Some(serde_json::Value::Bool(value)) => {
            return Some(if *value { "true" } else { "false" }.into());
        }
        _ => {}
    }
    cell.pointer("/p/body/dataStream")
        .and_then(|value| value.as_str())
        .map(|text| text.trim_end_matches(['\r', '\n']).to_owned())
        .filter(|text| !text.is_empty())
}

fn collect_sheet(file: &serde_json::Value, words: &mut Words) {
    let Some(sheets) = file
        .pointer("/content/workbook/sheets")
        .and_then(|value| value.as_object())
    else {
        return;
    };
    for sheet in sheets.values() {
        let Some(rows) = sheet.get("cellData").and_then(|value| value.as_object()) else {
            continue;
        };
        for row in rows.values() {
            let Some(cells) = row.as_object() else {
                continue;
            };
            for cell in cells.values() {
                if let Some(text) = cell_display(cell) {
                    words.push(&text);
                }
                if words.full() {
                    return;
                }
            }
        }
    }
}

fn collect_slides(file: &serde_json::Value, words: &mut Words) {
    let Some(slides) = file
        .pointer("/content/slides")
        .and_then(|value| value.as_object())
    else {
        return;
    };
    for slide in slides.values() {
        if let Some(elements) = slide.get("elements").and_then(|value| value.as_array()) {
            for element in elements {
                if let Some(content) = element.get("content").and_then(|value| value.as_str()) {
                    words.push(content);
                }
                if let Some(rows) = element.get("rows").and_then(|value| value.as_array()) {
                    for row in rows {
                        let Some(cells) = row.as_array() else {
                            continue;
                        };
                        for cell in cells {
                            if let Some(text) = cell.as_str() {
                                words.push(text);
                            }
                        }
                    }
                }
            }
        }
        if let Some(notes) = slide.get("notes").and_then(|value| value.as_str()) {
            words.push(notes);
        }
        if words.full() {
            return;
        }
    }
}

fn collect_form(file: &serde_json::Value, words: &mut Words) {
    if let Some(questions) = file
        .pointer("/content/questions")
        .and_then(|value| value.as_array())
    {
        for question in questions {
            if let Some(prompt) = question.get("prompt").and_then(|value| value.as_str()) {
                words.push(prompt);
            }
            if let Some(choices) = question.get("choices").and_then(|value| value.as_array()) {
                for choice in choices {
                    if let Some(text) = choice.as_str() {
                        words.push(text);
                    }
                }
            }
        }
    }
    if let Some(responses) = file
        .pointer("/content/responses")
        .and_then(|value| value.as_array())
    {
        for response in responses {
            let Some(answers) = response.get("answers").and_then(|value| value.as_object()) else {
                continue;
            };
            for answer in answers.values() {
                if let Some(text) = answer.as_str() {
                    words.push(text);
                }
            }
        }
    }
}

fn doc_text(node: &serde_json::Value) -> String {
    let mut words = Words::new();
    collect_doc(node, &mut words, 0);
    words.text
}

fn named_piece(name: &str, text: &str) -> String {
    if text.is_empty() {
        format!("{name}:")
    } else {
        format!("{name}: {text}")
    }
}

fn first_tab_name(file: &serde_json::Value) -> String {
    file.get("tabTitle")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Document")
        .to_owned()
}

/// One string per tab. A document with no extra tabs is just `content`.
/// With extra tabs, every piece is `Name: text`, including the first tab.
fn doc_pieces(file: &serde_json::Value) -> Vec<String> {
    let Some(content) = file.get("content") else {
        return Vec::new();
    };
    let tabs = file
        .get("tabs")
        .and_then(|value| value.as_array())
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let body = doc_text(content);
    if tabs.is_empty() {
        return vec![body];
    }
    let mut pieces = Vec::with_capacity(tabs.len() + 1);
    pieces.push(named_piece(&first_tab_name(file), &body));
    for (index, tab) in tabs.iter().enumerate() {
        let name = tab
            .get("title")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Tab {}", index + 2));
        let text = tab.get("content").map(doc_text).unwrap_or_default();
        pieces.push(named_piece(&name, &text));
    }
    pieces
}

/// Keep the tab name at the front when the hit sits far enough into the tab
/// that the usual window would start mid-sentence.
fn tab_window(piece: &str, query: &str) -> String {
    let window = snippet_around(piece, query);
    let Some(name) = piece.split(':').next() else {
        return window;
    };
    let prefix = format!("{name}:");
    if window.starts_with(&prefix) {
        return window;
    }
    let head = format!("{name}: ");
    let room = SNIPPET_CHARS.saturating_sub(head.chars().count());
    let rest: String = window.trim().chars().take(room).collect();
    head.chars()
        .chain(rest.chars())
        .take(SNIPPET_CHARS)
        .collect()
}

fn snippet_for_file(bytes: &[u8], query: &str) -> String {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return String::new();
    };
    if value.get("kind").and_then(|kind| kind.as_str()) == Some("doc") {
        let pieces = doc_pieces(&value);
        if pieces.len() > 1 {
            for piece in &pieces {
                if find_ci(piece, query).is_some() {
                    return tab_window(piece, query);
                }
            }
        }
    }
    snippet_around(&file_words(bytes), query)
}

/// Paragraph and heading text, cell display values, slide text and notes, and
/// form prompts, choices, and answers. A document contributes every tab.
/// Anything else contributes nothing.
fn file_words(bytes: &[u8]) -> String {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return String::new();
    };
    let mut words = Words::new();
    match value.get("kind").and_then(|kind| kind.as_str()) {
        Some("doc") => {
            for piece in doc_pieces(&value) {
                words.push(&piece);
            }
        }
        Some("sheet") => collect_sheet(&value, &mut words),
        Some("slide") => collect_slides(&value, &mut words),
        Some("form") => collect_form(&value, &mut words),
        _ => {}
    }
    words.text
}

/// Byte range of `needle` in `haystack`, ignoring case. Empty needles never match.
fn find_ci(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    let needle = needle.to_lowercase();
    if needle.is_empty() || haystack.is_empty() {
        return None;
    }
    let mut lower = String::new();
    let mut map = Vec::new();
    for (idx, ch) in haystack.char_indices() {
        for low in ch.to_lowercase() {
            let mut buf = [0; 4];
            let encoded = low.encode_utf8(&mut buf);
            for _ in 0..encoded.len() {
                map.push(idx);
            }
            lower.push(low);
        }
    }
    let at = lower.find(&needle)?;
    let start = *map.get(at)?;
    let last = *map.get(at + needle.len() - 1)?;
    let end = haystack[last..]
        .chars()
        .next()
        .map(|ch| last + ch.len_utf8())
        .unwrap_or(haystack.len());
    Some((start, end))
}

fn snippet_around(text: &str, query: &str) -> String {
    let Some((start, end)) = find_ci(text, query) else {
        return text.chars().take(SNIPPET_CHARS).collect();
    };
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    if chars.len() <= SNIPPET_CHARS {
        return text.to_owned();
    }
    let match_from = chars.iter().position(|(i, _)| *i >= start).unwrap_or(0);
    let match_to = chars
        .iter()
        .position(|(i, _)| *i >= end)
        .unwrap_or(chars.len());
    let match_len = match_to.saturating_sub(match_from);
    if match_len >= SNIPPET_CHARS {
        return chars[match_from..match_from + SNIPPET_CHARS]
            .iter()
            .map(|(_, ch)| *ch)
            .collect();
    }
    let extra = SNIPPET_CHARS - match_len;
    let mut from = match_from.saturating_sub(extra / 3);
    let mut to = (match_to + (extra - (match_from - from))).min(chars.len());
    if to - from < SNIPPET_CHARS {
        from = from.saturating_sub(SNIPPET_CHARS - (to - from));
    }
    to = (from + SNIPPET_CHARS).min(chars.len());
    if from > 0 && from < match_from {
        if let Some(space) = chars[from..match_from]
            .iter()
            .position(|(_, ch)| ch.is_whitespace())
        {
            let next = from + space + 1;
            if next <= match_from {
                from = next;
            }
        }
    }
    let snippet: String = chars[from..to].iter().map(|(_, ch)| *ch).collect();
    let trimmed = snippet.trim();
    if trimmed.chars().count() <= SNIPPET_CHARS {
        trimmed.to_owned()
    } else {
        trimmed.chars().take(SNIPPET_CHARS).collect()
    }
}

/// How a node reaches its peers for blob replication.
#[async_trait::async_trait]
pub trait BlobTransport: Send + Sync {
    async fn peers(&self) -> Vec<String>;
    async fn request(&self, peer: &str, data: Vec<u8>) -> anyhow::Result<Vec<u8>>;
}

pub struct Drive {
    db: Arc<Db>,
    blobs: BlobStore,
    wanted: Mutex<BTreeSet<Hash>>,
    notify: Notify,
    /// Latest open-file beat per item, then per user. Read paths drop beats
    /// older than [`PRESENCE_TTL`]; there is no sweeper thread.
    presence: Mutex<BTreeMap<String, BTreeMap<String, PresenceBeat>>>,
}

impl Drive {
    /// Open the blob store and start tracking versions whose blobs are missing.
    pub fn open(db: Arc<Db>, root: &Path) -> anyhow::Result<Arc<Drive>> {
        for t in tables() {
            if db.schema().table(&t.name).is_none() {
                anyhow::bail!("the SuiteDB schema lacks the {} table", t.name);
            }
        }
        let drive = Arc::new(Drive {
            db: db.clone(),
            blobs: BlobStore::open(root)?,
            wanted: Mutex::default(),
            notify: Notify::new(),
            presence: Mutex::default(),
        });
        let weak = Arc::downgrade(&drive);
        db.on_applied(Box::new(move |rows| {
            if let Some(drive) = weak.upgrade() {
                for row in rows.iter().filter(|r| r.table == "drive_version") {
                    if let Ok(Some(v)) = drive.db.get("drive_version", &row.pk)
                        && let Some(hash) = text(&v, "contentHash").and_then(|h| h.parse().ok())
                    {
                        drive.want(hash);
                    }
                }
            }
        }));
        let hashes = db.query("SELECT DISTINCT contentHash FROM drive_version", &[])?;
        for row in hashes {
            if let Some(hash) = text(&row, "contentHash").and_then(|h| h.parse().ok()) {
                drive.want(hash);
            }
        }
        Ok(drive)
    }

    pub fn blobs(&self) -> &BlobStore {
        &self.blobs
    }

    fn want(&self, hash: Hash) {
        if self
            .blobs
            .missing(&hash)
            .map(|m| !m.is_empty())
            .unwrap_or(true)
        {
            self.wanted.lock().unwrap().insert(hash);
            self.notify.notify_one();
        }
    }

    /// Content hashes still waiting for blobs from peers.
    pub fn wanted(&self) -> Vec<Hash> {
        self.wanted.lock().unwrap().iter().copied().collect()
    }

    fn item_row(&self, id: &str) -> DriveResult<Row> {
        self.db.get("drive_item", id)?.ok_or(DriveError::NotFound)
    }

    fn orgs(&self, who: &Principal) -> DriveResult<Vec<Value>> {
        if self.db.schema().table("member").is_none() {
            return Ok(vec![]);
        }
        Ok(self
            .db
            .query(
                "SELECT organizationId FROM member WHERE userId = ?1",
                &[Value::Text(who.id.clone())],
            )?
            .into_iter()
            .filter_map(|r| r.get("organizationId").cloned())
            .collect())
    }

    /// The caller's effective role: ownership or sharing on the item or any
    /// ancestor folder, whichever is highest.
    pub fn role(&self, who: &Principal, id: &str) -> DriveResult<Option<Role>> {
        let mut current = Some(self.item_row(id)?);
        if who.admin {
            return Ok(Some(Role::Owner));
        }
        let orgs = self.orgs(who)?;
        let now = iso_now();
        let mut best = None;
        for _ in 0..MAX_DEPTH {
            let Some(row) = current.take() else { break };
            let item = text(&row, "id").unwrap_or_default();
            if text(&row, "ownerId").as_deref() == Some(who.id.as_str()) {
                return Ok(Some(Role::Owner));
            }
            let mut params = vec![Value::Text(item), Value::Text(who.id.clone())];
            let org_clause = if orgs.is_empty() {
                String::new()
            } else {
                let marks: Vec<String> = (0..orgs.len()).map(|i| format!("?{}", i + 3)).collect();
                params.extend(orgs.iter().cloned());
                format!(
                    " OR (principalType = 'org' AND principalId IN ({}))",
                    marks.join(", ")
                )
            };
            let grants = self.db.query(
                &format!(
                    "SELECT role, expiresAt FROM drive_acl WHERE itemId = ?1
                     AND ((principalType = 'user' AND principalId = ?2){org_clause})"
                ),
                &params,
            )?;
            for grant in grants {
                if !grant_live(text(&grant, "expiresAt").as_deref(), &now) {
                    continue;
                }
                best = best.max(text(&grant, "role").and_then(|r| Role::parse(&r)));
            }
            current = match text(&row, "parentId") {
                Some(parent) => self.db.get("drive_item", &parent)?,
                None => None,
            };
        }
        Ok(best)
    }

    fn require(&self, who: &Principal, id: &str, needed: Role) -> DriveResult<Role> {
        match self.role(who, id)? {
            Some(role) if role >= needed => Ok(role),
            _ => Err(DriveError::Forbidden),
        }
    }

    fn to_item(&self, row: &Row, role: Option<Role>) -> DriveResult<Item> {
        let head = text(row, "headVersionId");
        let head_row = match &head {
            Some(v) => self.db.get("drive_version", v)?,
            None => None,
        };
        let content_hash = head_row.as_ref().and_then(|r| text(r, "contentHash"));
        let last_author_id = head_row
            .as_ref()
            .and_then(|r| text(r, "authorId"))
            .filter(|id| !id.is_empty());
        let last_edited_at = last_author_id
            .as_ref()
            .and_then(|_| head_row.as_ref().and_then(|r| text(r, "createdAt")))
            .filter(|at| !at.is_empty());
        let available = match content_hash.as_deref().map(str::parse::<Hash>) {
            Some(Ok(hash)) => self
                .blobs
                .missing(&hash)
                .map(|m| m.is_empty())
                .unwrap_or(false),
            Some(Err(_)) => false,
            None => true,
        };
        Ok(Item {
            id: text(row, "id").unwrap_or_default(),
            parent_id: text(row, "parentId"),
            parent_name: None,
            name: text(row, "name").unwrap_or_default(),
            kind: text(row, "kind").unwrap_or_else(|| "file".into()),
            owner_id: text(row, "ownerId").unwrap_or_default(),
            mime: text(row, "mime"),
            size: int(row, "size"),
            head_version_id: head,
            content_hash,
            created_at: text(row, "createdAt").unwrap_or_default(),
            updated_at: text(row, "updatedAt").unwrap_or_default(),
            last_author_id,
            last_edited_at,
            trashed: int(row, "trashed") != 0,
            role,
            available,
        })
    }

    pub fn get(&self, who: &Principal, id: &str) -> DriveResult<Item> {
        let role = self.require(who, id, Role::Viewer)?;
        let mut item = self.to_item(&self.item_row(id)?, Some(role))?;
        if let Some(parent_id) = item.parent_id.clone() {
            item.parent_name = self
                .db
                .get("drive_item", &parent_id)?
                .as_ref()
                .and_then(|parent| text(parent, "name"));
        }
        Ok(item)
    }

    fn items(&self, sql: &str, params: &[Value], who: &Principal) -> DriveResult<Vec<Item>> {
        let mut out = Vec::new();
        for row in self.db.query(sql, params)? {
            let id = text(&row, "id").unwrap_or_default();
            if let Some(role) = self.role(who, &id)? {
                out.push(self.to_item(&row, Some(role))?);
            }
        }
        Ok(out)
    }

    /// Children of a folder, or the caller's own top-level items.
    pub fn list(&self, who: &Principal, parent: Option<&str>) -> DriveResult<Vec<Item>> {
        const ORDER: &str = "ORDER BY kind = 'folder' DESC, name COLLATE NOCASE";
        match parent {
            Some(parent) => {
                self.require(who, parent, Role::Viewer)?;
                self.items(
                    &format!("SELECT * FROM drive_item WHERE parentId = ?1 AND trashed = 0 {ORDER}"),
                    &[Value::Text(parent.into())],
                    who,
                )
            }
            None => self.items(
                &format!("SELECT * FROM drive_item WHERE parentId IS NULL AND ownerId = ?1 AND trashed = 0 {ORDER}"),
                &[Value::Text(who.id.clone())],
                who,
            ),
        }
    }

    /// Folders the caller can edit, including nested ones, so a move dialog
    /// can show a path without opening each folder. A folder they can only
    /// view or comment on is left out. Trashed folders are left out.
    pub fn list_folders(&self, who: &Principal) -> DriveResult<Vec<Item>> {
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE kind = 'folder' AND trashed = 0 ORDER BY name COLLATE NOCASE",
            &[],
        )?;
        let mut out = Vec::new();
        for row in rows {
            let id = text(&row, "id").unwrap_or_default();
            if let Some(role) = self.role(who, &id)?
                && role >= Role::Editor
            {
                out.push(self.to_item(&row, Some(role))?);
            }
        }
        Ok(out)
    }

    /// Items shared directly with the caller or their organizations.
    pub fn shared(&self, who: &Principal) -> DriveResult<Vec<Item>> {
        let now = iso_now();
        let mut params = vec![Value::Text(who.id.clone()), Value::Text(now)];
        let orgs = self.orgs(who)?;
        let org_clause = if orgs.is_empty() {
            String::new()
        } else {
            let marks: Vec<String> = (0..orgs.len()).map(|i| format!("?{}", i + 3)).collect();
            params.extend(orgs);
            format!(
                " OR (a.principalType = 'org' AND a.principalId IN ({}))",
                marks.join(", ")
            )
        };
        self.items(
            &format!(
                "SELECT DISTINCT i.* FROM drive_item i JOIN drive_acl a ON a.itemId = i.id
                 WHERE i.trashed = 0 AND i.ownerId != ?1
                   AND ((a.principalType = 'user' AND a.principalId = ?1){org_clause})
                   AND (a.expiresAt IS NULL OR a.expiresAt > ?2)
                 ORDER BY i.name COLLATE NOCASE"
            ),
            &params,
            who,
        )
    }

    /// Trashed items the caller owns, with the folder name they came from.
    pub fn list_trashed(&self, who: &Principal) -> DriveResult<Vec<Item>> {
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE ownerId = ?1 AND trashed = 1 ORDER BY name COLLATE NOCASE",
            &[Value::Text(who.id.clone())],
        )?;
        let mut out = Vec::new();
        for row in rows {
            let mut item = self.to_item(&row, Some(Role::Owner))?;
            if let Some(parent_id) = item.parent_id.clone() {
                item.parent_name = self
                    .db
                    .get("drive_item", &parent_id)?
                    .as_ref()
                    .and_then(|parent| text(parent, "name"));
            }
            out.push(item);
        }
        Ok(out)
    }

    /// Files the caller can read whose name or text contains `query`.
    ///
    /// The match is a case-insensitive substring of the file name or of the
    /// text inside a native SuiteLeaf file. Folders are not hits. Trashed
    /// files, and files inside a trashed folder, are skipped. At most 20 hits
    /// come back, each with the parent folder name (or "My Drive") and a short
    /// snippet. The response does not include file bytes.
    pub fn search(&self, who: &Principal, query: &str) -> DriveResult<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE kind = 'file' AND trashed = 0 ORDER BY name COLLATE NOCASE",
            &[],
        )?;
        let mut hits = Vec::new();
        for row in rows {
            if hits.len() == SEARCH_HITS {
                break;
            }
            let id = text(&row, "id").unwrap_or_default();
            if self.role(who, &id)?.is_none() {
                continue;
            }
            let parent_id = text(&row, "parentId");
            if self.hidden_by_trash(parent_id.as_deref())? {
                continue;
            }
            let name = text(&row, "name").unwrap_or_default();
            let bytes = self.head_bytes(&row)?;
            let body = match &bytes {
                Some(raw) => file_words(raw),
                None => String::new(),
            };
            let in_body = find_ci(&body, query).is_some();
            if !in_body && find_ci(&name, query).is_none() {
                continue;
            }
            let snippet = if in_body {
                match &bytes {
                    Some(raw) => snippet_for_file(raw, query),
                    None => String::new(),
                }
            } else {
                snippet_around(&name, query)
            };
            let parent_name = self.folder_name(parent_id.as_deref())?;
            hits.push(SearchHit {
                id,
                name,
                parent_name,
                snippet,
            });
        }
        Ok(hits)
    }

    /// Spreadsheets the caller can read, including files inside folders and
    /// files they have never opened. A folder listing only sees one folder,
    /// so this walks every readable `.slsheet` instead. Trashed files, and
    /// files inside a trashed folder, are left out. Each hit is the file id,
    /// name, and parent folder name. The response does not include file bytes.
    pub fn list_spreadsheets(&self, who: &Principal) -> DriveResult<Vec<SpreadsheetHit>> {
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE kind = 'file' AND trashed = 0 ORDER BY name COLLATE NOCASE",
            &[],
        )?;
        let mut hits = Vec::new();
        for row in rows {
            let name = text(&row, "name").unwrap_or_default();
            if !name.to_ascii_lowercase().ends_with(".slsheet") {
                continue;
            }
            let id = text(&row, "id").unwrap_or_default();
            if self.role(who, &id)?.is_none() {
                continue;
            }
            let parent_id = text(&row, "parentId");
            if self.hidden_by_trash(parent_id.as_deref())? {
                continue;
            }
            hits.push(SpreadsheetHit {
                id,
                name,
                parent_name: self.folder_name(parent_id.as_deref())?,
            });
        }
        Ok(hits)
    }

    /// The parent folder's name, or "My Drive" when the file is at the top.
    fn folder_name(&self, parent_id: Option<&str>) -> DriveResult<String> {
        Ok(match parent_id {
            Some(parent) => self
                .db
                .get("drive_item", parent)?
                .as_ref()
                .and_then(|folder| text(folder, "name"))
                .filter(|folder| !folder.is_empty())
                .unwrap_or_else(|| "My Drive".into()),
            None => "My Drive".into(),
        })
    }

    /// True when an ancestor folder is in Trash. The file itself is filtered
    /// by the search query; trashing a folder does not mark its children.
    fn hidden_by_trash(&self, parent_id: Option<&str>) -> DriveResult<bool> {
        let mut current = parent_id.map(str::to_owned);
        for _ in 0..MAX_DEPTH {
            let Some(id) = current else {
                return Ok(false);
            };
            let Some(row) = self.db.get("drive_item", &id)? else {
                return Ok(false);
            };
            if int(&row, "trashed") != 0 {
                return Ok(true);
            }
            current = text(&row, "parentId");
        }
        Ok(false)
    }

    pub fn create(
        &self,
        who: &Principal,
        parent: Option<&str>,
        name: &str,
        kind: &str,
        mime: Option<&str>,
    ) -> DriveResult<Item> {
        let name = check_name(name)?;
        if kind != "file" && kind != "folder" {
            return Err(DriveError::BadRequest("kind must be file or folder".into()));
        }
        if let Some(parent) = parent {
            self.require(who, parent, Role::Editor)?;
            if text(&self.item_row(parent)?, "kind").as_deref() != Some("folder") {
                return Err(DriveError::BadRequest(
                    "Items can only be created inside folders.".into(),
                ));
            }
        }
        let id = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_item",
                &id,
                [
                    ("parentId", Value::from(parent.map(str::to_owned))),
                    ("name", name.clone().into()),
                    ("kind", kind.into()),
                    ("ownerId", who.id.clone().into()),
                    ("mime", Value::from(mime.map(str::to_owned))),
                    ("size", Value::Integer(0)),
                    ("createdAt", now.clone().into()),
                    ("updatedAt", now.clone().into()),
                    ("trashed", Value::Integer(0)),
                ],
            )
        })?;
        self.get(who, &id)
    }

    /// A responder may save a `.slform` file only by appending responses.
    fn responder_may_append(&self, id: &str, bytes: &[u8]) -> DriveResult<bool> {
        let row = self.item_row(id)?;
        let name = text(&row, "name").unwrap_or_default();
        if !name.to_ascii_lowercase().ends_with(".slform") {
            return Ok(false);
        }
        let Some(previous) = self.head_bytes(&row)? else {
            return Ok(false);
        };
        Ok(appends_form_responses(&previous, bytes))
    }

    fn head_bytes(&self, row: &Row) -> DriveResult<Option<Vec<u8>>> {
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
        self.commit_bytes(id, &who.id, mime, bytes)?;
        self.get(who, id)
    }

    fn commit_bytes(
        &self,
        id: &str,
        author_id: &str,
        mime: Option<&str>,
        bytes: &[u8],
    ) -> DriveResult<()> {
        let hash = self.blobs.put_content(bytes).context("store content")?;
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

    fn respond_tokens(&self, item_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(
                "SELECT token FROM drive_respond_link WHERE itemId = ?1",
                &[Value::Text(item_id.to_owned())],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "token"))
            .collect())
    }

    /// Create a sign-up link, or return the one already on this form.
    /// Only an editor or owner of a `.slform` file may do this.
    pub fn create_respond_link(&self, who: &Principal, id: &str) -> DriveResult<String> {
        self.require(who, id, Role::Editor)?;
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file")
            || !is_form_name(&text(&row, "name").unwrap_or_default())
        {
            return Err(DriveError::BadRequest(
                "A sign-up link is only for a form.".into(),
            ));
        }
        if let Some(token) = self.respond_tokens(id)?.into_iter().next() {
            return Ok(token);
        }
        let token = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_respond_link",
                &token,
                [("itemId", Value::from(id)), ("createdAt", now.into())],
            )
        })?;
        Ok(token)
    }

    /// Turn the sign-up link off. The form, including responses already
    /// collected, stays. Only an editor or owner may do this.
    pub fn clear_respond_link(&self, who: &Principal, id: &str) -> DriveResult<()> {
        self.require(who, id, Role::Editor)?;
        let tokens = self.respond_tokens(id)?;
        if tokens.is_empty() {
            return Ok(());
        }
        self.db.transact(|tx| {
            for token in &tokens {
                tx.delete("drive_respond_link", token)?;
            }
            Ok(())
        })?;
        Ok(())
    }

    fn linked_form(&self, token: &str) -> DriveResult<(String, String, Vec<u8>)> {
        if !valid_respond_token(token) {
            return Err(DriveError::NotFound);
        }
        let link = self
            .db
            .get("drive_respond_link", token)?
            .ok_or(DriveError::NotFound)?;
        let item_id = text(&link, "itemId").ok_or(DriveError::NotFound)?;
        let row = self.item_row(&item_id)?;
        if int(&row, "trashed") != 0 {
            return Err(DriveError::NotFound);
        }
        let name = text(&row, "name").unwrap_or_default();
        if !is_form_name(&name) {
            return Err(DriveError::NotFound);
        }
        let bytes = self.head_bytes(&row)?.ok_or(DriveError::NotFound)?;
        Ok((item_id, name, bytes))
    }

    /// The title and questions for a sign-up link. No account is required.
    /// The response list is not included.
    pub fn public_form(&self, token: &str) -> DriveResult<PublicForm> {
        let (_id, name, bytes) = self.linked_form(token)?;
        let file: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| DriveError::NotFound)?;
        if let Some(kind) = file.get("kind").and_then(|value| value.as_str())
            && kind != "form"
        {
            return Err(DriveError::NotFound);
        }
        let questions = file
            .pointer("/content/questions")
            .and_then(|value| value.as_array())
            .ok_or(DriveError::NotFound)?;
        Ok(PublicForm {
            title: form_title(&file, &name),
            questions: questions.iter().filter_map(public_question).collect(),
        })
    }

    /// Append one response through a sign-up link. Questions stay as they are.
    pub fn submit_public_response(
        &self,
        token: &str,
        answers: &BTreeMap<String, String>,
    ) -> DriveResult<()> {
        let (id, _name, bytes) = self.linked_form(token)?;
        let file: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| DriveError::BadRequest("This form could not be read.".into()))?;
        let questions = file
            .pointer("/content/questions")
            .and_then(|value| value.as_array())
            .cloned()
            .ok_or_else(|| DriveError::BadRequest("This form could not be read.".into()))?;
        let clean = checked_answers(&questions, answers)?;
        let mut next = file;
        let responses = next
            .pointer_mut("/content/responses")
            .ok_or_else(|| DriveError::BadRequest("This form could not be read.".into()))?;
        let rows = responses
            .as_array_mut()
            .ok_or_else(|| DriveError::BadRequest("This form could not be read.".into()))?;
        if rows.len() >= 5000 {
            return Err(DriveError::BadRequest(
                "This form is not taking more responses.".into(),
            ));
        }
        rows.push(serde_json::json!({
            "id": uuid::Uuid::now_v7().to_string(),
            "at": iso_now(),
            "answers": clean,
        }));
        let next_bytes = serde_json::to_vec(&next).map_err(|e| DriveError::Other(e.into()))?;
        if !appends_form_responses(&bytes, &next_bytes) {
            return Err(DriveError::BadRequest(
                "That response could not be added.".into(),
            ));
        }
        self.commit_bytes(&id, "", None, &next_bytes)
    }

    /// Write file bytes without an If-Match check. Used when a collaboration
    /// room compacts, after the last writer has gone idle.
    pub fn write_head(&self, author_id: &str, id: &str, bytes: &[u8]) -> DriveResult<Item> {
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let hash = self.blobs.put_content(bytes).context("store content")?;
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
        let bytes = match hash {
            Some(hash) => self
                .blobs
                .get_content(&hash)?
                .ok_or(DriveError::Unavailable)?,
            None => Vec::new(),
        };
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

    pub fn update(
        &self,
        who: &Principal,
        id: &str,
        name: Option<&str>,
        parent: Option<Option<&str>>,
        trashed: Option<bool>,
    ) -> DriveResult<Item> {
        self.require(who, id, Role::Editor)?;
        let mut cols: Vec<(&str, Value)> = vec![("updatedAt", iso_now().into())];
        if let Some(name) = name {
            cols.push(("name", check_name(name)?.into()));
        }
        if let Some(parent) = parent {
            if let Some(target) = parent {
                self.require(who, target, Role::Editor)?;
                let mut cursor = Some(target.to_owned());
                for _ in 0..MAX_DEPTH {
                    let Some(current) = cursor else { break };
                    if current == id {
                        return Err(DriveError::BadRequest(
                            "A folder cannot move inside itself.".into(),
                        ));
                    }
                    let row = self.item_row(&current)?;
                    if current == target && text(&row, "kind").as_deref() != Some("folder") {
                        return Err(DriveError::BadRequest(
                            "Items can only move into folders.".into(),
                        ));
                    }
                    cursor = text(&row, "parentId");
                }
            } else if text(&self.item_row(id)?, "ownerId").as_deref() != Some(who.id.as_str())
                && !who.admin
            {
                return Err(DriveError::Forbidden);
            }
            cols.push(("parentId", Value::from(parent.map(str::to_owned))));
        }
        if let Some(trashed) = trashed {
            cols.push(("trashed", Value::from(trashed)));
        }
        self.db.transact(|tx| tx.upsert("drive_item", id, cols))?;
        self.get(who, id)
    }

    fn column_values(&self, sql: &str, column: &str, item_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(sql, &[Value::Text(item_id.to_owned())])?
            .into_iter()
            .filter_map(|row| text(&row, column))
            .collect())
    }

    /// Remove a trashed item the caller owns, plus its versions, grants, and
    /// any blobs no other version still uses.
    pub fn delete_forever(&self, who: &Principal, id: &str) -> DriveResult<()> {
        let row = self.item_row(id)?;
        if text(&row, "ownerId").as_deref() != Some(who.id.as_str()) {
            return Err(DriveError::Forbidden);
        }
        if int(&row, "trashed") == 0 {
            return Err(DriveError::BadRequest(
                "Move it to Trash before deleting it forever.".into(),
            ));
        }
        let children = self.db.query(
            "SELECT id FROM drive_item WHERE parentId = ?1 LIMIT 1",
            &[Value::Text(id.to_owned())],
        )?;
        if !children.is_empty() {
            return Err(DriveError::BadRequest(
                "This folder still has something in it. Move those out, or delete them forever, before deleting the folder.".into(),
            ));
        }
        let versions = self.db.query(
            "SELECT id, contentHash FROM drive_version WHERE itemId = ?1",
            &[Value::Text(id.to_owned())],
        )?;
        let version_ids: Vec<String> = versions.iter().filter_map(|row| text(row, "id")).collect();
        let hashes: Vec<String> = versions
            .iter()
            .filter_map(|row| text(row, "contentHash"))
            .collect();
        let acls = self.column_values("SELECT id FROM drive_acl WHERE itemId = ?1", "id", id)?;
        let comments =
            self.column_values("SELECT id FROM drive_comment WHERE itemId = ?1", "id", id)?;
        let notices =
            self.column_values("SELECT id FROM drive_notice WHERE itemId = ?1", "id", id)?;
        let links = self.column_values(
            "SELECT token FROM drive_respond_link WHERE itemId = ?1",
            "token",
            id,
        )?;
        self.db.transact(|tx| {
            for version_id in &version_ids {
                tx.delete("drive_version", version_id)?;
            }
            for acl_id in &acls {
                tx.delete("drive_acl", acl_id)?;
            }
            for comment_id in &comments {
                tx.delete("drive_comment", comment_id)?;
            }
            for notice_id in &notices {
                tx.delete("drive_notice", notice_id)?;
            }
            for token in &links {
                tx.delete("drive_respond_link", token)?;
            }
            tx.delete("drive_item", id)?;
            Ok(())
        })?;
        self.release_unreferenced_blobs(&hashes)?;
        Ok(())
    }

    /// Drop manifest and chunk blobs that no remaining version still names.
    fn release_unreferenced_blobs(&self, hashes: &[String]) -> DriveResult<()> {
        let live: BTreeSet<String> = self
            .db
            .query("SELECT contentHash FROM drive_version", &[])?
            .into_iter()
            .filter_map(|row| text(&row, "contentHash"))
            .collect();
        let mut live_chunks = BTreeSet::new();
        for hash in &live {
            let Ok(parsed) = hash.parse::<Hash>() else {
                continue;
            };
            if let Some(bytes) = self.blobs.get(&parsed)?
                && let Ok(manifest) = Manifest::decode(&bytes)
            {
                live_chunks.extend(manifest.chunks);
            }
        }
        for hash in hashes {
            if live.contains(hash) {
                continue;
            }
            let Ok(parsed) = hash.parse::<Hash>() else {
                continue;
            };
            let chunks = self
                .blobs
                .get(&parsed)?
                .and_then(|bytes| Manifest::decode(&bytes).ok())
                .map(|manifest| manifest.chunks)
                .unwrap_or_default();
            for chunk in chunks {
                if live_chunks.contains(&chunk) {
                    continue;
                }
                self.blobs.remove(&chunk).context("remove chunk")?;
                self.wanted.lock().unwrap().remove(&chunk);
            }
            self.blobs.remove(&parsed).context("remove content")?;
            self.wanted.lock().unwrap().remove(&parsed);
        }
        Ok(())
    }

    fn version_row(&self, item_id: &str, version_id: &str) -> DriveResult<Row> {
        let row = self
            .db
            .get("drive_version", version_id)?
            .ok_or(DriveError::NotFound)?;
        if text(&row, "itemId").as_deref() != Some(item_id) {
            return Err(DriveError::NotFound);
        }
        Ok(row)
    }

    fn head_matches(head: Option<&str>, if_match: Option<&str>) -> bool {
        match if_match.map(|m| m.trim_matches('"')) {
            Some(expected) if expected != "*" => Some(expected) == head,
            _ => true,
        }
    }

    pub fn versions(&self, who: &Principal, id: &str) -> DriveResult<Vec<Version>> {
        self.require(who, id, Role::Viewer)?;
        Ok(self
            .db
            .query(
                "SELECT * FROM drive_version WHERE itemId = ?1 ORDER BY createdAt DESC, id DESC",
                &[Value::Text(id.into())],
            )?
            .into_iter()
            .map(|r| version_from_row(&r))
            .collect())
    }

    /// Set or clear the name people see in version history. The name replicates
    /// with the version row, so another server shows it after sync.
    pub fn name_version(
        &self,
        who: &Principal,
        id: &str,
        version_id: &str,
        name: Option<&str>,
    ) -> DriveResult<Version> {
        self.require(who, id, Role::Editor)?;
        self.version_row(id, version_id)?;
        let name = match name.map(str::trim).filter(|s| !s.is_empty()) {
            Some(name) => {
                if name.chars().count() > 80 || name.contains(['\n', '\r', '\0']) {
                    return Err(DriveError::BadRequest(
                        "Use a version name of 1–80 characters on one line.".into(),
                    ));
                }
                Some(name.to_owned())
            }
            None => None,
        };
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                version_id,
                [("name", Value::from(name.clone()))],
            )
        })?;
        Ok(version_from_row(
            &self
                .db
                .get("drive_version", version_id)?
                .unwrap_or_default(),
        ))
    }

    /// Make `version_id` the file's content again, as a new version. The
    /// previous head stays in history and the saved bytes are the same blob.
    pub fn restore(
        &self,
        who: &Principal,
        id: &str,
        version_id: &str,
        if_match: Option<&str>,
    ) -> DriveResult<Item> {
        self.require(who, id, Role::Editor)?;
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file") {
            return Err(DriveError::BadRequest("Folders have no content.".into()));
        }
        let head = text(&row, "headVersionId");
        if !Self::head_matches(head.as_deref(), if_match) {
            let role = self.role(who, id)?;
            return Err(DriveError::Conflict(Box::new(self.to_item(&row, role)?)));
        }
        let source = self.version_row(id, version_id)?;
        let hash = text(&source, "contentHash")
            .ok_or_else(|| DriveError::Other(anyhow::anyhow!("version has no content")))?;
        let parsed: Hash = hash
            .parse()
            .map_err(|_| DriveError::Other(anyhow::anyhow!("corrupt content hash")))?;
        if !self.blobs.missing(&parsed)?.is_empty() {
            return Err(DriveError::Unavailable);
        }
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        let size = int(&source, "size");
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::from(id)),
                    ("contentHash", hash.into()),
                    ("size", Value::Integer(size)),
                    ("authorId", who.id.clone().into()),
                    ("createdAt", now.clone().into()),
                    ("restoredFrom", Value::from(version_id)),
                ],
            )?;
            tx.upsert(
                "drive_item",
                id,
                [
                    ("headVersionId", Value::Text(version.clone())),
                    ("size", Value::Integer(size)),
                    ("updatedAt", now.into()),
                ],
            )
        })?;
        self.get(who, id)
    }

    /// A new file in the same folder, holding this version's bytes.
    pub fn copy_version(
        &self,
        who: &Principal,
        id: &str,
        version_id: &str,
        name: &str,
    ) -> DriveResult<Item> {
        let item = self.get(who, id)?;
        self.version_row(id, version_id)?;
        let (_, bytes) = self.read(who, id, Some(version_id))?;
        let created = self.create(
            who,
            item.parent_id.as_deref(),
            name,
            "file",
            item.mime.as_deref(),
        )?;
        self.write(who, &created.id, None, item.mime.as_deref(), &bytes)
    }

    pub fn acl(&self, who: &Principal, id: &str) -> DriveResult<Vec<AclEntry>> {
        self.require(who, id, Role::Viewer)?;
        Ok(self
            .db
            .query(
                "SELECT * FROM drive_acl WHERE itemId = ?1 ORDER BY principalType, principalId",
                &[Value::Text(id.into())],
            )?
            .into_iter()
            .filter_map(|r| {
                Some(AclEntry {
                    principal_type: text(&r, "principalType")?,
                    principal_id: text(&r, "principalId")?,
                    role: Role::parse(&text(&r, "role")?)?,
                    expires_at: text(&r, "expiresAt").filter(|s| !s.is_empty()),
                })
            })
            .collect())
    }

    /// Everyone who can open `id`: the owner, direct grants, and grants
    /// inherited from ancestor folders. When someone has more than one grant,
    /// only the highest role is returned, labelled with the folder it comes
    /// from when that role is not on the item itself.
    pub fn access(&self, who: &Principal, id: &str) -> DriveResult<ItemAccess> {
        let your_role = self.require(who, id, Role::Viewer)?;
        let now = iso_now();
        let mut best: BTreeMap<String, AccessGrant> = BTreeMap::new();
        let mut parent = None;
        let mut current = Some(id.to_owned());
        for depth in 0..MAX_DEPTH {
            let Some(item_id) = current.take() else { break };
            let row = self.item_row(&item_id)?;
            let name = text(&row, "name").unwrap_or_default();
            let on_item = item_id == id;
            if depth == 1 {
                parent = Some(InheritedFrom {
                    id: item_id.clone(),
                    name: name.clone(),
                });
            }
            if let Some(owner) = text(&row, "ownerId") {
                let key = format!("user:{owner}");
                let higher = best
                    .get(&key)
                    .is_none_or(|existing| Role::Owner > existing.role);
                if higher {
                    best.insert(
                        key,
                        AccessGrant {
                            principal_type: if on_item { "owner" } else { "user" }.into(),
                            principal_id: owner,
                            role: Role::Owner,
                            inherited_from: (!on_item).then(|| InheritedFrom {
                                id: item_id.clone(),
                                name: name.clone(),
                            }),
                            expires_at: None,
                            expired: false,
                        },
                    );
                }
            }
            let via = (!on_item).then(|| InheritedFrom {
                id: item_id.clone(),
                name: name.clone(),
            });
            for grant in self.db.query(
                "SELECT principalType, principalId, role, expiresAt FROM drive_acl WHERE itemId = ?1",
                &[Value::Text(item_id.clone())],
            )? {
                let Some(ptype) = text(&grant, "principalType") else {
                    continue;
                };
                let Some(pid) = text(&grant, "principalId") else {
                    continue;
                };
                let Some(role) = text(&grant, "role").and_then(|r| Role::parse(&r)) else {
                    continue;
                };
                let expires_at = text(&grant, "expiresAt").filter(|s| !s.is_empty());
                let expired = !grant_live(expires_at.as_deref(), &now);
                let key = format!("{ptype}:{pid}");
                let replace = match best.get(&key) {
                    None => true,
                    // A live grant beats an ended one, and a higher live role
                    // beats a weaker one. An ended grant stays visible only
                    // when the person has no live access left.
                    Some(existing) if existing.expired && !expired => true,
                    Some(existing) if !existing.expired && expired => false,
                    Some(existing) => role > existing.role,
                };
                if replace {
                    best.insert(
                        key,
                        AccessGrant {
                            principal_type: ptype,
                            principal_id: pid,
                            role,
                            inherited_from: via.clone(),
                            expires_at,
                            expired,
                        },
                    );
                }
            }
            current = text(&row, "parentId");
        }
        let mut grants: Vec<_> = best.into_values().collect();
        grants.sort_by(|a, b| {
            let rank = |g: &AccessGrant| {
                if g.principal_type == "owner" {
                    0
                } else if g.expired {
                    2
                } else {
                    1
                }
            };
            rank(a)
                .cmp(&rank(b))
                .then(b.role.cmp(&a.role))
                .then(a.principal_id.cmp(&b.principal_id))
        });
        Ok(ItemAccess {
            grants,
            parent,
            your_role,
        })
    }

    /// Record that `who` has this item open. Viewers and commenters may report
    /// viewing. `editing` is only what their client says; it does not grant
    /// write access. `write` still refuses viewers and commenters.
    pub fn report_presence(
        &self,
        who: &Principal,
        id: &str,
        name: &str,
        editing: bool,
        at: SystemTime,
    ) -> DriveResult<()> {
        self.require(who, id, Role::Viewer)?;
        let mut items = self.presence.lock().unwrap();
        items.entry(id.to_owned()).or_default().insert(
            who.id.clone(),
            PresenceBeat {
                name: presence_name(name),
                editing,
                at,
            },
        );
        Ok(())
    }

    /// Other people whose latest beat is not older than [`PRESENCE_TTL`].
    /// The caller is left out. A beat older than that is omitted here, so no
    /// background thread is required.
    pub fn presence(
        &self,
        who: &Principal,
        id: &str,
        now: SystemTime,
    ) -> DriveResult<Vec<Presence>> {
        self.require(who, id, Role::Viewer)?;
        let mut items = self.presence.lock().unwrap();
        let Some(people) = items.get_mut(id) else {
            return Ok(vec![]);
        };
        people.retain(|_, beat| presence_fresh(beat.at, now));
        let mut out: Vec<Presence> = people
            .iter()
            .filter(|(user_id, _)| *user_id != &who.id)
            .map(|(_, beat)| Presence {
                name: beat.name.clone(),
                editing: beat.editing,
            })
            .collect();
        if people.is_empty() {
            items.remove(id);
        }
        out.sort_by(|a, b| a.name.cmp(&b.name).then(a.editing.cmp(&b.editing)));
        Ok(out)
    }

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

    /// Grant a user or organization a role, or remove it with `None`.
    /// A user grant also writes an in-app notice for that person. There is no
    /// mail step. An organization grant has no single recipient, so it does not.
    /// Changing a role leaves an end date already stored on the grant.
    /// Ownership is [`Self::transfer`], not a role in this list.
    pub fn share(
        &self,
        who: &Principal,
        id: &str,
        principal_type: &str,
        principal_id: &str,
        role: Option<Role>,
    ) -> DriveResult<Vec<AclEntry>> {
        self.require(who, id, Role::Owner)?;
        if role == Some(Role::Owner) {
            return Err(DriveError::BadRequest(
                "Hand over the file to make someone the owner.".into(),
            ));
        }
        if principal_type != "user" && principal_type != "org" {
            return Err(DriveError::BadRequest(
                "principalType must be user or org".into(),
            ));
        }
        let key = format!("{id}:{principal_type}:{principal_id}");
        let now = iso_now();
        let dismiss_ids = if principal_type == "user" {
            self.open_notice_ids(id, principal_id)?
        } else {
            Vec::new()
        };
        let notice_id = (role.is_some() && principal_type == "user" && principal_id != who.id)
            .then(|| uuid::Uuid::now_v7().to_string());
        self.db.transact(|tx| {
            match role {
                Some(role) => tx.upsert(
                    "drive_acl",
                    &key,
                    [
                        ("itemId", Value::from(id)),
                        ("principalType", principal_type.into()),
                        ("principalId", principal_id.into()),
                        ("role", role.as_str().into()),
                    ],
                )?,
                None => tx.delete("drive_acl", &key)?,
            }
            for nid in &dismiss_ids {
                tx.upsert(
                    "drive_notice",
                    nid,
                    [("dismissedAt", Value::Text(now.clone()))],
                )?;
            }
            if let (Some(role), Some(notice_id)) = (role, notice_id.as_deref()) {
                tx.upsert(
                    "drive_notice",
                    notice_id,
                    [
                        ("itemId", Value::from(id)),
                        ("recipientId", principal_id.into()),
                        ("sharerId", who.id.clone().into()),
                        ("role", role.as_str().into()),
                        ("createdAt", now.clone().into()),
                    ],
                )?;
            }
            Ok(())
        })?;
        self.acl(who, id)
    }

    fn open_notice_ids(&self, item_id: &str, recipient_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(
                "SELECT id FROM drive_notice WHERE itemId = ?1 AND recipientId = ?2 AND dismissedAt IS NULL",
                &[
                    Value::Text(item_id.into()),
                    Value::Text(recipient_id.into()),
                ],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "id"))
            .collect())
    }

    /// Undismissed notices for files the caller can still open.
    pub fn notices(&self, who: &Principal) -> DriveResult<Vec<ShareNotice>> {
        let mut out = Vec::new();
        for row in self.db.query(
            "SELECT * FROM drive_notice WHERE recipientId = ?1 AND dismissedAt IS NULL ORDER BY createdAt DESC, id DESC",
            &[Value::Text(who.id.clone())],
        )? {
            let Some(item_id) = text(&row, "itemId") else {
                continue;
            };
            let Some(item) = self.db.get("drive_item", &item_id)? else {
                continue;
            };
            if int(&item, "trashed") != 0 {
                continue;
            }
            if self.role(who, &item_id)?.is_none() {
                continue;
            }
            let Some(role) = text(&row, "role").and_then(|r| Role::parse(&r)) else {
                continue;
            };
            out.push(ShareNotice {
                id: text(&row, "id").unwrap_or_default(),
                item_id,
                item_name: text(&item, "name").unwrap_or_default(),
                sharer_id: text(&row, "sharerId").unwrap_or_default(),
                role,
                created_at: text(&row, "createdAt").unwrap_or_default(),
            });
        }
        Ok(out)
    }

    /// Hide a notice. The file stays shared. Only the recipient can do this.
    pub fn dismiss_notice(&self, who: &Principal, id: &str) -> DriveResult<()> {
        let row = self
            .db
            .get("drive_notice", id)?
            .ok_or(DriveError::NotFound)?;
        if text(&row, "recipientId").as_deref() != Some(who.id.as_str()) && !who.admin {
            return Err(DriveError::Forbidden);
        }
        if text(&row, "dismissedAt").is_some() {
            return Ok(());
        }
        let now = iso_now();
        self.db
            .transact(|tx| tx.upsert("drive_notice", id, [("dismissedAt", Value::Text(now))]))?;
        Ok(())
    }

    /// A new file the caller owns at the top of My Drive, with the same name
    /// and the same bytes. Access to the original is unchanged.
    pub fn keep_copy(&self, who: &Principal, id: &str) -> DriveResult<Item> {
        let item = self.get(who, id)?;
        if item.kind != "file" {
            return Err(DriveError::BadRequest(
                "Only files can be kept as a copy in My Drive.".into(),
            ));
        }
        if let Some(hash) = item.content_hash.as_deref() {
            let parsed: Hash = hash
                .parse()
                .map_err(|_| DriveError::Other(anyhow::anyhow!("corrupt content hash")))?;
            if !self.blobs.missing(&parsed)?.is_empty() {
                return Err(DriveError::Unavailable);
            }
        }
        let created = self.create(who, None, &item.name, "file", item.mime.as_deref())?;
        let Some(hash) = item.content_hash.clone() else {
            return Ok(created);
        };
        let version = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_version",
                &version,
                [
                    ("itemId", Value::Text(created.id.clone())),
                    ("contentHash", hash.into()),
                    ("size", Value::Integer(item.size)),
                    ("authorId", who.id.clone().into()),
                    ("createdAt", now.clone().into()),
                ],
            )?;
            tx.upsert(
                "drive_item",
                &created.id,
                [
                    ("headVersionId", Value::Text(version)),
                    ("size", Value::Integer(item.size)),
                    ("updatedAt", now.into()),
                ],
            )
        })?;
        self.get(who, &created.id)
    }

    /// Set or clear the moment a grant stops working. `None` clears it.
    /// The owner's own access has no end date. A past time ends access now.
    pub fn set_expiry(
        &self,
        who: &Principal,
        id: &str,
        principal_type: &str,
        principal_id: &str,
        expires_at: Option<&str>,
    ) -> DriveResult<ItemAccess> {
        self.require(who, id, Role::Owner)?;
        if principal_type != "user" && principal_type != "org" {
            return Err(DriveError::BadRequest(
                "principalType must be user or org".into(),
            ));
        }
        if principal_type == "user"
            && text(&self.item_row(id)?, "ownerId").as_deref() == Some(principal_id)
        {
            return Err(DriveError::BadRequest(
                "The owner's access does not expire.".into(),
            ));
        }
        let key = format!("{id}:{principal_type}:{principal_id}");
        if self.db.get("drive_acl", &key)?.is_none() {
            return Err(DriveError::BadRequest(
                "Share the file with them before setting an end date.".into(),
            ));
        }
        let stored = match expires_at.map(str::trim).filter(|s| !s.is_empty()) {
            Some(raw) => Value::Text(normalize_expiry(raw)?),
            None => Value::Null,
        };
        self.db
            .transact(|tx| tx.upsert("drive_acl", &key, [("expiresAt", stored)]))?;
        self.access(who, id)
    }

    /// Make `new_owner` the owner immediately. The caller becomes an editor.
    /// There is no invitation and nothing to accept.
    pub fn transfer(&self, who: &Principal, id: &str, new_owner: &str) -> DriveResult<Item> {
        self.require(who, id, Role::Owner)?;
        let new_owner = new_owner.trim();
        if new_owner.is_empty() || new_owner.len() > 128 || new_owner.contains(['/', '\\', '\0']) {
            return Err(DriveError::BadRequest(
                "Choose a person to own this file.".into(),
            ));
        }
        let current = text(&self.item_row(id)?, "ownerId").unwrap_or_default();
        if new_owner == current {
            return Err(DriveError::BadRequest("They already own this file.".into()));
        }
        // Folder owners can manage what is inside, but only this item's owner
        // can hand the item itself to someone else.
        if !who.admin && current != who.id {
            return Err(DriveError::Forbidden);
        }
        let previous = current;
        let editor_key = format!("{id}:user:{previous}");
        let dropped_key = format!("{id}:user:{new_owner}");
        self.db.transact(|tx| {
            tx.upsert(
                "drive_item",
                id,
                [
                    ("ownerId", Value::Text(new_owner.to_owned())),
                    ("updatedAt", iso_now().into()),
                ],
            )?;
            tx.upsert(
                "drive_acl",
                &editor_key,
                [
                    ("itemId", Value::from(id)),
                    ("principalType", Value::from("user")),
                    ("principalId", Value::from(previous.as_str())),
                    ("role", Value::from(Role::Editor.as_str())),
                    ("expiresAt", Value::Null),
                ],
            )?;
            tx.delete("drive_acl", &dropped_key)
        })?;
        self.get(who, id)
    }

    /// Answer a peer's blob request with as many requested blobs as fit.
    pub fn handle_blob_request(&self, data: &[u8]) -> Vec<u8> {
        let mut response = BlobResponse::default();
        if let Ok(request) = ciborium::from_reader::<BlobRequest, _>(data) {
            let mut size = 0;
            for hash in request.hashes.into_iter().take(256) {
                let blob = self.blobs.get(&hash).ok().flatten();
                let len = blob.as_ref().map_or(0, Vec::len);
                if size > 0 && size + len > MAX_BLOB_RESPONSE {
                    break;
                }
                size += len;
                response.blobs.push((hash, blob.map(ByteBuf::from)));
            }
        }
        let mut out = Vec::new();
        ciborium::into_writer(&response, &mut out).expect("CBOR encoding into a Vec cannot fail");
        out
    }

    /// Fetch every missing blob of `content` from peers. Returns whether the
    /// content is complete locally.
    pub async fn fetch(
        &self,
        content: Hash,
        transport: &dyn BlobTransport,
    ) -> anyhow::Result<bool> {
        loop {
            let missing = self.blobs.missing(&content)?;
            if missing.is_empty() {
                self.wanted.lock().unwrap().remove(&content);
                return Ok(true);
            }
            let mut progress = false;
            for peer in transport.peers().await {
                for batch in missing.chunks(16) {
                    let mut request = Vec::new();
                    ciborium::into_writer(
                        &BlobRequest {
                            hashes: batch.to_vec(),
                        },
                        &mut request,
                    )?;
                    let reply = match transport.request(&peer, request).await {
                        Ok(r) => r,
                        Err(e) => {
                            tracing::debug!("blob request to {peer}: {e:#}");
                            break;
                        }
                    };
                    let response: BlobResponse = ciborium::from_reader(reply.as_slice())?;
                    for (hash, bytes) in response.blobs {
                        if let Some(bytes) = bytes
                            && batch.contains(&hash)
                            && self.blobs.put_verified(&hash, &bytes).is_ok()
                        {
                            progress = true;
                        }
                    }
                }
                if progress {
                    break;
                }
            }
            if !progress {
                return Ok(false);
            }
        }
    }

    /// Fetch wanted content whenever new versions arrive, and retry
    /// periodically for content no connected peer had yet.
    pub async fn replicate(self: Arc<Self>, transport: Arc<dyn BlobTransport>, retry: Duration) {
        loop {
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(retry) => {}
            }
            for hash in self.wanted() {
                match self.fetch(hash, transport.as_ref()).await {
                    Ok(true) => tracing::info!("replicated content {hash}"),
                    Ok(false) => {}
                    Err(e) => tracing::warn!("replicating {hash}: {e:#}"),
                }
            }
        }
    }
}
