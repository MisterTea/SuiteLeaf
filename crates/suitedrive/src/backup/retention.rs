//! Which old backups may be removed. The newest copy always stays.

use std::{fs, path::Path};

use anyhow::{Result, bail};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetentionPlan {
    pub keep: Vec<String>,
    pub remove: Vec<String>,
    /// `recordedAt` of the newest copy. Empty when there are no copies.
    pub newest_recorded_at: Option<String>,
}

/// Which backup ids may be deleted. The newest copy is always kept.
/// A copy recorded at or after `keep_after` is kept. A missing time is kept.
/// Older copies stay until at least `keep_at_least` copies remain.
/// This function does not delete anything.
pub fn retention_plan(
    copies: &[(String, String)],
    keep_after: &str,
    keep_at_least: usize,
) -> RetentionPlan {
    let mut ordered: Vec<&(String, String)> = copies.iter().collect();
    ordered.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    let newest_recorded_at = ordered.first().map(|copy| copy.1.clone());
    let mut keep = Vec::new();
    let mut older = Vec::new();
    for (index, (id, recorded_at)) in ordered.into_iter().enumerate() {
        let fresh = !recorded_at.is_empty() && recorded_at.as_str() >= keep_after;
        if index == 0 || fresh || recorded_at.is_empty() {
            keep.push(id.clone());
        } else {
            older.push(id.clone());
        }
    }
    let floor = keep_at_least.max(if copies.is_empty() { 0 } else { 1 });
    while keep.len() < floor {
        let Some(id) = older.first().cloned() else {
            break;
        };
        older.remove(0);
        keep.push(id);
    }
    RetentionPlan {
        keep,
        remove: older,
        newest_recorded_at,
    }
}

fn backup_dir_name(id: &str) -> Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        bail!("That backup name is not a single directory.");
    }
    Ok(())
}

/// Delete only directories the plan lists in `remove`. The newest kept copy
/// must still have `manifest.json`. A plan that would leave none is refused,
/// and nothing is deleted.
pub fn apply_retention(root: &Path, plan: &RetentionPlan) -> Result<Vec<String>> {
    for id in plan.keep.iter().chain(plan.remove.iter()) {
        backup_dir_name(id)?;
    }
    let kept = plan
        .keep
        .iter()
        .filter(|id| root.join(id).join("manifest.json").is_file())
        .count();
    if kept == 0 {
        bail!("retention would leave no backup");
    }
    let mut removed = Vec::new();
    for id in &plan.remove {
        if plan.keep.iter().any(|kept_id| kept_id == id) {
            continue;
        }
        let path = root.join(id);
        if path.is_dir() {
            fs::remove_dir_all(&path)?;
            removed.push(id.clone());
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_copy(root: &Path, id: &str) {
        let dir = root.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("manifest.json"), b"{}").unwrap();
    }

    #[test]
    fn retention_keeps_the_newest_backup_and_refuses_to_remove_the_last_one() {
        let root = tempfile::tempdir().unwrap();
        write_copy(root.path(), "monday");
        write_copy(root.path(), "tuesday");
        write_copy(root.path(), "wednesday");
        let copies = vec![
            ("monday".into(), "2026-10-26T00:00:00.000Z".into()),
            ("tuesday".into(), "2026-10-27T00:00:00.000Z".into()),
            ("wednesday".into(), "2026-10-28T00:00:00.000Z".into()),
        ];
        let plan = retention_plan(&copies, "2026-10-28T00:00:00.000Z", 1);
        assert_eq!(
            plan.newest_recorded_at.as_deref(),
            Some("2026-10-28T00:00:00.000Z")
        );
        assert_eq!(plan.keep, vec!["wednesday".to_string()]);
        assert_eq!(
            plan.remove,
            vec!["tuesday".to_string(), "monday".to_string()]
        );
        let removed = apply_retention(root.path(), &plan).unwrap();
        assert_eq!(removed, vec!["tuesday".to_string(), "monday".to_string()]);
        assert!(
            root.path()
                .join("wednesday")
                .join("manifest.json")
                .is_file()
        );
        assert!(!root.path().join("monday").exists());
        let only = retention_plan(
            &[("wednesday".into(), "2026-10-01T00:00:00.000Z".into())],
            "2026-10-28T00:00:00.000Z",
            0,
        );
        assert!(only.remove.is_empty());
        let wipe = RetentionPlan {
            keep: vec!["missing".into()],
            remove: vec!["wednesday".into()],
            newest_recorded_at: None,
        };
        let error = apply_retention(root.path(), &wipe).unwrap_err();
        assert!(error.to_string().contains("no backup"));
        let named = backup_dir_name("secret-value/beds").unwrap_err();
        assert_eq!(
            named.to_string(),
            "That backup name is not a single directory."
        );
        assert!(!named.to_string().contains("secret-value"));
        assert!(
            root.path()
                .join("wednesday")
                .join("manifest.json")
                .is_file()
        );
    }
}
