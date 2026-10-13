use serde::{Deserialize, Serialize};

use crate::{Error, Result, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColumnType {
    Text,
    Integer,
    Real,
    Blob,
    Any,
}

impl ColumnType {
    fn sql(self) -> &'static str {
        match self {
            ColumnType::Text => "TEXT",
            ColumnType::Integer => "INTEGER",
            ColumnType::Real => "REAL",
            ColumnType::Blob => "BLOB",
            ColumnType::Any => "",
        }
    }

    pub fn accepts(self, value: &Value) -> bool {
        matches!(
            (self, value),
            (_, Value::Null)
                | (ColumnType::Any, _)
                | (ColumnType::Text, Value::Text(_))
                | (ColumnType::Integer, Value::Integer(_))
                | (ColumnType::Real, Value::Real(_) | Value::Integer(_))
                | (ColumnType::Blob, Value::Blob(_))
        )
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: ColumnType,
}

/// A replicated table. Materialized tables carry no SQL constraints besides
/// the primary key, because concurrent writes on different nodes can
/// legitimately violate them until merged. `unique` columns are checked
/// after every merge instead; see [`crate::Db::conflicts`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableDef {
    pub name: String,
    pub pk: String,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub unique: Vec<String>,
    #[serde(default)]
    pub indexes: Vec<String>,
}

impl TableDef {
    pub fn new(name: &str, pk: &str) -> Self {
        TableDef {
            name: name.into(),
            pk: pk.into(),
            columns: vec![],
            unique: vec![],
            indexes: vec![],
        }
    }

    pub fn column(mut self, name: &str, ty: ColumnType) -> Self {
        self.columns.push(Column {
            name: name.into(),
            ty,
        });
        self
    }

    pub fn unique(mut self, name: &str) -> Self {
        self.unique.push(name.into());
        self
    }

    pub fn index(mut self, name: &str) -> Self {
        self.indexes.push(name.into());
        self
    }

    pub fn column_type(&self, name: &str) -> Option<ColumnType> {
        if name == self.pk {
            return Some(ColumnType::Text);
        }
        self.columns.iter().find(|c| c.name == name).map(|c| c.ty)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Schema {
    /// Ops record the schema version they were written with; a node holds
    /// back ops from a newer schema until it is upgraded.
    pub version: u32,
    pub tables: Vec<TableDef>,
}

impl Schema {
    pub fn table(&self, name: &str) -> Option<&TableDef> {
        self.tables.iter().find(|t| t.name == name)
    }

    pub fn validate(&self) -> Result<()> {
        for t in &self.tables {
            check_ident(&t.name)?;
            if t.name.starts_with('_') {
                return Err(Error::Schema(format!(
                    "table {} uses the reserved _ prefix",
                    t.name
                )));
            }
            check_ident(&t.pk)?;
            for c in &t.columns {
                check_ident(&c.name)?;
                if c.name == t.pk {
                    return Err(Error::Schema(format!(
                        "{}.{} repeats the primary key",
                        t.name, c.name
                    )));
                }
            }
            for c in t.unique.iter().chain(&t.indexes) {
                if t.column_type(c).is_none() {
                    return Err(Error::Schema(format!("{}.{c} is not a column", t.name)));
                }
            }
        }
        Ok(())
    }

    pub(crate) fn migrate(&self, conn: &rusqlite::Connection) -> Result<()> {
        for t in &self.tables {
            conn.execute_batch(&format!(
                "CREATE TABLE IF NOT EXISTS {} ({} TEXT PRIMARY KEY NOT NULL)",
                quote(&t.name),
                quote(&t.pk)
            ))?;
            let existing: Vec<String> = conn
                .prepare(&format!(
                    "SELECT name FROM pragma_table_info({})",
                    sql_string(&t.name)
                ))?
                .query_map([], |r| r.get(0))?
                .collect::<std::result::Result<_, _>>()?;
            for c in &t.columns {
                if !existing.contains(&c.name) {
                    conn.execute_batch(&format!(
                        "ALTER TABLE {} ADD COLUMN {} {}",
                        quote(&t.name),
                        quote(&c.name),
                        c.ty.sql()
                    ))?;
                }
            }
            for c in t.unique.iter().chain(&t.indexes) {
                conn.execute_batch(&format!(
                    "CREATE INDEX IF NOT EXISTS {} ON {} ({})",
                    quote(&format!("ix_{}_{}", t.name, c)),
                    quote(&t.name),
                    quote(c)
                ))?;
            }
        }
        Ok(())
    }
}

pub fn check_ident(name: &str) -> Result<()> {
    let mut chars = name.chars();
    let ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && name.len() <= 64;
    if ok {
        Ok(())
    } else {
        Err(Error::Schema(format!("invalid identifier {name:?}")))
    }
}

/// Quote a validated identifier.
pub fn quote(name: &str) -> String {
    format!("\"{name}\"")
}

fn sql_string(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}
