//! Who else has a file open. Beats are kept in memory and are not replicated.

use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::{Drive, DriveResult, Principal, Role};

/// How long another person's open-file beat stays visible.
/// A beat older than this is omitted. Nothing sweeps it in the background.
pub const PRESENCE_TTL: Duration = Duration::from_secs(15);

/// A beat older than this, and still inside [`PRESENCE_TTL`], is idle.
pub const PRESENCE_IDLE: Duration = Duration::from_secs(5);

/// Someone else who currently has a file open.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Presence {
    pub name: String,
    pub editing: bool,
    /// True when their last beat is older than [`PRESENCE_IDLE`] and they are still listed.
    pub idle: bool,
}

pub(crate) struct PresenceBeat {
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

fn presence_idle(at: SystemTime, now: SystemTime) -> bool {
    match now.duration_since(at) {
        Ok(age) => age > PRESENCE_IDLE,
        Err(_) => false,
    }
}

impl Drive {
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
        if self.db.is_postgres() {
            use suitedb::Value;
            let key = format!("{id}:{}", who.id);
            self.db.transact(|tx| {
                tx.upsert(
                    "drive_open_presence",
                    &key,
                    [
                        ("itemId", Value::from(id)),
                        ("userId", who.id.clone().into()),
                        ("name", presence_name(name).into()),
                        ("editing", Value::Integer(i64::from(editing))),
                        (
                            "lastActiveMs",
                            Value::Integer(
                                at.duration_since(SystemTime::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as i64,
                            ),
                        ),
                    ],
                )
            })?;
            return Ok(());
        }
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
        if self.db.is_postgres() {
            let rows=self.db.query("SELECT userId, name, editing, lastActiveMs FROM drive_open_presence WHERE itemId=?1",&[id.into()])?;
            let now = now
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            let mut people = rows
                .into_iter()
                .filter_map(|row| {
                    use suitedb::Value;
                    if row.get("userId") == Some(&Value::Text(who.id.clone())) {
                        return None;
                    }
                    let Some(Value::Integer(at)) = row.get("lastActiveMs") else {
                        return None;
                    };
                    if now.saturating_sub(*at) > PRESENCE_TTL.as_millis() as i64 {
                        return None;
                    }
                    let Some(Value::Text(name)) = row.get("name") else {
                        return None;
                    };
                    Some(Presence {
                        name: name.clone(),
                        editing: row.get("editing") == Some(&Value::Integer(1)),
                        idle: now.saturating_sub(*at) > PRESENCE_IDLE.as_millis() as i64,
                    })
                })
                .collect::<Vec<_>>();
            people.sort_by(|a, b| a.name.cmp(&b.name).then(a.editing.cmp(&b.editing)));
            return Ok(people);
        }
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
                idle: presence_idle(beat.at, now),
            })
            .collect();
        if people.is_empty() {
            items.remove(id);
        }
        out.sort_by(|a, b| a.name.cmp(&b.name).then(a.editing.cmp(&b.editing)));
        Ok(out)
    }
}
