//! The error a drive operation returns.

use crate::Item;

#[derive(Debug, thiserror::Error)]
pub enum DriveError {
    #[error("not found")]
    NotFound,
    #[error("you do not have access to this item")]
    Forbidden,
    #[error("the file changed on another device")]
    Conflict(Box<Item>),
    #[error("{0}")]
    BadRequest(String),
    #[error("the file has not replicated to this node yet")]
    Unavailable,
    #[error("SuiteDrive does not have room for this file.")]
    NoRoom,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl From<suitedb::Error> for DriveError {
    fn from(e: suitedb::Error) -> Self {
        DriveError::Other(e.into())
    }
}

pub type DriveResult<T> = Result<T, DriveError>;
