//! Whether a scheduled backup is due.

use anyhow::{Result, bail};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupDue {
    pub due: bool,
    pub reason: String,
}

/// Whether `every_hours` has passed since `last`. Nothing is written.
/// A time that is not a real UTC time is not repeated.
pub fn backup_due(last: Option<&str>, every_hours: u32, now: &str) -> Result<BackupDue> {
    if !(1..=168).contains(&every_hours) {
        bail!("The backup schedule must be from 1 to 168 hours.");
    }
    let now_ms =
        parse_utc_ms(now).ok_or_else(|| anyhow::anyhow!("The current time is not a time."))?;
    let Some(last) = last.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(BackupDue {
            due: true,
            reason: "No backup has been recorded.".into(),
        });
    };
    let Some(last_ms) = parse_utc_ms(last) else {
        return Ok(BackupDue {
            due: false,
            reason: "The last backup time is not a time.".into(),
        });
    };
    if now_ms < last_ms {
        return Ok(BackupDue {
            due: false,
            reason: "That backup is newer than the current time.".into(),
        });
    }
    let elapsed_hours = (now_ms - last_ms) / 3_600_000;
    if elapsed_hours >= i64::from(every_hours) {
        Ok(BackupDue {
            due: true,
            reason: "A backup is due.".into(),
        })
    } else {
        Ok(BackupDue {
            due: false,
            reason: "The last backup is still inside the schedule.".into(),
        })
    }
}

/// `every_hours` is the operator's schedule text. A value that is not a whole number of hours is not repeated.
pub fn schedule_note(recorded_at: &str, every_hours: &str, now: &str) -> Result<BackupDue> {
    let hours: u32 = every_hours
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("The backup schedule must be from 1 to 168 hours."))?;
    let last = if recorded_at.trim().is_empty() {
        None
    } else {
        Some(recorded_at)
    };
    backup_due(last, hours, now)
}

fn parse_utc_ms(value: &str) -> Option<i64> {
    let value = value.trim();
    let prefix = value.strip_suffix('Z')?;
    let (body, millis) = if let Some((date, frac)) = prefix.split_once('.') {
        if frac.len() != 3 || !frac.chars().all(|char| char.is_ascii_digit()) {
            return None;
        }
        (date, frac.parse::<i64>().ok()?)
    } else {
        (prefix, 0)
    };
    let (date, time) = body.split_once('T')?;
    let mut dates = date.split('-');
    let year: i32 = dates.next()?.parse().ok()?;
    let month: u32 = dates.next()?.parse().ok()?;
    let day: u32 = dates.next()?.parse().ok()?;
    if dates.next().is_some() {
        return None;
    }
    let mut times = time.split(':');
    let hour: i64 = times.next()?.parse().ok()?;
    let minute: i64 = times.next()?.parse().ok()?;
    let second: i64 = times.next()?.parse().ok()?;
    if times.next().is_some()
        || !(0..24).contains(&hour)
        || !(0..60).contains(&minute)
        || !(0..60).contains(&second)
    {
        return None;
    }
    if !(1970..=9999).contains(&year) || !real_day(year, month, day) {
        return None;
    }
    let mut days = 0i64;
    for past in 1970..year {
        days += if leap_year(past) { 366 } else { 365 };
    }
    let lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for past in 1..month {
        let extra = if past == 2 && leap_year(year) { 1 } else { 0 };
        days += lengths[(past - 1) as usize] + extra;
    }
    days += i64::from(day) - 1;
    Some((((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + millis)
}

fn leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn real_day(year: i32, month: u32, day: u32) -> bool {
    if !(1..=12).contains(&month) || day < 1 {
        return false;
    }
    let lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let max = lengths[(month - 1) as usize] + if month == 2 && leap_year(year) { 1 } else { 0 };
    day <= max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_backup_is_due_after_the_scheduled_hours() {
        let due = backup_due(None, 24, "2026-11-02T00:00:00.000Z").unwrap();
        assert!(due.due);
        assert_eq!(due.reason, "No backup has been recorded.");
        let waiting = backup_due(
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-01T12:00:00.000Z",
        )
        .unwrap();
        assert!(!waiting.due);
        assert_eq!(
            waiting.reason,
            "The last backup is still inside the schedule."
        );
        let ready = backup_due(
            Some("2026-11-01T00:00:00.000Z"),
            24,
            "2026-11-02T00:00:00.000Z",
        )
        .unwrap();
        assert!(ready.due);
        assert_eq!(ready.reason, "A backup is due.");
        let bad = backup_due(Some("secret-value"), 24, "2026-11-02T00:00:00.000Z").unwrap();
        assert!(!bad.due);
        assert_eq!(bad.reason, "The last backup time is not a time.");
        assert!(!bad.reason.contains("secret-value"));
        let impossible = backup_due(
            Some("2026-02-31T00:00:00.000Z"),
            24,
            "2026-11-02T00:00:00.000Z",
        )
        .unwrap();
        assert!(!impossible.due);
        let hours = schedule_note(
            "2026-11-01T00:00:00.000Z",
            "secret-value",
            "2026-11-02T00:00:00.000Z",
        )
        .unwrap_err()
        .to_string();
        assert_eq!(hours, "The backup schedule must be from 1 to 168 hours.");
        assert!(!hours.contains("secret-value"));
        let leap = backup_due(
            Some("2024-02-29T00:00:00.000Z"),
            1,
            "2024-02-29T01:00:00.000Z",
        )
        .unwrap();
        assert!(leap.due);
    }
}
