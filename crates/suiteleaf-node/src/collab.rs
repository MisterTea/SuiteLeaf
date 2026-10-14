//! Live multiuser editing. Presence lives in SuiteDB. The Yjs document lives
//! on the node. Idle writers are dropped with no message to the editor. A
//! room that was multiuser is compacted into the file only after the last
//! writer is gone.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use axum::{
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use suitedb::{Db, Value as DbValue};
use suitedrive::{Drive, Principal, Role};
use tokio::sync::broadcast;
use yrs::{Array, Doc, GetString, ReadTxn, Transact, Update, updates::decoder::Decode};

use crate::{auth::AuthUser, http::AppState};

pub const IDLE_MS: i64 = 15 * 60 * 1000;

#[derive(Clone)]
pub struct Rooms {
    db: Arc<Db>,
    drive: Arc<Drive>,
    live: Arc<Mutex<HashMap<String, Live>>>,
}

struct Live {
    doc: Doc,
    mode: &'static str,
    generation: i64,
    /// File JSON captured when the room became multiuser.
    baseline: Option<Vec<u8>>,
    touches: Vec<Touch>,
    relay: broadcast::Sender<String>,
}

#[derive(Clone)]
struct Touch {
    user_id: String,
    name: String,
    at: String,
    unit: String,
    key: String,
}

struct LiveUpdate<'a> {
    item: &'a str,
    user_id: &'a str,
    name: &'a str,
    role: Role,
    bytes: &'a [u8],
    unit: &'a str,
    key: &'a str,
    at: &'a str,
}

impl Rooms {
    pub fn new(db: Arc<Db>, drive: Arc<Drive>) -> Self {
        Rooms {
            db,
            drive,
            live: Arc::default(),
        }
    }

    pub fn join(&self, item: &str, user: &AuthUser, role: Role, now: i64) -> anyhow::Result<Join> {
        if role < Role::Commenter {
            return Ok(Join {
                joined: false,
                mode: "solo",
                state: None,
            });
        }
        let id = presence_id(item, &user.id);
        let writers = self.writers(item)?;
        let already = writers.iter().any(|row| row.user_id == user.id);
        self.db.transact(|tx| {
            tx.upsert(
                "drive_presence",
                &id,
                [
                    ("itemId", DbValue::from(item)),
                    ("userId", DbValue::from(user.id.as_str())),
                    (
                        "name",
                        DbValue::from(user.name.clone().unwrap_or_else(|| "You".into())),
                    ),
                    ("role", DbValue::from(role_name(role))),
                    ("lastActiveMs", DbValue::Integer(now)),
                ],
            )
        })?;
        let count = if already {
            writers.len()
        } else {
            writers.len() + 1
        };
        // One guard at a time. `std::sync::Mutex` is not reentrant, and a
        // second lock on this thread never returns.
        let promoted = {
            let mut live = self.live.lock().expect("rooms");
            let room = live.entry(item.to_owned()).or_insert_with(|| {
                let (relay, _) = broadcast::channel(64);
                Live {
                    doc: Doc::new(),
                    mode: "solo",
                    generation: 0,
                    baseline: None,
                    touches: Vec::new(),
                    relay,
                }
            });
            if count >= 2 && room.mode == "solo" {
                room.mode = "multiuser";
                room.generation += 1;
                Some(room.generation)
            } else {
                None
            }
        };
        if let Some(generation) = promoted {
            let who = Principal {
                id: user.id.clone(),
                admin: false,
            };
            let baseline = self
                .drive
                .read(&who, item, None)
                .ok()
                .map(|(_item, bytes)| bytes);
            let mut live = self.live.lock().expect("rooms");
            if let Some(room) = live.get_mut(item) {
                room.baseline = baseline;
            }
            drop(live);
            self.db.transact(|tx| {
                tx.upsert(
                    "drive_room",
                    item,
                    [
                        ("mode", DbValue::from("multiuser")),
                        ("generation", DbValue::Integer(generation)),
                        ("baseline", DbValue::from("")),
                    ],
                )
            })?;
        }
        let live = self.live.lock().expect("rooms");
        let state = live.get(item).and_then(|room| {
            let txn = room.doc.transact();
            let update = txn.encode_state_as_update_v1(&yrs::StateVector::default());
            if update.len() <= 2 {
                None
            } else {
                Some(STANDARD.encode(update))
            }
        });
        let mode = live.get(item).map(|room| room.mode).unwrap_or("solo");
        Ok(Join {
            joined: true,
            mode,
            state,
        })
    }

    pub fn activity(&self, item: &str, user_id: &str, now: i64) -> anyhow::Result<()> {
        let id = presence_id(item, user_id);
        if self.db.get("drive_presence", &id)?.is_none() {
            return Ok(());
        }
        self.db.transact(|tx| {
            tx.upsert(
                "drive_presence",
                &id,
                [("lastActiveMs", DbValue::Integer(now))],
            )
        })?;
        Ok(())
    }

    fn apply_update(&self, update: LiveUpdate<'_>) -> anyhow::Result<bool> {
        if update.role == Role::Commenter && update.unit != "comment" {
            return Ok(false);
        }
        let mut live = self.live.lock().expect("rooms");
        let Some(room) = live.get_mut(update.item) else {
            return Ok(false);
        };
        if room.mode != "multiuser" {
            return Ok(false);
        }
        let decoded = Update::decode_v1(update.bytes).context("decode Yjs update")?;
        room.doc
            .transact_mut()
            .apply_update(decoded)
            .context("apply Yjs update")?;
        let generation = room.generation;
        if update.unit != "comment" {
            room.touches.push(Touch {
                user_id: update.user_id.to_owned(),
                name: update.name.to_owned(),
                at: update.at.to_owned(),
                unit: update.unit.to_owned(),
                key: update.key.to_owned(),
            });
        }
        let _ = room.relay.send(STANDARD.encode(update.bytes));
        drop(live);
        let id = uuid::Uuid::now_v7().to_string();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_room_update",
                &id,
                [
                    ("itemId", DbValue::from(update.item)),
                    ("generation", DbValue::Integer(generation)),
                    ("bytes", DbValue::from(STANDARD.encode(update.bytes))),
                    ("userId", DbValue::from(update.user_id)),
                    ("at", DbValue::from(update.at)),
                    ("unit", DbValue::from(update.unit)),
                    ("key", DbValue::from(update.key)),
                ],
            )
        })?;
        Ok(true)
    }

    /// Drop idle presence. Compacts only when a multiuser room is left empty.
    pub fn kick(&self, now: i64, pause: i64) -> anyhow::Result<Vec<String>> {
        let rows = self.db.query("SELECT * FROM drive_presence", &[])?;
        let mut kicked = Vec::new();
        for row in rows {
            let last = int_col(&row, "lastActiveMs");
            if now.saturating_sub(last) < pause {
                continue;
            }
            let Some(id) = text_col(&row, "id") else {
                continue;
            };
            let item = text_col(&row, "itemId").unwrap_or_default();
            let user = text_col(&row, "userId").unwrap_or_default();
            self.db.transact(|tx| tx.delete("drive_presence", &id))?;
            kicked.push(user.clone());
            self.maybe_compact(&item, &user, now)?;
        }
        Ok(kicked)
    }

    fn maybe_compact(&self, item: &str, author: &str, now: i64) -> anyhow::Result<()> {
        if !self.writers(item)?.is_empty() {
            return Ok(());
        }
        let mut live = self.live.lock().expect("rooms");
        let Some(room) = live.get_mut(item) else {
            return Ok(());
        };
        if room.mode != "multiuser" {
            return Ok(());
        }
        let stored = self.db.get("drive_room", item)?;
        let generation = room.generation;
        if stored
            .as_ref()
            .and_then(|row| row.get("generation"))
            .and_then(as_int)
            != Some(generation)
            && stored.is_some()
        {
            // Another node already advanced the room.
        }
        let paragraphs = paragraph_texts(&room.doc);
        let baseline = room.baseline.clone();
        let touches = room.touches.clone();
        room.mode = "solo";
        room.touches.clear();
        room.baseline = None;
        room.doc = Doc::new();
        let _ = room.relay.send(String::new());
        drop(live);
        let Some(bytes) = baseline else {
            return Ok(());
        };
        if paragraphs.is_empty() {
            return Ok(());
        }
        let at = iso_from_ms(now);
        let next = compact_bytes(&bytes, &paragraphs, &touches, &at)?;
        let _ = self.drive.write_head(author, item, &next);
        let _ = self.db.transact(|tx| {
            tx.upsert(
                "drive_room",
                item,
                [
                    ("mode", DbValue::from("solo")),
                    ("generation", DbValue::Integer(generation + 1)),
                    ("baseline", DbValue::from("")),
                ],
            )
        });
        Ok(())
    }

    fn writers(&self, item: &str) -> anyhow::Result<Vec<Presence>> {
        let rows = self.db.query(
            "SELECT * FROM drive_presence WHERE itemId = ?1",
            &[DbValue::Text(item.into())],
        )?;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(Presence {
                    user_id: text_col(&row, "userId")?,
                })
            })
            .collect())
    }
}

struct Presence {
    user_id: String,
}

pub struct Join {
    pub joined: bool,
    pub mode: &'static str,
    pub state: Option<String>,
}

fn presence_id(item: &str, user: &str) -> String {
    format!("{item}:{user}")
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn iso_from_ms(ms: i64) -> String {
    // Milliseconds since epoch, formatted as UTC. Good enough for the file clock.
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    // Howard Hinnant's civil_from_days, shifted so day 0 is 1970-01-01.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

fn paragraph_texts(doc: &Doc) -> Vec<String> {
    let txn = doc.transact();
    let Some(arr) = txn.get_array("paragraphs") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for index in 0..arr.len(&txn) {
        if let Some(yrs::Out::YText(text)) = arr.get(&txn, index) {
            out.push(text.get_string(&txn));
        }
    }
    out
}

fn text_col(row: &std::collections::BTreeMap<String, DbValue>, key: &str) -> Option<String> {
    match row.get(key) {
        Some(DbValue::Text(text)) => Some(text.clone()),
        _ => None,
    }
}

fn int_col(row: &std::collections::BTreeMap<String, DbValue>, key: &str) -> i64 {
    row.get(key).and_then(as_int).unwrap_or(0)
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Viewer => "viewer",
        Role::Commenter => "commenter",
        Role::Responder => "responder",
        Role::Editor => "editor",
        Role::Owner => "owner",
    }
}

fn role_of(drive: &Drive, who: &Principal, id: &str) -> suitedrive::DriveResult<Option<Role>> {
    drive.get(who, id).map(|item| item.role)
}

fn as_int(value: &DbValue) -> Option<i64> {
    match value {
        DbValue::Integer(n) => Some(*n),
        _ => None,
    }
}

/// Replace paragraph text in a SuiteLeaf file and append one edit per person
/// per changed paragraph, plus one version. The raw Yjs log is not stored.
fn compact_bytes(
    bytes: &[u8],
    paragraphs: &[String],
    touches: &[Touch],
    at: &str,
) -> anyhow::Result<Vec<u8>> {
    let mut file: Value = serde_json::from_slice(bytes).context("file json")?;
    let before = file.get("content").cloned().unwrap_or(Value::Null);
    let mut content = before.clone();
    apply_paragraphs(&mut content, paragraphs);
    let regions = changed_paragraphs(&before, &content);
    let mut edits = file
        .get("edits")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut versions = file
        .get("versions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut through = String::new();
    let mut last_by = json!({ "id": "local", "name": "You" });
    if regions.is_empty() && before != content {
        let id = uuid::Uuid::now_v7().to_string();
        through = id.clone();
        edits.push(json!({
            "id": id,
            "at": at,
            "by": last_by,
            "op": { "kind": "region", "unit": "paragraph", "key": "0" }
        }));
    }
    for key in regions {
        let matched: Vec<&Touch> = touches
            .iter()
            .filter(|touch| touch.unit == "paragraph" && touch.key == key)
            .collect();
        let authors: Vec<&Touch> = if matched.is_empty() {
            touches.iter().rev().take(1).collect()
        } else {
            matched
        };
        let mut seen = std::collections::BTreeSet::new();
        for touch in authors {
            if !seen.insert(touch.user_id.clone()) {
                continue;
            }
            let id = uuid::Uuid::now_v7().to_string();
            through = id.clone();
            last_by = json!({ "id": touch.user_id, "name": touch.name });
            edits.push(json!({
                "id": id,
                "at": touch.at,
                "by": last_by,
                "op": { "kind": "region", "unit": "paragraph", "key": key }
            }));
        }
    }
    if !through.is_empty() {
        versions.push(json!({
            "id": uuid::Uuid::now_v7().to_string(),
            "at": at,
            "by": last_by,
            "summary": "Edited a paragraph",
            "title": file.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled"),
            "throughEdit": through,
            "content": content
        }));
    }
    file["content"] = content;
    file["updatedAt"] = json!(at);
    if !edits.is_empty() {
        file["edits"] = Value::Array(edits);
    }
    if !versions.is_empty() {
        file["versions"] = Value::Array(versions);
    }
    Ok(serde_json::to_vec(&file)?)
}

fn apply_paragraphs(content: &mut Value, paragraphs: &[String]) {
    let mut index = 0;
    fn walk(node: &mut Value, paragraphs: &[String], index: &mut usize) {
        let Some(kind) = node.get("type").and_then(|v| v.as_str()) else {
            return;
        };
        if kind == "paragraph" || kind == "heading" {
            if let Some(text) = paragraphs.get(*index) {
                node["content"] = if text.is_empty() {
                    json!([])
                } else {
                    json!([{ "type": "text", "text": text }])
                };
            }
            *index += 1;
            return;
        }
        if let Some(children) = node.get_mut("content").and_then(|v| v.as_array_mut()) {
            for child in children {
                walk(child, paragraphs, index);
            }
        }
    }
    walk(content, paragraphs, &mut index);
}

fn changed_paragraphs(before: &Value, after: &Value) -> Vec<String> {
    let left = paragraph_list(before);
    let right = paragraph_list(after);
    let count = left.len().max(right.len());
    let mut keys = Vec::new();
    for index in 0..count {
        if left.get(index) != right.get(index) {
            keys.push(index.to_string());
        }
    }
    keys
}

fn paragraph_list(content: &Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(node: &Value, out: &mut Vec<String>) {
        let Some(kind) = node.get("type").and_then(|v| v.as_str()) else {
            return;
        };
        if kind == "paragraph" || kind == "heading" {
            let text = node
                .get("content")
                .and_then(|v| v.as_array())
                .map(|parts| {
                    parts
                        .iter()
                        .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                        .collect::<String>()
                })
                .unwrap_or_default();
            if !text.trim().is_empty() {
                out.push(text);
            }
            return;
        }
        if let Some(children) = node.get("content").and_then(|v| v.as_array()) {
            for child in children {
                walk(child, out);
            }
        }
    }
    walk(content, &mut out);
    out
}

#[derive(Deserialize)]
pub struct TokenQuery {
    access_token: Option<String>,
}

pub async fn session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<TokenQuery>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    let mut headers = headers;
    if let Some(token) = query.access_token.as_deref()
        && let Ok(value) = format!("Bearer {token}").parse()
    {
        headers.insert(header::AUTHORIZATION, value);
    }
    let Some(user) = state.auth.user(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let who = Principal {
        id: user.id.clone(),
        admin: user.is_admin(),
    };
    let drive = state.drive.clone();
    let item_id = id.clone();
    let role = match tokio::task::spawn_blocking(move || role_of(&drive, &who, &item_id)).await {
        Ok(Ok(role)) => role,
        _ => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let Some(role) = role else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let rooms = state.rooms.clone();
    upgrade
        .on_upgrade(move |socket| async move {
            let _ = run_socket(socket, rooms, id, user, role).await;
        })
        .into_response()
}

async fn run_socket(
    socket: WebSocket,
    rooms: Rooms,
    item: String,
    user: AuthUser,
    role: Role,
) -> anyhow::Result<()> {
    let (mut sink, mut stream) = socket.split();
    let joined = rooms.join(&item, &user, role, now_ms())?;
    sink.send(Message::Text(
        json!({
            "type": "joined",
            "joined": joined.joined,
            "mode": joined.mode,
            "state": joined.state,
        })
        .to_string()
        .into(),
    ))
    .await?;
    let mut relay = {
        let live = rooms.live.lock().expect("rooms");
        live.get(&item).map(|room| room.relay.subscribe())
    };
    loop {
        let incoming = tokio::select! {
            message = stream.next() => message,
            remote = async {
                match relay.as_mut() {
                    Some(relay) => relay.recv().await.ok(),
                    None => std::future::pending().await,
                }
            } => {
                if let Some(update) = remote
                    && !update.is_empty()
                {
                    let _ = sink
                        .send(Message::Text(
                            json!({"type":"update","update": update}).to_string().into(),
                        ))
                        .await;
                }
                continue;
            }
        };
        let Some(message) = incoming else { break };
        let Message::Text(text) = message? else {
            continue;
        };
        let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "activity" | "join" => {
                rooms.activity(&item, &user.id, now_ms())?;
                if kind == "join" {
                    let again = rooms.join(&item, &user, role, now_ms())?;
                    sink.send(Message::Text(
                        json!({
                            "type": "joined",
                            "joined": again.joined,
                            "mode": again.mode,
                            "state": again.state,
                        })
                        .to_string()
                        .into(),
                    ))
                    .await?;
                }
            }
            "update" | "seed" => {
                let Some(encoded) = value.get("update").and_then(|v| v.as_str()) else {
                    continue;
                };
                let bytes = STANDARD.decode(encoded).unwrap_or_default();
                let unit = value
                    .get("unit")
                    .and_then(|v| v.as_str())
                    .unwrap_or("paragraph");
                let key = value.get("key").and_then(|v| v.as_str()).unwrap_or("0");
                let at = value
                    .get("at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned();
                let at = if at.is_empty() {
                    iso_from_ms(now_ms())
                } else {
                    at
                };
                let name = user.name.clone().unwrap_or_else(|| "You".into());
                if rooms.apply_update(LiveUpdate {
                    item: &item,
                    user_id: &user.id,
                    name: &name,
                    role,
                    bytes: &bytes,
                    unit,
                    key,
                    at: &at,
                })? {
                    rooms.activity(&item, &user.id, now_ms())?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compaction_keeps_both_paragraphs_and_skips_the_yjs_log() {
        let file = br#"{
            "format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes",
            "createdAt":"2026-10-13T18:00:00.000Z","updatedAt":"2026-10-13T18:00:00.000Z",
            "content":{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"One"}]},
                {"type":"paragraph","content":[{"type":"text","text":"Two"}]}
            ]}
        }"#;
        let touches = vec![
            Touch {
                user_id: "maya".into(),
                name: "Maya".into(),
                at: "2026-10-13T18:05:00.000Z".into(),
                unit: "paragraph".into(),
                key: "0".into(),
            },
            Touch {
                user_id: "sam".into(),
                name: "Sam".into(),
                at: "2026-10-13T18:06:00.000Z".into(),
                unit: "paragraph".into(),
                key: "1".into(),
            },
        ];
        let next = compact_bytes(
            file,
            &["One more".into(), "Two more".into()],
            &touches,
            "2026-10-13T18:30:00.000Z",
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&next).unwrap();
        let texts = paragraph_list(value.get("content").unwrap());
        assert_eq!(texts, vec!["One more", "Two more"]);
        assert_eq!(value["edits"].as_array().unwrap().len(), 2);
        assert_eq!(value["versions"].as_array().unwrap().len(), 1);
        assert!(!String::from_utf8_lossy(&next).contains("yjs"));
    }

    #[test]
    fn a_viewer_does_not_count_as_a_writer_role() {
        assert!(Role::Viewer < Role::Commenter);
        assert!(Role::Commenter < Role::Editor);
    }

    #[test]
    fn a_solo_join_returns_instead_of_locking_the_room_twice() {
        use std::{sync::mpsc, time::Duration};

        use crate::{auth::AuthUser, schema::node_schema};
        use suitedrive::Role;

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
        let rooms = Rooms::new(db, drive);
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let ann = AuthUser {
                id: "ann".into(),
                email: None,
                name: Some("Ann".into()),
                role: None,
            };
            let first = rooms.join("file", &ann, Role::Editor, 1).unwrap();
            assert!(first.joined);
            assert_eq!(first.mode, "solo");
            let again = rooms.join("file", &ann, Role::Editor, 2).unwrap();
            assert_eq!(again.mode, "solo");
            let sam = AuthUser {
                id: "sam".into(),
                email: None,
                name: Some("Sam".into()),
                role: None,
            };
            let shared = rooms.join("file", &sam, Role::Editor, 3).unwrap();
            assert_eq!(shared.mode, "multiuser");
            let _ = tx.send(());
        });
        rx.recv_timeout(Duration::from_secs(5))
            .expect("joining a room locked the room map twice");
    }
}
