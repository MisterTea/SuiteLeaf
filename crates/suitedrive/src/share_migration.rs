//! Impact of restricting a folder, and how to undo it.
//! Grants are not copied or deleted.

use serde::{Deserialize, Serialize};

use crate::Role;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessChange {
    pub principal_id: String,
    pub item_id: String,
    pub item_name: String,
    pub before: Option<Role>,
    pub after: Option<Role>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestrictPlan {
    pub folder_id: String,
    pub folder_name: String,
    pub changes: Vec<AccessChange>,
    /// How to undo the restriction. The grants themselves stay where they are.
    pub recovery: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberPlan {
    pub group_id: String,
    pub group_name: String,
    pub changes: Vec<AccessChange>,
}
