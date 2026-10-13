use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;
use suitedb::{Schema, TableDef};

/// Generated from the better-auth configuration by
/// `npm run generate-schema -w @suiteleaf/auth`.
const AUTH_SCHEMA: &str = include_str!("../../../services/auth/schema.json");

#[derive(Deserialize)]
struct AuthSchema {
    version: u32,
    tables: Vec<TableDef>,
}

/// The replicated schema every node in a cluster must share: better-auth's
/// tables plus SuiteDrive's. `auth_override` substitutes a different
/// generated auth schema, for tests or custom plugin sets.
pub fn node_schema(auth_override: Option<&Path>) -> Result<Schema> {
    let text = match auth_override {
        Some(path) => {
            std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?
        }
        None => AUTH_SCHEMA.to_owned(),
    };
    let auth: AuthSchema = serde_json::from_str(&text).context("parse the auth schema")?;
    let mut tables = auth.tables;
    tables.extend(suitedrive::tables());
    let schema = Schema {
        version: auth.version * 100 + suitedrive::SCHEMA_VERSION,
        tables,
    };
    schema.validate()?;
    Ok(schema)
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_embedded_schema_has_auth_and_drive_tables() {
        let schema = super::node_schema(None).unwrap();
        for table in [
            "user",
            "session",
            "account",
            "verification",
            "jwks",
            "organization",
            "member",
            "drive_item",
        ] {
            assert!(schema.table(table).is_some(), "{table} is missing");
        }
        assert!(
            schema
                .table("user")
                .unwrap()
                .unique
                .contains(&"email".to_owned())
        );
    }
}
