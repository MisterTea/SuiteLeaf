//! Whether a stored session may still identify a caller.
//!
//! `expiresAt` is the absolute end. `idle` is how long `updatedAt` may sit
//! still. A missing row is revocation and is handled by the lookup, not here.

use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionDecision {
    Accept,
    Expired,
    Idle,
    Reauth,
}

/// `idle` of `None` means only `expiresAt` ends the session.
pub fn decide_session(
    expires_at: &str,
    updated_at: &str,
    now: &str,
    idle: Option<Duration>,
    reauth_at: &str,
) -> SessionDecision {
    if !reauth_at.is_empty() && reauth_at <= now {
        return SessionDecision::Reauth;
    }
    if parse_iso_ms(expires_at).is_none() || expires_at <= now {
        return SessionDecision::Expired;
    }
    let Some(limit) = idle else {
        return SessionDecision::Accept;
    };
    let (Some(updated), Some(now_ms)) = (parse_iso_ms(updated_at), parse_iso_ms(now)) else {
        return SessionDecision::Idle;
    };
    if now_ms.saturating_sub(updated) >= limit.as_millis() as u64 {
        SessionDecision::Idle
    } else {
        SessionDecision::Accept
    }
}

pub(crate) fn parse_iso_ms(value: &str) -> Option<u64> {
    let bytes = value.as_bytes();
    if bytes.len() != 24 || bytes[10] != b'T' || bytes[23] != b'Z' {
        return None;
    }
    let year: i64 = value.get(0..4)?.parse().ok()?;
    let month: u32 = value.get(5..7)?.parse().ok()?;
    let day: u32 = value.get(8..10)?.parse().ok()?;
    let hour: u64 = value.get(11..13)?.parse().ok()?;
    let minute: u64 = value.get(14..16)?.parse().ok()?;
    let second: u64 = value.get(17..19)?.parse().ok()?;
    let millis: u64 = value.get(20..23)?.parse().ok()?;
    if !(1..=12).contains(&month)
        || !valid_day(year, month, day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year, month, day)?;
    let secs = days
        .checked_mul(86_400)?
        .checked_add((hour * 3600 + minute * 60 + second) as i64)?;
    let ms = secs.checked_mul(1000)? as u64;
    Some(ms + millis)
}

fn valid_day(year: i64, month: u32, day: u32) -> bool {
    let lengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let leap = month == 2 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max = if leap { 29 } else { lengths[month as usize] };
    day >= 1 && day <= max
}

fn days_from_civil(year: i64, month: u32, day: u32) -> Option<i64> {
    if year < 1970 {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = (y - era * 400) as u64;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + u64::from(doy);
    Some(era * 146_097 + doe as i64 - 719_468)
}

#[cfg(test)]
mod tests {
    use super::*;
    use suitedb::hlc::iso_from_ms;

    #[test]
    fn expiry_and_idle_are_separate_refusals() {
        let now = iso_from_ms(1_700_000_000_000);
        let fresh = iso_from_ms(1_700_000_000_000 - 1_000);
        let stale = iso_from_ms(1_700_000_000_000 - 3_600_000);
        let later = iso_from_ms(1_700_000_000_000 + 86_400_000);
        assert_eq!(
            decide_session(later.as_str(), fresh.as_str(), now.as_str(), None, ""),
            SessionDecision::Accept
        );
        assert_eq!(
            decide_session(now.as_str(), fresh.as_str(), now.as_str(), None, ""),
            SessionDecision::Expired
        );
        assert_eq!(
            decide_session(
                later.as_str(),
                stale.as_str(),
                now.as_str(),
                Some(Duration::from_secs(60 * 30)),
                "",
            ),
            SessionDecision::Idle
        );
        assert_eq!(
            decide_session(
                later.as_str(),
                fresh.as_str(),
                now.as_str(),
                Some(Duration::from_secs(60 * 30)),
                "",
            ),
            SessionDecision::Accept
        );
        assert_eq!(
            decide_session(
                later.as_str(),
                fresh.as_str(),
                now.as_str(),
                None,
                now.as_str()
            ),
            SessionDecision::Reauth
        );
        assert_eq!(
            decide_session(
                later.as_str(),
                fresh.as_str(),
                now.as_str(),
                None,
                later.as_str()
            ),
            SessionDecision::Accept
        );
    }

    #[test]
    fn an_unreadable_activity_time_does_not_count_as_recent() {
        let now = iso_from_ms(1_700_000_000_000);
        let later = iso_from_ms(1_700_000_000_000 + 1000);
        assert_eq!(
            decide_session(
                later.as_str(),
                "yesterday",
                now.as_str(),
                Some(Duration::from_secs(60)),
                "",
            ),
            SessionDecision::Idle
        );
    }

    #[test]
    fn a_date_that_is_not_a_real_day_does_not_keep_the_session() {
        let now = "2026-02-28T00:00:00.000Z";
        let later = "2026-03-01T00:00:00.000Z";
        assert_eq!(
            decide_session("2026-02-31T00:00:00.000Z", later, now, None, ""),
            SessionDecision::Expired
        );
        assert_eq!(
            decide_session(
                later,
                "2026-02-31T00:00:00.000Z",
                now,
                Some(Duration::from_secs(60)),
                ""
            ),
            SessionDecision::Idle
        );
    }
}
