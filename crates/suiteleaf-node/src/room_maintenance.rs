//! Cloud polling backs off while quiet; maintenance is leased across instances.
use std::{sync::Arc, time::Duration};

use suitedb::Db;

use crate::collab::Rooms;

const FAST_MS: u64 = 250;
const QUIET_MS: u64 = 2_000;
const ERROR_MS: u64 = 30_000;

fn next_delay(previous: u64, result: &anyhow::Result<bool>) -> u64 {
    match result {
        Ok(true) => FAST_MS,
        Ok(false) => previous.saturating_mul(2).clamp(FAST_MS, QUIET_MS),
        Err(_) => previous.saturating_mul(2).clamp(FAST_MS, ERROR_MS),
    }
}

pub fn start(rooms: Rooms, db: Arc<Db>, cloud: bool) -> anyhow::Result<()> {
    // Capture the tip before the listener accepts clients. Each joining socket
    // restores its persisted room, so old change history need not be replayed.
    let mut cursor = if cloud { db.cloud_tip()? } else { 0 };
    let every_ms = std::env::var("SUITELEAF_KICK_EVERY_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|ms| *ms >= 50)
        .unwrap_or(30_000);
    let pause = std::env::var("SUITELEAF_IDLE_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(crate::collab::IDLE_MS);
    tokio::spawn(async move {
        let every = Duration::from_millis(every_ms);
        let mut swept = tokio::time::Instant::now();
        let mut delay = QUIET_MS;
        loop {
            if !cloud || swept.elapsed() >= every {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                let result = (|| -> anyhow::Result<()> {
                    if !cloud || db.claim_cloud_maintenance(every)? {
                        rooms.kick(now, pause)?;
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    tracing::warn!("Room maintenance failed: {error}");
                }
                swept = tokio::time::Instant::now();
            }
            if cloud {
                let result = rooms.poll_cloud(&mut cursor);
                delay = next_delay(delay, &result);
                if let Err(error) = result {
                    tracing::warn!("Room replay failed: {error}");
                }
            } else if let Err(error) = rooms.catch_up_open_rooms() {
                tracing::warn!("Room catch-up failed: {error}");
            }
            // Completion-based sleep avoids catch-up bursts after slow queries.
            let wait = if cloud {
                Duration::from_millis(delay).min(every.saturating_sub(swept.elapsed()))
            } else {
                every
            };
            tokio::time::sleep(wait).await;
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_polling_backs_off_and_edits_restore_low_latency() {
        assert_eq!(next_delay(250, &Ok(false)), 500);
        assert_eq!(next_delay(1_000, &Ok(false)), 2_000);
        assert_eq!(next_delay(30_000, &Ok(false)), 2_000);
        assert_eq!(next_delay(2_000, &Ok(true)), 250);
    }

    #[test]
    fn failures_are_bounded_and_recovery_resumes_polling() {
        assert_eq!(next_delay(2_000, &Err(anyhow::anyhow!("offline"))), 4_000);
        assert_eq!(next_delay(20_000, &Err(anyhow::anyhow!("offline"))), 30_000);
        assert_eq!(next_delay(30_000, &Ok(true)), 250);
    }
}
