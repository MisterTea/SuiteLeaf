use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Remote timestamps further ahead than this do not advance the local clock.
pub const MAX_DRIFT_MS: u64 = 5 * 60 * 1000;

/// A hybrid logical clock timestamp. The derived ordering (wall, counter,
/// node) is total because `node` differs between replicas.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Hlc {
    pub wall: u64,
    pub counter: u32,
    pub node: u64,
}

impl Hlc {
    /// A fixed-width hex form whose lexicographic order matches [`Ord`].
    pub fn encode(&self) -> String {
        format!("{:016x}{:08x}{:016x}", self.wall, self.counter, self.node)
    }

    pub fn decode(s: &str) -> Option<Hlc> {
        if s.len() < 40 {
            return None;
        }
        Some(Hlc {
            wall: u64::from_str_radix(&s[0..16], 16).ok()?,
            counter: u32::from_str_radix(&s[16..24], 16).ok()?,
            node: u64::from_str_radix(&s[24..40], 16).ok()?,
        })
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The current UTC time as JavaScript's `toISOString()` formats it.
pub fn iso_now() -> String {
    iso_from_ms(now_ms())
}

pub fn iso_from_ms(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        ms % 1000
    )
}

/// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[derive(Debug, Clone)]
pub struct Clock {
    last: Hlc,
}

impl Clock {
    pub fn new(node: u64) -> Self {
        Clock {
            last: Hlc {
                wall: 0,
                counter: 0,
                node,
            },
        }
    }

    pub fn last(&self) -> Hlc {
        self.last
    }

    /// A timestamp greater than every timestamp issued or observed so far.
    pub fn tick(&mut self) -> Hlc {
        self.tick_at(now_ms())
    }

    pub fn tick_at(&mut self, wall: u64) -> Hlc {
        self.last = if wall > self.last.wall {
            Hlc {
                wall,
                counter: 0,
                node: self.last.node,
            }
        } else {
            Hlc {
                counter: self.last.counter + 1,
                ..self.last
            }
        };
        self.last
    }

    pub fn observe(&mut self, remote: Hlc) {
        self.observe_at(remote, now_ms());
    }

    pub fn observe_at(&mut self, remote: Hlc, now: u64) {
        if remote.wall > now + MAX_DRIFT_MS {
            return;
        }
        if (remote.wall, remote.counter) > (self.last.wall, self.last.counter) {
            self.last = Hlc {
                wall: remote.wall,
                counter: remote.counter,
                node: self.last.node,
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_are_strictly_increasing_even_when_wall_time_stalls_or_regresses() {
        let mut c = Clock::new(7);
        let a = c.tick_at(100);
        let b = c.tick_at(100);
        let d = c.tick_at(50);
        assert!(a < b && b < d);
        assert_eq!(d.wall, 100);
        assert!(c.tick_at(200) > d);
    }

    #[test]
    fn observing_a_remote_timestamp_orders_later_local_ticks_after_it() {
        let mut c = Clock::new(1);
        c.tick_at(100);
        let remote = Hlc {
            wall: 150,
            counter: 3,
            node: 9,
        };
        c.observe_at(remote, 120);
        assert!(c.tick_at(120) > remote);
    }

    #[test]
    fn far_future_remote_timestamps_are_ignored() {
        let mut c = Clock::new(1);
        c.observe_at(
            Hlc {
                wall: 10 * MAX_DRIFT_MS,
                counter: 0,
                node: 2,
            },
            0,
        );
        assert_eq!(c.tick_at(5).wall, 5);
    }

    #[test]
    fn formats_utc_timestamps_like_javascript() {
        assert_eq!(iso_from_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_ms(951_782_400_123), "2000-02-29T00:00:00.123Z");
        assert_eq!(iso_from_ms(1_791_500_000_000), "2026-10-08T22:53:20.000Z");
    }

    #[test]
    fn encoding_preserves_order_and_round_trips() {
        let a = Hlc {
            wall: 1,
            counter: 0xffff_ffff,
            node: u64::MAX,
        };
        let b = Hlc {
            wall: 2,
            counter: 0,
            node: 0,
        };
        assert!(a.encode() < b.encode());
        assert_eq!(Hlc::decode(&a.encode()), Some(a));
    }
}
