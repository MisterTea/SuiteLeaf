//! How many sealed copies a schedule keeps. The newest file always stays.

use std::{fs, path::Path};

use anyhow::{Result, bail};

/// Delete older sealed siblings of `sealed`. `keep_at_least` includes the newest file.
/// A file that is not this seal's name, including `notes.sldoc`, is left in place.
/// This does not open the sealed bytes and does not touch the live store.
pub fn retain_sealed_copies(
    sealed: &Path,
    keep_after: &str,
    keep_at_least: usize,
) -> Result<Vec<String>> {
    let Some(parent) = sealed.parent() else {
        bail!("That sealed backup is not in a directory.");
    };
    let Some(base) = sealed.file_name().and_then(|name| name.to_str()) else {
        bail!("That sealed backup is not in a directory.");
    };
    if base.is_empty() || base.contains('/') || base.contains('\\') || base.contains("..") {
        bail!("That sealed backup is not in a directory.");
    }
    let cutoff = super::seal_stamp(keep_after)
        .ok_or_else(|| anyhow::anyhow!("The current time is not a time."))?;
    if !parent.is_dir() {
        return Ok(Vec::new());
    }
    let mut family = Vec::new();
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !entry.path().is_file() {
            continue;
        }
        if name == base || stamp_of(base, name).is_some() {
            family.push(name.to_owned());
        }
    }
    family.sort();
    let Some(newest) = family.last().cloned() else {
        return Ok(Vec::new());
    };
    let mut keep = vec![newest];
    let mut older = Vec::new();
    for name in family.iter().rev().skip(1) {
        let fresh = stamp_of(base, name).is_some_and(|stamp| stamp.as_str() >= cutoff.as_str());
        if fresh {
            keep.push(name.clone());
        } else {
            older.push(name.clone());
        }
    }
    let floor = keep_at_least.max(1);
    while keep.len() < floor {
        let Some(name) = older.first().cloned() else {
            break;
        };
        older.remove(0);
        keep.push(name);
    }
    if !parent.join(keep[0].as_str()).is_file() {
        bail!("retention would leave no backup");
    }
    let mut removed = Vec::new();
    for name in older {
        if keep.iter().any(|kept| kept == &name) {
            continue;
        }
        let path = parent.join(&name);
        if path.is_file() {
            fs::remove_file(&path)?;
            removed.push(name);
        }
    }
    Ok(removed)
}

fn stamp_of(base: &str, name: &str) -> Option<String> {
    let rest = name.strip_prefix(base)?.strip_prefix('-')?;
    (rest.len() == 14 && rest.bytes().all(|byte| byte.is_ascii_digit())).then(|| rest.to_owned())
}

pub fn retention_count(freshness: &Path) -> Result<Option<usize>> {
    let path = freshness.join("retention.txt");
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).unwrap_or_default();
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 3 || !trimmed.bytes().all(|byte| byte.is_ascii_digit())
    {
        bail!("The backup retention count is not a whole number.");
    }
    let count: usize = trimmed.parse().unwrap_or(0);
    if !(1..=100).contains(&count) {
        bail!("The backup retention count is not a whole number.");
    }
    Ok(Some(count))
}
