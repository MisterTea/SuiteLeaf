//! Live multiuser editing. Presence lives in SuiteDB. The Yjs document lives
//! on the node. Idle writers are dropped with no message to the editor. A
//! room that was multiuser is compacted into the file only after the last
//! writer is gone.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use anyhow::Context;
use base64::{Engine, engine::general_purpose::STANDARD};
use suitedb::{Db, Value as DbValue};
use suitedrive::{Drive, Principal, Role};
use tokio::sync::broadcast;
use yrs::{Doc, ReadTxn, Transact, Update, updates::decoder::Decode};

use crate::auth::AuthUser;

mod body;
mod compact;
mod presence;
mod sheet_room;
mod slide_room;
mod socket;
mod standing;
#[cfg(test)]
mod tests;

use body::{body_changed, paragraph_texts};
use compact::compact_bytes;
use presence::{as_int, iso_from_ms, may_apply, presence_id, role_name, shown_name, text_col};
use sheet_room::{apply_sheet_room, sheet_room};
use slide_room::{apply_slide_room, slide_room};
pub use socket::session;

pub const IDLE_MS: i64 = 15 * 60 * 1000;

/// Sent on the room relay when a solo room becomes shared. It is not a Yjs update.
const ROOM_SHARED: &str = "mode:multiuser";

#[derive(Clone)]
pub struct Rooms {
    pub(super) sockets: Arc<std::sync::atomic::AtomicUsize>,
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
    /// One person copies the open file into an empty room. A second copy is not asked for.
    seed_claimed: bool,
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
            sockets: Arc::default(),
            db,
            drive,
            live: Arc::default(),
        }
    }

    pub fn join(&self, item: &str, user: &AuthUser, role: Role, now: i64) -> anyhow::Result<Join> {
        let _lock = self.db.exclusive("cloud-mutations")?;
        if self.db.is_postgres() {
            self.catch_up_unlocked(item)?;
        }
        // A viewer joins the same room and receives its text. `may_apply` still
        // ignores a viewer's edit.
        let id = presence_id(item, &user.id);
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
        let has_editor = role >= Role::Editor
            || self.occupants(item)?.iter().any(|person| {
                matches!(person.role.as_str(), "editor" | "owner")
            });
        // One guard at a time. `std::sync::Mutex` is not reentrant, and a
        // second lock on this thread never returns.
        let promoted = {
            let mut live = self.live.lock().expect("rooms");
            if !live.contains_key(item) {
                live.insert(item.to_owned(), self.restore_live(item)?);
            }
            let room = live.get_mut(item).expect("room was just stored");
            if has_editor && room.mode == "solo" {
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
                        (
                            "baseline",
                            self.db
                                .get("drive_item", item)?
                                .and_then(|row| text_col(&row, "headVersionId"))
                                .unwrap_or_default()
                                .into(),
                        ),
                        ("seedOwnerId", DbValue::Null),
                    ],
                )
            })?;
        }
        // A room restored after a restart is already shared, so it never takes
        // the promotion path that remembers the file. Without that file, the
        // deck cannot be written when the room empties.
        let needs_file = {
            let live = self.live.lock().expect("rooms");
            live.get(item)
                .is_some_and(|room| room.mode == "multiuser" && room.baseline.is_none())
        };
        if needs_file {
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
            if let Some(room) = live.get_mut(item)
                && room.baseline.is_none()
            {
                room.baseline = baseline;
            }
        }
        let mut live = self.live.lock().expect("rooms");
        let Some(room) = live.get_mut(item) else {
            return Ok(Join {
                joined: true,
                mode: "solo",
                state: None,
                seed: false,
                generation: 0,
            });
        };
        let update = room
            .doc
            .transact()
            .encode_state_as_update_v1(&yrs::StateVector::default());
        let state = if update.len() <= 2 {
            None
        } else {
            Some(STANDARD.encode(update))
        };
        let mode = room.mode;
        // The person already in the room copies the file in. The arrival that
        // makes the room shared does not, or both copies land in the document.
        // A viewer cannot copy it in, so the editor who arrives does.
        let another_editor = self.occupants(item)?.iter().any(|person| {
            person.user_id != user.id && matches!(person.role.as_str(), "editor" | "owner")
        });
        let mut seed = mode == "multiuser"
            && state.is_none()
            && !room.seed_claimed
            && role >= Role::Editor
            && (promoted.is_none() || !another_editor);
        if seed && self.db.is_postgres() {
            let claim = self
                .db
                .get("drive_room", item)?
                .and_then(|row| text_col(&row, "seedOwnerId"));
            let alive = claim.as_ref().is_some_and(|id| {
                self.occupants(item)
                    .is_ok_and(|people| people.iter().any(|p| &p.user_id == id))
            });
            seed = claim.as_deref() == Some(&user.id) || !alive;
            if seed {
                self.db.transact(|tx| {
                    tx.upsert(
                        "drive_room",
                        item,
                        [("seedOwnerId", DbValue::from(user.id.as_str()))],
                    )
                })?;
            }
        }
        if seed {
            room.seed_claimed = true;
        }
        if promoted.is_some() {
            let _ = room.relay.send(ROOM_SHARED.to_owned());
        }
        Ok(Join {
            joined: true,
            mode,
            state,
            seed,
            generation: room.generation,
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

    /// The person's role on this file now. `None` means the grant is gone.
    /// An open socket asks on each message and on its recheck tick.
    pub fn current_role(
        &self,
        user_id: &str,
        admin: bool,
        item: &str,
    ) -> anyhow::Result<Option<Role>> {
        let who = Principal {
            id: user_id.to_owned(),
            admin,
        };
        Ok(self.drive.role(&who, item)?)
    }

    /// Remove one person as soon as their socket closes, without waiting for the idle sweep.
    pub fn leave(&self, item: &str, user_id: &str, now: i64) -> anyhow::Result<()> {
        let _lock = self.db.exclusive("cloud-mutations")?;
        if self.db.is_postgres() {
            self.catch_up_unlocked(item)?;
        }
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
        let _lock = self.db.exclusive("cloud-mutations")?;
        self.catch_up_unlocked(item)
    }

    fn catch_up_unlocked(&self, item: &str) -> anyhow::Result<bool> {
        let stored = self.db.get("drive_room", item)?;
        let Some(row) = stored else {
            return Ok(false);
        };
        let mode = text_col(&row, "mode").unwrap_or_default();
        let generation = row.get("generation").and_then(as_int).unwrap_or(0);
        if mode != "multiuser" || generation <= 0 {
            if self.db.is_postgres() {
                let mut live = self.live.lock().expect("rooms");
                if let Some(room) = live.get_mut(item)
                    && room.generation < generation
                {
                    room.mode = "solo";
                    room.generation = generation;
                    room.doc = Doc::new();
                    room.baseline = None;
                    room.seed_claimed = false;
                    let _ = room.relay.send(ROOM_SHARED.to_owned());
                }
            }
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
            let version = text_col(&row, "baseline").filter(|s| !s.is_empty());
            room.baseline = self
                .drive
                .read(
                    &Principal {
                        id: "cloud-recovery".into(),
                        admin: true,
                    },
                    item,
                    version.as_deref(),
                )
                .ok()
                .map(|(_, bytes)| bytes);
            let _ = room.relay.send(ROOM_SHARED.to_owned());
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

    pub fn poll_cloud(&self, cursor: &mut i64) -> anyhow::Result<()> {
        if self.sockets.load(std::sync::atomic::Ordering::Relaxed) == 0 {
            return Ok(());
        }
        let (next, changes) = self.db.changes_since(*cursor)?;
        if changes
            .iter()
            .any(|c| c.table == "drive_room" || c.table == "drive_room_update")
        {
            self.catch_up_open_rooms()?;
        }
        for change in changes.iter().filter(|c| c.table == "drive_signal") {
            if let Some(row) = self.db.get("drive_signal", &change.pk)? {
                let current =
                    text_col(&row, "expiresAt").is_some_and(|s| s > suitedb::hlc::iso_now());
                if current
                    && let (Some(item), Some(payload)) =
                        (text_col(&row, "itemId"), text_col(&row, "payload"))
                {
                    let live = self.live.lock().expect("rooms");
                    if let Some(room) = live.get(&item) {
                        let _ = room.relay.send(payload);
                    }
                }
            }
        }
        *cursor = next;
        Ok(())
    }

    /// Tests apply an edit without naming a generation.
    #[cfg(test)]
    fn apply_update(&self, update: LiveUpdate<'_>) -> anyhow::Result<bool> {
        Ok(self.apply_update_in(update, None)? == Outcome::Stored)
    }

    /// Apply an edit made in `generation`, when the client named one. An edit
    /// from another generation, or for a room that is no longer shared, is
    /// `Stale` and is not stored, so its Yjs structure never mixes into a
    /// document built from a different log.
    fn apply_update_in(
        &self,
        update: LiveUpdate<'_>,
        generation: Option<i64>,
    ) -> anyhow::Result<Outcome> {
        let _lock = self.db.exclusive("cloud-mutations")?;
        if self.db.is_postgres() {
            self.catch_up_unlocked(update.item)?;
        }
        // Editors and owners change the document. Commenters and responders
        // may record a comment. A viewer, or a comment passed off as an edit,
        // is ignored.
        if !may_apply(update.role, update.unit) {
            return Ok(Outcome::Refused);
        }
        let mut live = self.live.lock().expect("rooms");
        let Some(room) = live.get_mut(update.item) else {
            return Ok(Outcome::Refused);
        };
        if room.mode != "multiuser" {
            return Ok(if generation.is_some() {
                Outcome::Stale
            } else {
                Outcome::Refused
            });
        }
        if generation.is_some_and(|made_in| made_in != room.generation) {
            return Ok(Outcome::Stale);
        }
        let decoded = Update::decode_v1(update.bytes).context("decode Yjs update")?;
        if update.unit == "seed" {
            let existing = room
                .doc
                .transact()
                .encode_state_as_update_v1(&yrs::StateVector::default());
            if existing.len() > 2 {
                return Ok(Outcome::Refused);
            }
        }
        if update.role < Role::Editor && body_changed(&room.doc, update.bytes)? {
            return Ok(Outcome::Refused);
        }
        let generation = room.generation;
        drop(live);
        // From here `generation` is the room's, which the edit matched or did not name.
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
            return Ok(Outcome::Stored);
        };
        if room.generation != generation {
            return Ok(Outcome::Stored);
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
        Ok(Outcome::Stored)
    }

    fn relay_text(&self, item: &str, text: &str) {
        if self.db.is_postgres() {
            let _ = self.db.transact(|tx| {
                tx.upsert(
                    "drive_signal",
                    &uuid::Uuid::now_v7().to_string(),
                    [
                        ("itemId", DbValue::from(item)),
                        ("payload", DbValue::from(text)),
                        (
                            "expiresAt",
                            DbValue::from(suitedb::hlc::iso_from_ms(
                                suitedb::hlc::now_ms() + 15_000,
                            )),
                        ),
                    ],
                )
            });
            return;
        }
        let live = self.live.lock().expect("rooms");
        if let Some(room) = live.get(item) {
            let _ = room.relay.send(text.to_owned());
        }
    }

    /// Drop idle presence. Compacts only when a multiuser room is left empty.
    pub fn kick(&self, now: i64, pause: i64) -> anyhow::Result<Vec<String>> {
        let _lock = self.db.exclusive("cloud-mutations")?;
        if self.db.is_postgres() {
            let rows = self
                .db
                .query("SELECT id FROM drive_room WHERE mode='multiuser'", &[])?;
            for row in rows {
                if let Some(item) = text_col(&row, "id") {
                    let mut live = self.live.lock().expect("rooms");
                    if !live.contains_key(&item) {
                        live.insert(item.clone(), self.restore_live(&item)?);
                    }
                }
            }
            let expired = self.db.query(
                "SELECT id FROM drive_signal WHERE expiresAt<?1",
                &[suitedb::hlc::iso_now().into()],
            )?;
            if !expired.is_empty() {
                self.db.transact(|tx| {
                    for row in expired {
                        if let Some(id) = text_col(&row, "id") {
                            tx.delete("drive_signal", &id)?;
                        }
                    }
                    Ok(())
                })?;
            }
        }
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
        if self.db.is_postgres() {
            self.catch_up_unlocked(item)?;
        }
        if !self.writers(item)?.is_empty() {
            return Ok(());
        }
        let (paragraphs, rich, baseline, touches, generation, sheet, slide) = {
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
                sheet_room(&room.doc),
                slide_room(&room.doc),
            )
        };
        // No saved file to write into. Leave the open document where it is.
        let Some(bytes) = baseline else {
            return Ok(());
        };
        let at = iso_from_ms(now);
        let next = if let Some(sheet_bytes) = apply_sheet_room(&bytes, &sheet)? {
            sheet_bytes
        } else if let Some(slide_bytes) = apply_slide_room(&bytes, &slide)? {
            slide_bytes
        } else if paragraphs.is_empty() && rich.is_none() {
            return Ok(());
        } else {
            compact_bytes(&bytes, &paragraphs, rich.as_ref(), &touches, &at)?
        };
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
            || slide_room(&room.doc) != slide
        {
            return Ok(());
        }
        room.mode = "solo";
        room.touches.clear();
        room.baseline = None;
        room.seed_claimed = false;
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
                baseline: if self.db.is_postgres() {
                    let version = stored
                        .as_ref()
                        .and_then(|row| text_col(row, "baseline"))
                        .filter(|s| !s.is_empty());
                    self.drive
                        .read(
                            &Principal {
                                id: "cloud-recovery".into(),
                                admin: true,
                            },
                            item,
                            version.as_deref(),
                        )
                        .ok()
                        .map(|(_, bytes)| bytes)
                } else {
                    None
                },
                touches: Vec::new(),
                relay,
                seed_claimed: false,
            });
        }
        Ok(Live {
            doc,
            mode: "solo",
            generation,
            baseline: None,
            touches: Vec::new(),
            relay,
            seed_claimed: false,
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
    #[allow(dead_code)]
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
    pub seed: bool,
    /// The room's document generation. An edit made in another generation cannot be placed.
    pub generation: i64,
}

/// What happened to one edit sent on the socket.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// In the journal and the live room.
    Stored,
    /// Not allowed for this role, or not a valid update.
    Refused,
    /// Made in another generation of the room, or the room is no longer shared.
    Stale,
}
