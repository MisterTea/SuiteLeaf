//! Presence rows, the file clock, and the roles that may change a room.

use std::time::{SystemTime, UNIX_EPOCH};

use suitedb::Value as DbValue;
use suitedrive::{Drive, Principal, Role};

pub(super) fn shown_name(name: &str) -> String {
    if name.contains('\n') || name.contains('\r') {
        "Someone".into()
    } else {
        name.to_owned()
    }
}

pub(super) fn presence_id(item: &str, user: &str) -> String {
    format!("{item}:{user}")
}

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn iso_from_ms(ms: i64) -> String {
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

pub(super) fn text_col(
    row: &std::collections::BTreeMap<String, DbValue>,
    key: &str,
) -> Option<String> {
    match row.get(key) {
        Some(DbValue::Text(text)) => Some(text.clone()),
        _ => None,
    }
}

pub(super) fn may_apply(role: Role, unit: &str) -> bool {
    if role >= Role::Editor {
        return true;
    }
    role >= Role::Commenter && unit == "comment"
}

pub(super) fn role_name(role: Role) -> &'static str {
    match role {
        Role::Viewer => "viewer",
        Role::Commenter => "commenter",
        Role::Responder => "responder",
        Role::Editor => "editor",
        Role::Owner => "owner",
    }
}

pub(super) fn role_of(
    drive: &Drive,
    who: &Principal,
    id: &str,
) -> suitedrive::DriveResult<Option<Role>> {
    drive.get(who, id).map(|item| item.role)
}

pub(super) fn as_int(value: &DbValue) -> Option<i64> {
    match value {
        DbValue::Integer(n) => Some(*n),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_viewer_does_not_count_as_a_writer_role() {
        assert!(Role::Viewer < Role::Commenter);
        assert!(Role::Commenter < Role::Editor);
    }
}
