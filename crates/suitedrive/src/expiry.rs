//! End dates on grants. Every stored end is UTC, so comparing strings compares times.

use crate::{DriveError, DriveResult};

fn real_utc_day(year: u16, month: u8, day: u8) -> bool {
    let length = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) {
                29
            } else {
                28
            }
        }
        _ => return false,
    };
    (1..=length).contains(&day)
}

/// A grant with no end, or a real end still in the future, still opens the file.
/// A date that is not a real day does not.
pub(crate) fn grant_live(expires_at: Option<&str>, now: &str) -> bool {
    let Some(at) = expires_at.map(str::trim).filter(|s| !s.is_empty()) else {
        return true;
    };
    let Ok(end) = normalize_expiry(at) else {
        return false;
    };
    end.as_str() > now
}

/// Store an end time in the same UTC shape as [`iso_now`], so a string
/// comparison is a time comparison.
pub(crate) fn normalize_expiry(raw: &str) -> DriveResult<String> {
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
    if !real_utc_day(year, month, day) {
        return Err(DriveError::BadRequest(
            "That day is not on the calendar.".into(),
        ));
    }
    let (time, offset_minutes) = zone_clock(time)?;
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
    let Some((utc_year, utc_month, utc_day, utc_hour, utc_minute)) = utc_parts(
        year as i32,
        month as i32,
        day as i32,
        hour as i32,
        minute as i32,
        offset_minutes,
    ) else {
        return Err(DriveError::BadRequest(
            "That day is not on the calendar.".into(),
        ));
    };
    Ok(format!(
        "{utc_year:04}-{utc_month:02}-{utc_day:02}T{utc_hour:02}:{utc_minute:02}:{second:02}.{millis:03}Z"
    ))
}

/// `Z` is zero. `+HH:MM` and `-HH:MM` are minute offsets. The clock text is returned without the zone.
fn zone_clock(time: &str) -> DriveResult<(&str, i32)> {
    if time.contains(['\n', '\r']) {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    if let Some(clock) = time.strip_suffix('Z') {
        return Ok((clock, 0));
    }
    let Some(sign_at) = time.rfind(['+', '-']) else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    if sign_at == 0 {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    let sign: i32 = if time.as_bytes()[sign_at] == b'+' {
        1
    } else {
        -1
    };
    let zone = &time[sign_at + 1..];
    let Some((zh, zm)) = zone.split_once(':') else {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    };
    if zh.len() != 2 || zm.len() != 2 {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    let zone_hour: i32 = zh.parse().unwrap_or(99);
    let zone_minute: i32 = zm.parse().unwrap_or(99);
    if !(0..=23).contains(&zone_hour) || !(0..=59).contains(&zone_minute) {
        return Err(DriveError::BadRequest("Choose the day access ends.".into()));
    }
    Ok((&time[..sign_at], sign * (zone_hour * 60 + zone_minute)))
}

fn month_length(year: i32, month: i32) -> Option<i32> {
    if !(1970..=9999).contains(&year) {
        return None;
    }
    let length = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if real_utc_day(year as u16, 2, 29) {
                29
            } else {
                28
            }
        }
        _ => return None,
    };
    Some(length)
}

/// The UTC calendar parts of a local clock minus its minute offset.
fn utc_parts(
    year: i32,
    month: i32,
    day: i32,
    hour: i32,
    minute: i32,
    offset_minutes: i32,
) -> Option<(i32, i32, i32, i32, i32)> {
    let mut total = hour * 60 + minute - offset_minutes;
    let mut y = year;
    let mut m = month;
    let mut d = day;
    while total < 0 {
        total += 24 * 60;
        d -= 1;
    }
    while total >= 24 * 60 {
        total -= 24 * 60;
        d += 1;
    }
    while d < 1 {
        m -= 1;
        if m < 1 {
            m = 12;
            y -= 1;
        }
        d += month_length(y, m)?;
    }
    loop {
        let length = month_length(y, m)?;
        if d <= length {
            break;
        }
        d -= length;
        m += 1;
        if m > 12 {
            m = 1;
            y += 1;
        }
    }
    Some((y, m, d, total / 60, total % 60))
}
