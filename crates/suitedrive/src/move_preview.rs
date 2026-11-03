//! Predict access after a move, and refuse an approval that no longer matches.
//! Other people's grants are not part of the prediction.

use serde::Serialize;

use crate::{AccessExplanation, AccessReason};

/// The caller's access after a move, and whether an earlier approval is still current.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveAccessPreview {
    /// The item or the destination changed after the approval was recorded.
    pub stale: bool,
    /// A stale approval is refused. The predicted access is still returned.
    pub refused: bool,
    pub predicted: AccessExplanation,
}

/// Access that would remain on the item. A direct grant moves with the item.
/// Access that came from the old folder is replaced by the destination.
pub fn predict_after_move(
    item_id: &str,
    item: &AccessExplanation,
    destination: &AccessExplanation,
) -> AccessExplanation {
    match &item.reason {
        AccessReason::Admin | AccessReason::Owner { .. } => item.clone(),
        AccessReason::Grant {
            inherited: false, ..
        } => item.clone(),
        AccessReason::Expired {
            item_id: grant_item,
            ..
        } if grant_item == item_id => {
            if destination.role.is_some() {
                inherited_from_destination(destination)
            } else {
                item.clone()
            }
        }
        _ => inherited_from_destination(destination),
    }
}

/// Refuse the move when the recorded approval is not the access decision now.
pub fn decide_move(
    item_id: &str,
    approved_item: &AccessExplanation,
    approved_destination: &AccessExplanation,
    item_now: &AccessExplanation,
    destination_now: &AccessExplanation,
) -> MoveAccessPreview {
    let stale = approved_item != item_now || approved_destination != destination_now;
    MoveAccessPreview {
        stale,
        refused: stale,
        predicted: predict_after_move(item_id, item_now, destination_now),
    }
}

fn inherited_from_destination(destination: &AccessExplanation) -> AccessExplanation {
    let mut predicted = destination.clone();
    if let AccessReason::Grant { inherited, .. } = &mut predicted.reason {
        *inherited = true;
    }
    predicted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(item_id: &str, inherited: bool) -> AccessExplanation {
        AccessExplanation {
            role: Some(crate::Role::Editor),
            reason: AccessReason::Grant {
                principal_type: "user".into(),
                principal_id: "ada".into(),
                item_id: item_id.into(),
                item_name: item_id.into(),
                inherited,
            },
            folder_chain_truncated: false,
            group_loops: vec![],
        }
    }

    fn none() -> AccessExplanation {
        AccessExplanation {
            role: None,
            reason: AccessReason::None,
            folder_chain_truncated: false,
            group_loops: vec![],
        }
    }

    #[test]
    fn a_direct_grant_moves_and_an_inherited_grant_follows_the_destination() {
        let direct = grant("file", false);
        let inherited = grant("old-folder", true);
        let destination = grant("new-folder", false);
        let kept = predict_after_move("file", &direct, &none());
        assert_eq!(kept, direct);
        let moved = predict_after_move("file", &inherited, &destination);
        match moved.reason {
            AccessReason::Grant {
                inherited, item_id, ..
            } => {
                assert!(inherited);
                assert_eq!(item_id, "new-folder");
            }
            other => panic!("expected an inherited grant, got {other:?}"),
        }
    }

    #[test]
    fn a_changed_destination_refuses_the_earlier_approval() {
        let item = grant("file", true);
        let approved_destination = grant("new-folder", false);
        let destination_now = none();
        let preview = decide_move(
            "file",
            &item,
            &approved_destination,
            &item,
            &destination_now,
        );
        assert!(preview.stale);
        assert!(preview.refused);
        assert_eq!(preview.predicted.role, None);
        let fresh = decide_move("file", &item, &destination_now, &item, &destination_now);
        assert!(!fresh.refused);
        assert_eq!(fresh.predicted.role, None);
    }

    #[test]
    fn an_expired_grant_on_the_file_does_not_hide_the_destination() {
        let expired = AccessExplanation {
            role: None,
            reason: AccessReason::Expired {
                principal_type: "user".into(),
                principal_id: "ada".into(),
                item_id: "file".into(),
            },
            folder_chain_truncated: false,
            group_loops: vec![],
        };
        let destination = grant("new-folder", false);
        let moved = predict_after_move("file", &expired, &destination);
        assert_eq!(moved.role, Some(crate::Role::Editor));
        match moved.reason {
            AccessReason::Grant {
                inherited, item_id, ..
            } => {
                assert!(inherited);
                assert_eq!(item_id, "new-folder");
            }
            other => panic!("expected the destination grant, got {other:?}"),
        }
        let stayed = predict_after_move("file", &expired, &none());
        assert_eq!(stayed.role, None);
        assert!(matches!(stayed.reason, AccessReason::Expired { .. }));
    }
}
