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

use crate::{
    auth::{Auth, AuthUser},
    http::AppState,
};

pub const IDLE_MS: i64 = 15 * 60 * 1000;

/// Sent on the room relay when a solo room becomes shared. It is not a Yjs update.
const ROOM_SHARED: &str = "mode:multiuser";

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
        // A viewer joins the same room and receives its text. `may_apply` still
        // ignores a viewer's edit.
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
            if !live.contains_key(item) {
                live.insert(item.to_owned(), self.restore_live(item)?);
            }
            let room = live.get_mut(item).expect("room was just stored");
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
        if promoted.is_some()
            && let Some(room) = live.get(item)
        {
            let _ = room.relay.send(ROOM_SHARED.to_owned());
        }
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

    /// People who have joined and have not left. A person who has not typed
    /// is still listed. Idle removal is separate and happens in [`Self::kick`].
    /// A name with a line break is listed as Someone. The stored name stays.
    pub fn occupants(&self, item: &str) -> anyhow::Result<Vec<Occupant>> {
        let rows = self.db.query(
            "SELECT * FROM drive_presence WHERE itemId = ?1",
            &[DbValue::Text(item.into())],
        )?;
        let mut people = rows
            .into_iter()
            .filter_map(|row| {
                Some(Occupant {
                    name: shown_name(&text_col(&row, "name").unwrap_or_else(|| "You".into())),
                    role: text_col(&row, "role").unwrap_or_default(),
                    user_id: text_col(&row, "userId")?,
                })
            })
            .collect::<Vec<_>>();
        people.sort_by(|a, b| a.name.cmp(&b.name).then(a.user_id.cmp(&b.user_id)));
        Ok(people)
    }

    /// A session row for this person exists and every one of those rows has expired.
    /// No session row means this socket was not opened with a session token.
    pub fn session_expired(&self, user_id: &str) -> anyhow::Result<bool> {
        let rows = self.db.query(
            "SELECT expiresAt FROM session WHERE userId = ?1",
            &[DbValue::Text(user_id.into())],
        )?;
        if rows.is_empty() {
            return Ok(false);
        }
        let now = suitedb::hlc::iso_now();
        Ok(rows.iter().all(|row| {
            text_col(row, "expiresAt")
                .map(|expires| expires.as_str() <= now.as_str())
                .unwrap_or(true)
        }))
    }

    /// The person no longer has a role on this file. A viewer stays connected.
    /// The socket is checked on its next message, not at the moment the grant changes.
    pub fn access_ended(&self, user_id: &str, admin: bool, item: &str) -> anyhow::Result<bool> {
        let who = Principal {
            id: user_id.to_owned(),
            admin,
        };
        match self.drive.role(&who, item) {
            Ok(Some(_)) => Ok(false),
            Ok(None) => Ok(true),
            Err(err) => Err(err.into()),
        }
    }

    /// Remove one person as soon as their socket closes, without waiting for the idle sweep.
    pub fn leave(&self, item: &str, user_id: &str, now: i64) -> anyhow::Result<()> {
        let id = presence_id(item, user_id);
        if self.db.get("drive_presence", &id)?.is_none() {
            return Ok(());
        }
        self.db.transact(|tx| tx.delete("drive_presence", &id))?;
        self.maybe_compact(item, user_id, now)?;
        Ok(())
    }

    /// Apply collaboration updates that another process wrote into SuiteDB.
    /// Yjs ignores an update this room already has. A newer generation replaces
    /// the in-memory document with that generation's log.
    pub fn catch_up(&self, item: &str) -> anyhow::Result<bool> {
        let stored = self.db.get("drive_room", item)?;
        let Some(row) = stored else {
            return Ok(false);
        };
        let mode = text_col(&row, "mode").unwrap_or_default();
        let generation = row.get("generation").and_then(as_int).unwrap_or(0);
        if mode != "multiuser" || generation <= 0 {
            return Ok(false);
        }
        let rows = self.db.query(
            "SELECT bytes FROM drive_room_update WHERE itemId = ?1 AND generation = ?2 ORDER BY id",
            &[DbValue::Text(item.into()), DbValue::Integer(generation)],
        )?;
        let mut live = self.live.lock().expect("rooms");
        let Some(room) = live.get_mut(item) else {
            return Ok(false);
        };
        if room.generation > generation {
            return Ok(false);
        }
        if room.generation != generation || room.mode != "multiuser" {
            room.doc = Doc::new();
            room.mode = "multiuser";
            room.generation = generation;
        }
        let before = room.doc.transact().state_vector();
        for row in rows {
            let Some(encoded) = text_col(&row, "bytes") else {
                continue;
            };
            let Ok(bytes) = STANDARD.decode(encoded) else {
                continue;
            };
            let Ok(update) = Update::decode_v1(&bytes) else {
                continue;
            };
            room.doc.transact_mut().apply_update(update).ok();
        }
        let diff = room.doc.transact().encode_state_as_update_v1(&before);
        if diff.len() <= 2 {
            return Ok(false);
        }
        let _ = room.relay.send(STANDARD.encode(diff));
        Ok(true)
    }

    pub fn catch_up_open_rooms(&self) -> anyhow::Result<()> {
        let items = {
            let live = self.live.lock().expect("rooms");
            live.keys().cloned().collect::<Vec<_>>()
        };
        for item in items {
            self.catch_up(&item)?;
        }
        Ok(())
    }

    fn apply_update(&self, update: LiveUpdate<'_>) -> anyhow::Result<bool> {
        // Editors and owners change the document. Commenters and responders
        // may record a comment. A viewer, or a comment passed off as an edit,
        // is ignored.
        if !may_apply(update.role, update.unit) {
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
        if update.unit == "seed" {
            let existing = room
                .doc
                .transact()
                .encode_state_as_update_v1(&yrs::StateVector::default());
            if existing.len() > 2 {
                return Ok(false);
            }
        }
        if update.role < Role::Editor && body_changed(&room.doc, update.bytes)? {
            return Ok(false);
        }
        let generation = room.generation;
        drop(live);
        let stored = STANDARD.encode(update.bytes);
        let existing = self.db.query(
            "SELECT id FROM drive_room_update WHERE itemId = ?1 AND generation = ?2 AND bytes = ?3 LIMIT 1",
            &[
                DbValue::Text(update.item.into()),
                DbValue::Integer(generation),
                DbValue::Text(stored.clone()),
            ],
        )?;
        if existing.is_empty() {
            let id = uuid::Uuid::now_v7().to_string();
            self.db.transact(|tx| {
                tx.upsert(
                    "drive_room_update",
                    &id,
                    [
                        ("itemId", DbValue::from(update.item)),
                        ("generation", DbValue::Integer(generation)),
                        ("bytes", DbValue::from(stored)),
                        ("userId", DbValue::from(update.user_id)),
                        ("at", DbValue::from(update.at)),
                        ("unit", DbValue::from(update.unit)),
                        ("key", DbValue::from(update.key)),
                    ],
                )
            })?;
        }
        let mut live = self.live.lock().expect("rooms");
        let Some(room) = live.get_mut(update.item) else {
            return Ok(true);
        };
        if room.generation != generation {
            return Ok(true);
        }
        room.doc
            .transact_mut()
            .apply_update(decoded)
            .context("apply Yjs update")?;
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
        Ok(true)
    }

    fn relay_text(&self, item: &str, text: &str) {
        let live = self.live.lock().expect("rooms");
        if let Some(room) = live.get(item) {
            let _ = room.relay.send(text.to_owned());
        }
    }

    /// Drop idle presence. Compacts only when a multiuser room is left empty.
    pub fn kick(&self, now: i64, pause: i64) -> anyhow::Result<Vec<String>> {
        let rows = self.db.query("SELECT * FROM drive_presence", &[])?;
        let mut kicked = Vec::new();
        for row in rows {
            let Some(last) = row
                .get("lastActiveMs")
                .and_then(as_int)
                .filter(|ms| *ms > 0)
            else {
                continue;
            };
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
        // Presence is replicated. Another node can delete the idle rows
        // first, and this node is the only one with the Yjs document.
        self.compact_abandoned(now)?;
        Ok(kicked)
    }

    fn compact_abandoned(&self, now: i64) -> anyhow::Result<()> {
        let pending: Vec<(String, String)> = {
            let live = self.live.lock().expect("rooms");
            live.iter()
                .filter(|(_, room)| room.mode == "multiuser")
                .map(|(item, room)| {
                    let author = room
                        .touches
                        .last()
                        .map(|touch| touch.user_id.clone())
                        .unwrap_or_else(|| "local".into());
                    (item.clone(), author)
                })
                .collect()
        };
        for (item, author) in pending {
            if self.writers(&item)?.is_empty() {
                self.maybe_compact(&item, &author, now)?;
            }
        }
        Ok(())
    }

    fn maybe_compact(&self, item: &str, author: &str, now: i64) -> anyhow::Result<()> {
        if !self.writers(item)?.is_empty() {
            return Ok(());
        }
        let (paragraphs, rich, baseline, touches, generation) = {
            let live = self.live.lock().expect("rooms");
            let Some(room) = live.get(item) else {
                return Ok(());
            };
            if room.mode != "multiuser" {
                return Ok(());
            }
            (
                paragraph_texts(&room.doc),
                crate::collab_rich::prosemirror_json(&room.doc),
                room.baseline.clone(),
                room.touches.clone(),
                room.generation,
            )
        };
        // No saved file to write into. Leave the open document where it is.
        let Some(bytes) = baseline else {
            return Ok(());
        };
        if paragraphs.is_empty() && rich.is_none() {
            return Ok(());
        }
        let at = iso_from_ms(now);
        let next = compact_bytes(&bytes, &paragraphs, rich.as_ref(), &touches, &at)?;
        if !self.writers(item)?.is_empty() {
            return Ok(());
        }
        self.drive.write_head(author, item, &next)?;
        let mut live = self.live.lock().expect("rooms");
        let Some(room) = live.get_mut(item) else {
            return Ok(());
        };
        if room.mode != "multiuser" || room.generation != generation {
            return Ok(());
        }
        if paragraph_texts(&room.doc) != paragraphs
            || crate::collab_rich::prosemirror_json(&room.doc) != rich
        {
            return Ok(());
        }
        room.mode = "solo";
        room.touches.clear();
        room.baseline = None;
        room.doc = Doc::new();
        let _ = room.relay.send(String::new());
        drop(live);
        self.db.transact(|tx| {
            tx.upsert(
                "drive_room",
                item,
                [
                    ("mode", DbValue::from("solo")),
                    ("generation", DbValue::Integer(generation + 1)),
                    ("baseline", DbValue::from("")),
                ],
            )
        })?;
        Ok(())
    }

    /// A new process has an empty room map. A multiuser room still in SuiteDB
    /// is rebuilt by replaying that generation's saved Yjs updates in id order.
    fn restore_live(&self, item: &str) -> anyhow::Result<Live> {
        let (relay, _) = broadcast::channel(64);
        let stored = self.db.get("drive_room", item)?;
        let mode = stored
            .as_ref()
            .and_then(|row| text_col(row, "mode"))
            .unwrap_or_else(|| "solo".into());
        let generation = stored
            .as_ref()
            .and_then(|row| row.get("generation"))
            .and_then(as_int)
            .unwrap_or(0);
        let doc = Doc::new();
        if mode == "multiuser" && generation > 0 {
            let rows = self.db.query(
                "SELECT bytes FROM drive_room_update WHERE itemId = ?1 AND generation = ?2 ORDER BY id",
                &[DbValue::Text(item.into()), DbValue::Integer(generation)],
            )?;
            for row in rows {
                let Some(encoded) = text_col(&row, "bytes") else {
                    continue;
                };
                let Ok(bytes) = STANDARD.decode(encoded) else {
                    continue;
                };
                let Ok(update) = Update::decode_v1(&bytes) else {
                    continue;
                };
                doc.transact_mut()
                    .apply_update(update)
                    .context("replay Yjs update")?;
            }
            return Ok(Live {
                doc,
                mode: "multiuser",
                generation,
                baseline: None,
                touches: Vec::new(),
                relay,
            });
        }
        Ok(Live {
            doc,
            mode: "solo",
            generation: 0,
            baseline: None,
            touches: Vec::new(),
            relay,
        })
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

pub struct Occupant {
    pub user_id: String,
    pub name: String,
    pub role: String,
}

pub struct Join {
    pub joined: bool,
    pub mode: &'static str,
    pub state: Option<String>,
}

fn shown_name(name: &str) -> String {
    if name.contains('\n') || name.contains('\r') {
        "Someone".into()
    } else {
        name.to_owned()
    }
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

fn may_apply(role: Role, unit: &str) -> bool {
    if role >= Role::Editor {
        return true;
    }
    role >= Role::Commenter && unit == "comment"
}

/// A comment label is not enough. The update is applied on a copy first.
/// Paragraphs, the ProseMirror fragment, and the sheet, slide, and drawing
/// maps must stay as they are. A comment stored as its own text may change.
fn body_changed(doc: &Doc, bytes: &[u8]) -> anyhow::Result<bool> {
    let before = body_snapshot(doc);
    let probe = Doc::new();
    let state = doc
        .transact()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    if state.len() > 2 {
        probe
            .transact_mut()
            .apply_update(Update::decode_v1(&state).context("decode room")?)
            .context("copy room")?;
    }
    probe
        .transact_mut()
        .apply_update(Update::decode_v1(bytes).context("decode Yjs update")?)
        .context("probe update")?;
    Ok(body_snapshot(&probe) != before)
}

fn body_snapshot(doc: &Doc) -> String {
    use yrs::Map;
    let paragraphs = paragraph_texts(doc).join("\u{1f}");
    let rich = crate::collab_rich::prosemirror_json(doc)
        .map(|value| value.to_string())
        .unwrap_or_default();
    let txn = doc.transact();
    let mut maps = String::new();
    for name in ["cells", "slides", "lines"] {
        let Some(map) = txn.get_map(name) else {
            continue;
        };
        let mut rows: Vec<String> = map
            .iter(&txn)
            .map(|(key, value)| format!("{key}={}", shared_plain(&txn, &value, 0)))
            .collect();
        rows.sort();
        maps.push_str(name);
        maps.push('\n');
        maps.push_str(&rows.join("\n"));
    }
    if let Some(map) = txn.get_map("docAttrs") {
        let mut rows: Vec<String> = map
            .iter(&txn)
            .filter(|(key, _)| *key != "commentThreads")
            .map(|(key, value)| format!("{key}={}", shared_plain(&txn, &value, 0)))
            .collect();
        if !rows.is_empty() {
            rows.sort();
            maps.push_str("docAttrs\n");
            maps.push_str(&rows.join("\n"));
        }
    }
    let mut extra = Vec::new();
    for (name, value) in txn.root_refs() {
        if matches!(
            name,
            "cells" | "slides" | "lines" | "docAttrs" | "prosemirror"
        ) {
            continue;
        }
        match value {
            yrs::Out::YMap(map) => {
                let mut rows: Vec<String> = map
                    .iter(&txn)
                    .map(|(key, value)| format!("{key}={}", shared_plain(&txn, &value, 0)))
                    .collect();
                rows.sort();
                extra.push(format!("{name}\n{}", rows.join("\n")));
            }
            yrs::Out::YArray(arr) => {
                let mut parts = Vec::new();
                for index in 0..arr.len(&txn) {
                    if let Some(value) = arr.get(&txn, index) {
                        parts.push(shared_plain(&txn, &value, 0));
                    }
                }
                extra.push(format!("{name}=[{}]", parts.join(",")));
            }
            yrs::Out::YText(text) => extra.push(format!("{name}={}", text.get_string(&txn))),
            yrs::Out::YXmlText(text) => extra.push(format!("{name}={}", text.get_string(&txn))),
            yrs::Out::YXmlFragment(fragment) => {
                extra.push(format!("{name}={}", xml_plain(&txn, &fragment)))
            }
            yrs::Out::YXmlElement(element) => {
                extra.push(format!("{name}={}", xml_plain(&txn, &element)))
            }
            other => extra.push(format!("{name}={}", shared_plain(&txn, &other, 0))),
        }
    }
    extra.sort();
    format!("{paragraphs}\n{rich}\n{maps}\n{}", extra.join("\n"))
}

fn shared_plain(txn: &impl yrs::ReadTxn, value: &yrs::Out, depth: u8) -> String {
    use yrs::Map;
    if depth > 8 {
        return "other".into();
    }
    match value {
        yrs::Out::Any(any) => format!("{any:?}"),
        yrs::Out::YText(text) => text.get_string(txn),
        yrs::Out::YXmlText(text) => text.get_string(txn),
        yrs::Out::YXmlFragment(fragment) => xml_plain(txn, fragment),
        yrs::Out::YXmlElement(element) => xml_plain(txn, element),
        yrs::Out::YMap(map) => {
            let mut rows: Vec<String> = map
                .iter(txn)
                .map(|(key, nested)| format!("{key}={}", shared_plain(txn, &nested, depth + 1)))
                .collect();
            rows.sort();
            rows.join(",")
        }
        yrs::Out::YArray(arr) => {
            let mut parts = Vec::new();
            for index in 0..arr.len(txn) {
                if let Some(nested) = arr.get(txn, index) {
                    parts.push(shared_plain(txn, &nested, depth + 1));
                }
            }
            format!("[{}]", parts.join(","))
        }
        yrs::Out::YDoc(_) => "doc".into(),
        yrs::Out::UndefinedRef(ptr) => branch_plain(txn, *ptr, depth),
    }
}

fn branch_plain<P>(txn: &impl yrs::ReadTxn, ptr: P, depth: u8) -> String
where
    P: Copy,
    yrs::MapRef: From<P>,
    yrs::ArrayRef: From<P>,
    yrs::TextRef: From<P>,
    yrs::XmlTextRef: From<P>,
{
    use yrs::{Array, Map};
    let mut parts = Vec::new();
    let map = yrs::MapRef::from(ptr);
    let mut rows: Vec<String> = map
        .iter(txn)
        .map(|(key, nested)| format!("{key}={}", shared_plain(txn, &nested, depth + 1)))
        .collect();
    rows.sort();
    if !rows.is_empty() {
        parts.push(rows.join(","));
    }
    let list = yrs::ArrayRef::from(ptr);
    let mut items = Vec::new();
    for index in 0..list.len(txn) {
        if let Some(nested) = list.get(txn, index) {
            items.push(shared_plain(txn, &nested, depth + 1));
        }
    }
    if !items.is_empty() {
        parts.push(format!("[{}]", items.join(",")));
    }
    let words = yrs::TextRef::from(ptr).get_string(txn);
    if !words.is_empty() {
        parts.push(words.clone());
    }
    let xml = yrs::XmlTextRef::from(ptr).get_string(txn);
    if !xml.is_empty() && xml != words {
        parts.push(xml);
    }
    if parts.is_empty() {
        "other".into()
    } else {
        parts.join(" ")
    }
}

fn xml_plain(txn: &impl yrs::ReadTxn, node: &impl yrs::XmlFragment) -> String {
    let mut out = String::new();
    for child in node.children(txn) {
        match child {
            yrs::XmlOut::Text(text) => out.push_str(&text.get_string(txn)),
            yrs::XmlOut::Element(element) => {
                out.push_str(element.tag().as_ref());
                out.push('\n');
                out.push_str(&xml_plain(txn, &element));
            }
            yrs::XmlOut::Fragment(fragment) => out.push_str(&xml_plain(txn, &fragment)),
        }
    }
    out
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

fn embedded_image_src(node: &Value) -> bool {
    let src = node
        .get("attrs")
        .and_then(|attrs| attrs.get("src"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let lower = src.to_ascii_lowercase();
    lower.starts_with("data:image/png;base64,")
        || lower.starts_with("data:image/jpeg;base64,")
        || lower.starts_with("data:image/gif;base64,")
        || lower.starts_with("data:image/webp;base64,")
        || lower.starts_with("data:image/svg+xml;base64,")
}

/// A picture whose source is embedded data stays, including those bytes.
/// A source that is only a file name is removed so the saved file can still open.
fn keep_embedded_images(node: &mut Value) {
    let Some(nodes) = node
        .get_mut("content")
        .and_then(|value| value.as_array_mut())
    else {
        return;
    };
    nodes.retain(|child| {
        let kind = child
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if kind != "image" && kind != "inlineImage" {
            return true;
        }
        embedded_image_src(child)
    });
    for child in nodes {
        keep_embedded_images(child);
    }
}

/// Replace paragraph text in a SuiteLeaf file and append one edit per person
/// per changed paragraph, plus one version. The raw Yjs log is not stored.
fn compact_bytes(
    bytes: &[u8],
    paragraphs: &[String],
    rich: Option<&Value>,
    touches: &[Touch],
    at: &str,
) -> anyhow::Result<Vec<u8>> {
    let mut file: Value = serde_json::from_slice(bytes).context("file json")?;
    let before = file.get("content").cloned().unwrap_or(Value::Null);
    let mut content = before.clone();
    if let Some(rich) = rich {
        content = rich.clone();
        keep_embedded_images(&mut content);
    } else {
        apply_paragraphs(&mut content, paragraphs);
    }
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
    let preauth = state.auth.user(&headers);
    if query.access_token.is_some() && preauth.is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let drive = state.drive.clone();
    let rooms = state.rooms.clone();
    if let Some(user) = preauth {
        let role = match accepted_role(drive, &user, &id).await {
            Ok(role) => role,
            Err(status) => return status.into_response(),
        };
        return upgrade
            .on_upgrade(move |socket| async move {
                let _ = run_socket(socket, rooms, id, user, role).await;
            })
            .into_response();
    }
    // The browser cannot set an Authorization header on a WebSocket. The
    // token arrives in the first message so it is not written into the URL.
    let auth = state.auth.clone();
    upgrade
        .on_upgrade(move |mut socket| async move {
            let Some(user) = read_auth_user(&mut socket, &auth).await else {
                let _ = socket
                    .send(Message::Text(
                        json!({"type":"error","reason":"unauthorized"})
                            .to_string()
                            .into(),
                    ))
                    .await;
                return;
            };
            let role = match accepted_role(drive, &user, &id).await {
                Ok(role) => role,
                Err(_) => {
                    let _ = socket
                        .send(Message::Text(
                            json!({"type":"error","reason":"forbidden"})
                                .to_string()
                                .into(),
                        ))
                        .await;
                    return;
                }
            };
            let _ = run_socket(socket, rooms, id, user, role).await;
        })
        .into_response()
}

async fn accepted_role(
    drive: Arc<Drive>,
    user: &AuthUser,
    item_id: &str,
) -> Result<Role, StatusCode> {
    let who = Principal {
        id: user.id.clone(),
        admin: user.is_admin(),
    };
    let item_id = item_id.to_owned();
    match tokio::task::spawn_blocking(move || role_of(&drive, &who, &item_id)).await {
        Ok(Ok(Some(role))) => Ok(role),
        Ok(Ok(None)) => Err(StatusCode::FORBIDDEN),
        _ => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// The first socket message must be `{type:"auth", accessToken}`. The token
/// is not logged.
async fn read_auth_user(socket: &mut WebSocket, auth: &Auth) -> Option<AuthUser> {
    let message = tokio::time::timeout(std::time::Duration::from_secs(5), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = message else {
        return None;
    };
    let value: Value = serde_json::from_str(text.as_str()).unwrap_or(Value::Null);
    if let Err(reason) = protocol_supported(&value) {
        let _ = socket
            .send(Message::Text(
                json!({"type": "reject", "reason": reason})
                    .to_string()
                    .into(),
            ))
            .await;
        return None;
    }
    let token = auth_token(&value)?;
    let mut headers = HeaderMap::new();
    let Ok(header_value) = format!("Bearer {token}").parse() else {
        return None;
    };
    headers.insert(header::AUTHORIZATION, header_value);
    auth.user(&headers)
}

/// The browser and this node both speak protocol 1. A missing number is 1.
pub(crate) const COLLAB_PROTOCOL: i64 = 1;

pub(crate) fn protocol_supported(value: &Value) -> Result<(), &'static str> {
    match value.get("protocol") {
        None => Ok(()),
        Some(number) if number.as_i64() == Some(COLLAB_PROTOCOL) => Ok(()),
        Some(_) => Err("This app speaks collaboration protocol 1."),
    }
}

pub(crate) fn auth_token(value: &Value) -> Option<&str> {
    if value.get("type").and_then(|v| v.as_str()) != Some("auth") {
        return None;
    }
    let token = value.get("accessToken").and_then(|v| v.as_str())?.trim();
    if token.is_empty() || token.len() > 8_192 || token.contains('\n') || token.contains('\r') {
        return None;
    }
    Some(token)
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
        joined_message(&rooms, &item, &joined)?.into(),
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
                    if update == ROOM_SHARED {
                        let again = rooms.join(&item, &user, role, now_ms())?;
                        let _ = sink
                            .send(Message::Text(
                                joined_message(&rooms, &item, &again)?.into(),
                            ))
                            .await;
                    } else if let Some(body) = update.strip_prefix("sel:") {
                        let _ = sink.send(Message::Text(body.to_owned().into())).await;
                    } else {
                        let _ = sink
                            .send(Message::Text(
                                json!({"type":"update","update": update}).to_string().into(),
                            ))
                            .await;
                    }
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
        if rooms.session_expired(&user.id)?
            || rooms.access_ended(&user.id, user.is_admin(), &item)?
        {
            let _ = sink
                .send(Message::Text(
                    json!({"type":"error","reason":"unauthorized"})
                        .to_string()
                        .into(),
                ))
                .await;
            break;
        }
        match kind {
            "activity" | "join" => {
                rooms.activity(&item, &user.id, now_ms())?;
                if kind == "join" {
                    if let Err(reason) = protocol_supported(&value) {
                        let _ = sink
                            .send(Message::Text(
                                json!({"type":"reject","reason":reason}).to_string().into(),
                            ))
                            .await;
                        break;
                    }
                    let again = rooms.join(&item, &user, role, now_ms())?;
                    sink.send(Message::Text(joined_message(&rooms, &item, &again)?.into()))
                        .await?;
                }
            }
            "update" | "seed" => {
                let Some(encoded) = value.get("update").and_then(|v| v.as_str()) else {
                    continue;
                };
                let bytes = STANDARD.decode(encoded).unwrap_or_default();
                let unit = if kind == "seed" {
                    "seed"
                } else {
                    value
                        .get("unit")
                        .and_then(|v| v.as_str())
                        .unwrap_or("paragraph")
                };
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
                let applied = rooms.apply_update(LiveUpdate {
                    item: &item,
                    user_id: &user.id,
                    name: &name,
                    role,
                    bytes: &bytes,
                    unit,
                    key,
                    at: &at,
                })?;
                if applied {
                    rooms.activity(&item, &user.id, now_ms())?;
                }
                if let Some(reply) = update_reply(
                    applied,
                    value.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                ) {
                    sink.send(Message::Text(reply.into())).await?;
                }
            }
            "selection" => {
                let Some(anchor) = value.get("anchor").and_then(|v| v.as_u64()) else {
                    continue;
                };
                let Some(head) = value.get("head").and_then(|v| v.as_u64()) else {
                    continue;
                };
                if anchor > 1_000_000 || head > 1_000_000 {
                    continue;
                }
                let name = user.name.clone().unwrap_or_else(|| "You".into());
                let body = json!({
                    "type": "selection",
                    "name": name,
                    "anchor": anchor,
                    "head": head,
                })
                .to_string();
                rooms.relay_text(&item, &format!("sel:{body}"));
            }
            _ => {}
        }
    }
    rooms.leave(&item, &user.id, now_ms())?;
    Ok(())
}

/// An acknowledgement means the update is in the journal. A refusal is not stored.
/// The reply names the update id and not the document bytes.
fn update_reply(applied: bool, id: &str) -> Option<String> {
    if id.is_empty() || id.len() > 80 || id.contains('\n') || id.contains('\r') {
        return None;
    }
    Some(
        json!({
            "type": if applied { "ack" } else { "reject" },
            "id": id,
        })
        .to_string(),
    )
}

fn joined_message(rooms: &Rooms, item: &str, joined: &Join) -> anyhow::Result<String> {
    let occupants = rooms
        .occupants(item)?
        .into_iter()
        .map(|person| json!({ "name": person.name, "role": person.role }))
        .collect::<Vec<_>>();
    Ok(json!({
        "type": "joined",
        "joined": joined.joined,
        "mode": joined.mode,
        "state": joined.state,
        "occupants": occupants,
    })
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_acknowledgement_names_the_update_and_not_the_document() {
        let ack = update_reply(true, "edit-1").unwrap();
        assert!(ack.contains("\"type\":\"ack\""));
        assert!(ack.contains("edit-1"));
        assert!(!ack.contains("Tomatoes"));
        let reject = update_reply(false, "view-1").unwrap();
        assert!(reject.contains("\"type\":\"reject\""));
        assert!(update_reply(true, "").is_none());
        assert!(update_reply(true, "line\nbreak").is_none());
    }

    #[test]
    fn an_auth_message_is_the_only_place_a_token_is_accepted() {
        assert_eq!(
            auth_token(&json!({"type":"auth","accessToken":"abc.def.ghi"})),
            Some("abc.def.ghi")
        );
        assert_eq!(
            auth_token(&json!({"type":"update","accessToken":"secret"})),
            None
        );
        assert_eq!(auth_token(&json!({"type":"auth","accessToken":"  "})), None);
        assert_eq!(
            auth_token(&json!({"type":"auth","accessToken":"line\nbreak"})),
            None
        );
        assert!(protocol_supported(&json!({"type":"auth","accessToken":"abc"})).is_ok());
        assert!(protocol_supported(&json!({"type":"auth","protocol": 1})).is_ok());
        let refused = protocol_supported(&json!({"type":"auth","protocol":"secret-value"}));
        assert_eq!(refused, Err("This app speaks collaboration protocol 1."));
        assert!(!refused.unwrap_err().contains("secret-value"));
        assert!(protocol_supported(&json!({"protocol": 2})).is_err());
        let join = protocol_supported(&json!({"type":"join","protocol":"secret-value"}));
        assert_eq!(join, Err("This app speaks collaboration protocol 1."));
        assert!(protocol_supported(&json!({"type":"join","protocol":1})).is_ok());
    }

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
            None,
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
    fn compaction_keeps_embedded_image_bytes_and_drops_a_file_name() {
        let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let file = br#"{
            "format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes",
            "createdAt":"2026-10-13T18:00:00.000Z","updatedAt":"2026-10-13T18:00:00.000Z",
            "content":{"type":"doc","content":[
                {"type":"paragraph","content":[{"type":"text","text":"One"}]}
            ]}
        }"#;
        let rich = json!({
            "type": "doc",
            "content": [
                {"type":"paragraph","content":[{"type":"text","text":"One"}]},
                {"type":"image","attrs":{"alt":"North beds","src": png}},
                {"type":"image","attrs":{"alt":"Missing","src":"bed.png"}}
            ]
        });
        let next = compact_bytes(
            file,
            &["One".into()],
            Some(&rich),
            &[],
            "2026-10-31T12:00:00.000Z",
        )
        .unwrap();
        let saved = String::from_utf8(next).unwrap();
        assert!(saved.contains(png));
        assert!(!saved.contains("bed.png"));
        assert!(saved.contains("North beds"));
        assert!(!saved.contains("Missing"));
    }

    #[test]
    fn a_viewer_does_not_count_as_a_writer_role() {
        assert!(Role::Viewer < Role::Commenter);
        assert!(Role::Commenter < Role::Editor);
    }

    #[test]
    fn leaving_drops_a_person_before_the_idle_sweep() {
        use crate::{auth::AuthUser, schema::node_schema};

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
        let ann = AuthUser {
            id: "ann".into(),
            email: None,
            name: Some("Ann".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join("file", &ann, Role::Editor, 1).unwrap();
        rooms.join("file", &sam, Role::Commenter, 1).unwrap();
        let names = rooms
            .occupants("file")
            .unwrap()
            .into_iter()
            .map(|person| person.name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["Ann".to_string(), "Sam".to_string()]);
        rooms.leave("file", "sam", 2).unwrap();
        let stayed = rooms.occupants("file").unwrap();
        assert_eq!(stayed.len(), 1);
        assert_eq!(stayed[0].name, "Ann");
        assert!(rooms.kick(2, 15 * 60 * 1000).unwrap().is_empty());
    }

    #[test]
    fn a_name_with_a_line_break_is_listed_as_someone() {
        use crate::{auth::AuthUser, schema::node_schema};
        use suitedb::Value;

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
        let noor = AuthUser {
            id: "noor".into(),
            email: None,
            name: Some("Garden\nsecret-value".into()),
            role: None,
        };
        rooms.join("file", &noor, Role::Editor, 1).unwrap();
        let people = rooms.occupants("file").unwrap();
        assert_eq!(people.len(), 1);
        assert_eq!(people[0].name, "Someone");
        assert_eq!(people[0].user_id, "noor");
        let stored = rooms
            .db
            .get("drive_presence", &presence_id("file", "noor"))
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.get("name"),
            Some(&Value::Text("Garden\nsecret-value".into()))
        );
    }

    #[test]
    fn an_idle_room_keeps_text_when_there_is_no_file_to_write() {
        use crate::{auth::AuthUser, schema::node_schema};
        use yrs::{Array, TextPrelim, Transact};

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
        let maya = AuthUser {
            id: "maya".into(),
            email: None,
            name: Some("Maya".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join("missing", &maya, Role::Editor, 1).unwrap();
        rooms.join("missing", &sam, Role::Editor, 2).unwrap();
        let doc = Doc::new();
        let paragraphs = doc.get_or_insert_array("paragraphs");
        let before = doc.transact().state_vector();
        {
            let mut txn = doc.transact_mut();
            paragraphs.insert(&mut txn, 0, TextPrelim::new("Tomatoes are in"));
        }
        let update = doc.transact().encode_state_as_update_v1(&before);
        rooms
            .apply_update(LiveUpdate {
                item: "missing",
                user_id: "maya",
                name: "Maya",
                role: Role::Editor,
                bytes: &update,
                unit: "paragraph",
                key: "0",
                at: "2026-10-31T12:00:00.000Z",
            })
            .unwrap();
        rooms.leave("missing", "maya", 3).unwrap();
        rooms.leave("missing", "sam", 4).unwrap();
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("missing").expect("room");
        assert_eq!(room.mode, "multiuser");
        assert_eq!(
            paragraph_texts(&room.doc),
            vec!["Tomatoes are in".to_string()]
        );
    }

    #[test]
    fn a_second_process_catches_up_to_updates_in_the_shared_log() {
        use crate::{auth::AuthUser, schema::node_schema};
        use yrs::{GetString, Text};

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
        let here = Rooms::new(db.clone(), drive.clone());
        let there = Rooms::new(db, drive);
        let ann = AuthUser {
            id: "ann".into(),
            email: None,
            name: Some("Ann".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        there.join("file", &ann, Role::Editor, 1).unwrap();
        here.join("file", &ann, Role::Editor, 1).unwrap();
        here.join("file", &sam, Role::Editor, 2).unwrap();
        let doc = Doc::new();
        let root = doc.get_or_insert_text("body");
        let before = doc.transact().state_vector();
        root.insert(&mut doc.transact_mut(), 0, "hello");
        let update = doc.transact().encode_state_as_update_v1(&before);
        assert!(
            here.apply_update(LiveUpdate {
                item: "file",
                user_id: "ann",
                name: "Ann",
                role: Role::Editor,
                bytes: &update,
                unit: "paragraph",
                key: "body",
                at: "2026-10-30T22:00:00.000Z",
            })
            .unwrap()
        );
        assert!(there.catch_up("file").unwrap());
        let live = there.live.lock().unwrap();
        let room = live.get("file").unwrap();
        let text = room.doc.get_or_insert_text("body");
        assert_eq!(text.get_string(&room.doc.transact()), "hello");
        assert_eq!(room.mode, "multiuser");
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

    #[test]
    fn a_new_process_replays_saved_updates_for_the_open_generation() {
        use crate::{auth::AuthUser, schema::node_schema};
        use yrs::{GetString, Text};

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
        let doc = Doc::new();
        let root = doc.get_or_insert_text("body");
        let before = doc.transact().state_vector();
        root.insert(&mut doc.transact_mut(), 0, "hello");
        let update = doc.transact().encode_state_as_update_v1(&before);
        db.transact(|tx| {
            tx.upsert(
                "drive_room",
                "file",
                [
                    ("mode", DbValue::from("multiuser")),
                    ("generation", DbValue::Integer(1)),
                    ("baseline", DbValue::from("")),
                ],
            )?;
            tx.upsert(
                "drive_room_update",
                "018f0000-0000-7000-8000-000000000001",
                [
                    ("itemId", DbValue::from("file")),
                    ("generation", DbValue::Integer(1)),
                    ("bytes", DbValue::from(STANDARD.encode(update))),
                    ("userId", DbValue::from("ann")),
                    ("at", DbValue::from("2026-10-30T22:00:00.000Z")),
                    ("unit", DbValue::from("text")),
                    ("key", DbValue::from("body")),
                ],
            )
        })
        .unwrap();
        let ann = AuthUser {
            id: "ann".into(),
            email: None,
            name: Some("Ann".into()),
            role: None,
        };
        let first = Rooms::new(db.clone(), drive.clone());
        let joined = first.join("file", &ann, Role::Editor, 1).unwrap();
        assert_eq!(joined.mode, "multiuser");
        let encoded = joined.state.expect("replayed state");
        let again = Rooms::new(db, drive);
        let rejoined = again.join("file", &ann, Role::Editor, 2).unwrap();
        assert_eq!(rejoined.state.as_deref(), Some(encoded.as_str()));
        let decoded = STANDARD.decode(encoded).unwrap();
        let restored = Doc::new();
        restored
            .transact_mut()
            .apply_update(Update::decode_v1(&decoded).unwrap())
            .unwrap();
        let text = restored.get_or_insert_text("body");
        assert_eq!(text.get_string(&restored.transact()), "hello");
    }

    #[test]
    fn a_viewer_or_commenter_cannot_change_the_live_document() {
        use crate::{auth::AuthUser, schema::node_schema};

        fn labeled(name: &str, text: &str) -> Vec<u8> {
            use yrs::Text;

            let doc = Doc::new();
            let root = doc.get_or_insert_text(name);
            let before = doc.transact().state_vector();
            root.insert(&mut doc.transact_mut(), 0, text);
            doc.transact().encode_state_as_update_v1(&before)
        }
        fn push(rooms: &Rooms, role: Role, unit: &str, bytes: &[u8]) -> bool {
            rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "person",
                    name: "Person",
                    role,
                    bytes,
                    unit,
                    key: "0",
                    at: "2026-10-30T18:00:00.000Z",
                })
                .unwrap()
        }
        fn root(rooms: &Rooms, name: &str) -> String {
            let live = rooms.live.lock().expect("rooms");
            let room = live.get("file").expect("room");
            let txn = room.doc.transact();
            txn.get_text(name)
                .map(|text| text.get_string(&txn))
                .unwrap_or_default()
        }

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
        let editor = AuthUser {
            id: "maya".into(),
            email: None,
            name: Some("Maya".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join("file", &editor, Role::Editor, 1).unwrap();
        let shared = rooms.join("file", &sam, Role::Editor, 2).unwrap();
        assert_eq!(shared.mode, "multiuser");

        assert!(push(
            &rooms,
            Role::Editor,
            "paragraph",
            &labeled("editorNote", "from an editor")
        ));
        assert!(!push(
            &rooms,
            Role::Viewer,
            "paragraph",
            &labeled("viewerNote", "from a viewer")
        ));
        assert!(!push(
            &rooms,
            Role::Commenter,
            "paragraph",
            &labeled("bodyNote", "from a commenter")
        ));
        assert!(!push(
            &rooms,
            Role::Responder,
            "cell",
            &labeled("sheetNote", "from a responder")
        ));
        assert!(push(
            &rooms,
            Role::Commenter,
            "comment",
            &labeled("commentNote", "from a comment")
        ));
        fn paragraphs_update() -> Vec<u8> {
            use yrs::{Array, TextPrelim};
            let doc = Doc::new();
            let paragraphs = doc.get_or_insert_array("paragraphs");
            let before = doc.transact().state_vector();
            paragraphs.insert(&mut doc.transact_mut(), 0, TextPrelim::new("secret-value"));
            doc.transact().encode_state_as_update_v1(&before)
        }
        fn cells_update() -> Vec<u8> {
            use yrs::Map;
            let doc = Doc::new();
            let cells = doc.get_or_insert_map("cells");
            let before = doc.transact().state_vector();
            cells.insert(&mut doc.transact_mut(), "0:0", "secret-value");
            doc.transact().encode_state_as_update_v1(&before)
        }
        assert!(!push(
            &rooms,
            Role::Commenter,
            "comment",
            &paragraphs_update()
        ));
        assert!(!push(&rooms, Role::Commenter, "comment", &cells_update()));
        assert_eq!(root(&rooms, "editorNote"), "from an editor");
        assert_eq!(root(&rooms, "commentNote"), "from a comment");
        assert!(root(&rooms, "viewerNote").is_empty());
        assert!(root(&rooms, "bodyNote").is_empty());
        assert!(root(&rooms, "sheetNote").is_empty());
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        let snapshot = body_snapshot(&room.doc);
        assert!(!snapshot.contains("secret-value"));
        assert!(paragraph_texts(&room.doc).is_empty());
    }

    #[test]
    fn a_second_seed_does_not_repeat_the_document() {
        use crate::{auth::AuthUser, schema::node_schema};
        use yrs::{Array, TextPrelim};

        fn seed(text: &str) -> Vec<u8> {
            let doc = Doc::new();
            let paragraphs = doc.get_or_insert_array("paragraphs");
            let before = doc.transact().state_vector();
            paragraphs.insert(&mut doc.transact_mut(), 0, TextPrelim::new(text));
            doc.transact().encode_state_as_update_v1(&before)
        }
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
        let maya = AuthUser {
            id: "maya".into(),
            email: None,
            name: Some("Maya".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join("file", &maya, Role::Editor, 1).unwrap();
        assert_eq!(
            rooms.join("file", &sam, Role::Editor, 2).unwrap().mode,
            "multiuser"
        );
        let first = seed("Tomatoes are in");
        assert!(
            rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "maya",
                    name: "Maya",
                    role: Role::Editor,
                    bytes: &first,
                    unit: "seed",
                    key: "0",
                    at: "2026-10-31T18:00:00.000Z",
                })
                .unwrap()
        );
        let second = seed("Tomatoes are in");
        assert!(
            !rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "sam",
                    name: "Sam",
                    role: Role::Editor,
                    bytes: &second,
                    unit: "seed",
                    key: "0",
                    at: "2026-10-31T18:00:01.000Z",
                })
                .unwrap()
        );
        let beans = seed("Beans are staked");
        assert!(
            rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "sam",
                    name: "Sam",
                    role: Role::Editor,
                    bytes: &beans,
                    unit: "paragraph",
                    key: "1",
                    at: "2026-10-31T18:00:02.000Z",
                })
                .unwrap()
        );
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        let texts = paragraph_texts(&room.doc);
        assert_eq!(
            texts
                .iter()
                .filter(|text| text.as_str() == "Tomatoes are in")
                .count(),
            1
        );
        assert!(texts.iter().any(|text| text == "Beans are staked"));
        assert!(!texts.iter().any(|text| text.contains("secret-value")));
    }

    #[test]
    fn a_repeated_update_is_acknowledged_once_in_the_journal() {
        use crate::{auth::AuthUser, schema::node_schema};
        use yrs::Text;

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
        let rooms = Rooms::new(db.clone(), drive);
        let maya = AuthUser {
            id: "maya".into(),
            email: None,
            name: Some("Maya".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join("file", &maya, Role::Editor, 1).unwrap();
        rooms.join("file", &sam, Role::Editor, 2).unwrap();
        let doc = Doc::new();
        let root = doc.get_or_insert_text("body");
        let before = doc.transact().state_vector();
        root.insert(&mut doc.transact_mut(), 0, "Beds");
        let bytes = doc.transact().encode_state_as_update_v1(&before);
        let send = |at: &str| {
            rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "maya",
                    name: "Maya",
                    role: Role::Editor,
                    bytes: &bytes,
                    unit: "text",
                    key: "body",
                    at,
                })
                .unwrap()
        };
        assert!(send("2026-11-01T00:00:00.000Z"));
        assert!(send("2026-11-01T00:00:01.000Z"));
        let rows = db
            .query(
                "SELECT id FROM drive_room_update WHERE itemId = ?1",
                &[DbValue::Text("file".into())],
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        let txn = room.doc.transact();
        let text = txn.get_text("body").unwrap().get_string(&txn);
        assert_eq!(text, "Beds");
        assert!(!text.contains("secret-value"));
        drop(txn);
        drop(live);
        let later = Rooms::new(
            db.clone(),
            Drive::open(db.clone(), &dir.path().join("blobs")).unwrap(),
        );
        later.join("file", &maya, Role::Editor, 3).unwrap();
        let live = later.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        let txn = room.doc.transact();
        let text = txn.get_text("body").unwrap().get_string(&txn);
        assert_eq!(text, "Beds");
    }

    #[test]
    fn an_abandoned_room_is_compacted_when_a_peer_already_cleared_presence() {
        use crate::{auth::AuthUser, schema::node_schema};
        use suitedrive::Principal;
        use yrs::{Array, TextPrelim, Transact};

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
        let file = br#"{"format":"suiteleaf","version":1,"id":"f","kind":"doc","title":"Notes","createdAt":"2026-10-30T18:00:00.000Z","updatedAt":"2026-10-30T18:00:00.000Z","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"North bed"}]},{"type":"paragraph","content":[{"type":"text","text":"South bed"}]}]}}"#;
        let who = Principal {
            id: "maya".into(),
            admin: false,
        };
        let item = drive
            .create(&who, None, "Notes.sldoc", "file", Some("application/json"))
            .unwrap();
        drive
            .write(&who, &item.id, None, Some("application/json"), file)
            .unwrap();
        drive
            .share(&who, &item.id, "user", "sam", Some(Role::Editor))
            .unwrap();
        let rooms = Rooms::new(db, drive.clone());
        let maya = AuthUser {
            id: "maya".into(),
            email: None,
            name: Some("Maya".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join(&item.id, &maya, Role::Editor, 1).unwrap();
        assert_eq!(
            rooms.join(&item.id, &sam, Role::Editor, 2).unwrap().mode,
            "multiuser"
        );
        let doc = Doc::new();
        let paragraphs = doc.get_or_insert_array("paragraphs");
        let before = doc.transact().state_vector();
        {
            let mut txn = doc.transact_mut();
            for text in ["Tomatoes are in", "Beans are staked"] {
                let index = paragraphs.len(&txn);
                paragraphs.insert(&mut txn, index, TextPrelim::new(text));
            }
        }
        let update = doc.transact().encode_state_as_update_v1(&before);
        assert!(
            rooms
                .apply_update(LiveUpdate {
                    item: &item.id,
                    user_id: "maya",
                    name: "Maya",
                    role: Role::Editor,
                    bytes: &update,
                    unit: "paragraph",
                    key: "0",
                    at: "2026-10-30T18:05:00.000Z",
                })
                .unwrap()
        );
        let live_texts = {
            let live = rooms.live.lock().expect("rooms");
            paragraph_texts(&live.get(&item.id).expect("room").doc)
        };
        assert_eq!(
            live_texts,
            vec![
                "Tomatoes are in".to_string(),
                "Beans are staked".to_string()
            ]
        );
        rooms
            .db
            .transact(|tx| {
                tx.delete("drive_presence", &presence_id(&item.id, "maya"))?;
                tx.delete("drive_presence", &presence_id(&item.id, "sam"))?;
                Ok(())
            })
            .unwrap();
        assert!(rooms.writers(&item.id).unwrap().is_empty());
        rooms.kick(10_000, 1).unwrap();
        let (_item, bytes) = drive.read(&who, &item.id, None).unwrap();
        let saved = String::from_utf8(bytes).unwrap();
        assert!(saved.contains("Tomatoes are in"), "{saved}");
        assert!(saved.contains("Beans are staked"), "{saved}");
    }

    #[test]
    fn a_commenter_may_store_a_comment_and_not_a_document_attribute() {
        use yrs::Map;

        fn attr_update(key: &str, value: &str) -> Vec<u8> {
            let doc = Doc::new();
            let before = doc.transact().state_vector();
            let map = doc.get_or_insert_map("docAttrs");
            map.insert(&mut doc.transact_mut(), key, value);
            doc.transact().encode_state_as_update_v1(&before)
        }

        let doc = Doc::new();
        let comment = attr_update("commentThreads", "Water the beds");
        assert!(!body_changed(&doc, &comment).unwrap());
        let styled = attr_update("paragraphStyles", "secret-value");
        assert!(body_changed(&doc, &styled).unwrap());
        let forms = {
            let doc = Doc::new();
            let before = doc.transact().state_vector();
            let map = doc.get_or_insert_map("forms");
            map.insert(&mut doc.transact_mut(), "note", "secret-value");
            doc.transact().encode_state_as_update_v1(&before)
        };
        assert!(body_changed(&Doc::new(), &forms).unwrap());

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                crate::schema::node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
        let rooms = Rooms::new(db, drive);
        let maya = crate::auth::AuthUser {
            id: "maya".into(),
            email: None,
            name: Some("Maya".into()),
            role: None,
        };
        let sam = crate::auth::AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join("file", &maya, Role::Editor, 1).unwrap();
        rooms.join("file", &sam, Role::Commenter, 2).unwrap();
        assert!(
            rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "sam",
                    name: "Sam",
                    role: Role::Commenter,
                    bytes: &comment,
                    unit: "comment",
                    key: "0",
                    at: "2026-11-01T14:00:00.000Z",
                })
                .unwrap()
        );
        assert!(
            !rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "sam",
                    name: "Sam",
                    role: Role::Commenter,
                    bytes: &styled,
                    unit: "comment",
                    key: "1",
                    at: "2026-11-01T14:00:01.000Z",
                })
                .unwrap()
        );
        assert!(
            !rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "sam",
                    name: "Sam",
                    role: Role::Commenter,
                    bytes: &forms,
                    unit: "comment",
                    key: "2",
                    at: "2026-11-01T14:00:02.000Z",
                })
                .unwrap()
        );
        {
            let live = rooms.live.lock().expect("rooms");
            let room = live.get("file").expect("room");
            let txn = room.doc.transact();
            let map = txn.get_map("docAttrs").expect("attrs");
            let threads = map.get(&txn, "commentThreads");
            assert!(format!("{threads:?}").contains("Water the beds"));
            assert!(map.get(&txn, "paragraphStyles").is_none());
            assert!(txn.get_map("forms").is_none());
            assert!(!format!("{threads:?}").contains("secret-value"));
        }
        let notes = {
            use yrs::{Transact, XmlElementPrelim, XmlFragment, XmlTextPrelim};
            let doc = Doc::new();
            let before = doc.transact().state_vector();
            let fragment = doc.get_or_insert_xml_fragment("notes");
            let mut txn = doc.transact_mut();
            let paragraph = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            paragraph.push_back(&mut txn, XmlTextPrelim::new("secret-value"));
            drop(txn);
            doc.transact().encode_state_as_update_v1(&before)
        };
        assert!(body_changed(&Doc::new(), &notes).unwrap());
        assert!(
            !rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "sam",
                    name: "Sam",
                    role: Role::Commenter,
                    bytes: &notes,
                    unit: "comment",
                    key: "3",
                    at: "2026-11-01T14:00:03.000Z",
                })
                .unwrap()
        );
        {
            let live = rooms.live.lock().expect("rooms");
            let room = live.get("file").expect("room");
            assert!(!body_snapshot(&room.doc).contains("secret-value"));
        }
        let (caption, rewritten) = {
            use yrs::{Array, Map, Text, Transact, WriteTxn, XmlTextPrelim};
            let doc = Doc::new();
            let start = doc.transact().state_vector();
            {
                let mut txn = doc.transact_mut();
                let labels = txn.get_or_insert_map("labels");
                labels.insert(&mut txn, "bed", XmlTextPrelim::new("Beds"));
                let captions = txn.get_or_insert_array("captions");
                captions.insert(&mut txn, 0, XmlTextPrelim::new("North"));
            }
            let seeded = doc.transact().state_vector();
            let caption = doc.transact().encode_state_as_update_v1(&start);
            {
                let mut txn = doc.transact_mut();
                let labels = txn.get_or_insert_map("labels");
                let label = match labels.get(&txn, "bed") {
                    Some(yrs::Out::YXmlText(text)) => text,
                    _ => panic!("label"),
                };
                label.remove_range(&mut txn, 0, 4);
                label.insert(&mut txn, 0, "secret-value");
                let captions = txn.get_or_insert_array("captions");
                let nested = match captions.get(&txn, 0) {
                    Some(yrs::Out::YXmlText(text)) => text,
                    _ => panic!("caption list"),
                };
                nested.remove_range(&mut txn, 0, 5);
                nested.insert(&mut txn, 0, "secret-value");
            }
            let rewritten = doc.transact().encode_state_as_update_v1(&seeded);
            (caption, rewritten)
        };
        let seeded = Doc::new();
        seeded
            .transact_mut()
            .apply_update(yrs::Update::decode_v1(&caption).unwrap())
            .unwrap();
        assert!(body_changed(&seeded, &rewritten).unwrap());
        assert!(
            rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "maya",
                    name: "Maya",
                    role: Role::Editor,
                    bytes: &caption,
                    unit: "paragraph",
                    key: "4",
                    at: "2026-11-01T14:00:04.000Z",
                })
                .unwrap()
        );
        assert!(
            !rooms
                .apply_update(LiveUpdate {
                    item: "file",
                    user_id: "sam",
                    name: "Sam",
                    role: Role::Commenter,
                    bytes: &rewritten,
                    unit: "comment",
                    key: "5",
                    at: "2026-11-01T14:00:05.000Z",
                })
                .unwrap()
        );
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        let snapshot = body_snapshot(&room.doc);
        assert!(snapshot.contains("Beds"));
        assert!(snapshot.contains("North"));
        assert!(!snapshot.contains("secret-value"));
    }

    #[test]
    fn a_presence_time_that_is_not_a_time_does_not_drop_the_edit() {
        use crate::{auth::AuthUser, schema::node_schema};
        use yrs::{Array, TextPrelim, Transact};

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(
            Db::open_in_memory(
                suiteleaf_net::identity::ed25519::Keypair::generate(),
                node_schema(None).unwrap(),
            )
            .unwrap(),
        );
        let drive = Drive::open(db.clone(), &dir.path().join("blobs")).unwrap();
        let rooms = Rooms::new(db.clone(), drive);
        let ann = AuthUser {
            id: "ann".into(),
            email: None,
            name: Some("Ann".into()),
            role: None,
        };
        let sam = AuthUser {
            id: "sam".into(),
            email: None,
            name: Some("Sam".into()),
            role: None,
        };
        rooms.join("file", &ann, Role::Editor, 1).unwrap();
        rooms.join("file", &sam, Role::Editor, 1).unwrap();
        let doc = Doc::new();
        let paragraphs = doc.get_or_insert_array("paragraphs");
        let before = doc.transact().state_vector();
        {
            let mut txn = doc.transact_mut();
            paragraphs.insert(&mut txn, 0, TextPrelim::new("Beds"));
        }
        let update = doc.transact().encode_state_as_update_v1(&before);
        rooms
            .apply_update(LiveUpdate {
                item: "file",
                user_id: "ann",
                name: "Ann",
                role: Role::Editor,
                bytes: &update,
                unit: "paragraph",
                key: "0",
                at: "2026-11-01T12:00:00.000Z",
            })
            .unwrap();
        let id = "file:ann";
        let mut row = db.get("drive_presence", id).unwrap().unwrap();
        row.insert("lastActiveMs".into(), DbValue::Integer(0));
        db.transact(|tx| tx.upsert("drive_presence", id, row.into_iter().collect::<Vec<_>>()))
            .unwrap();
        let kicked = rooms.kick(1 + IDLE_MS + 1, IDLE_MS).unwrap();
        assert_eq!(kicked, vec!["sam".to_string()]);
        let names = rooms
            .occupants("file")
            .unwrap()
            .into_iter()
            .map(|person| person.name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["Ann".to_string()]);
        let live = rooms.live.lock().expect("rooms");
        let room = live.get("file").expect("room");
        assert_eq!(room.mode, "multiuser");
        assert_eq!(paragraph_texts(&room.doc), vec!["Beds".to_string()]);
    }
}
