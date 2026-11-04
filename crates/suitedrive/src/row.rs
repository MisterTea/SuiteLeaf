//! Column values read out of a SuiteDB row.

use std::collections::BTreeMap;

use suitedb::Value;

pub(crate) type Row = BTreeMap<String, Value>;

pub(crate) fn text(row: &Row, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::Text(s)) => Some(s.clone()),
        _ => None,
    }
}

pub(crate) fn int(row: &Row, key: &str) -> i64 {
    match row.get(key) {
        Some(Value::Integer(i)) => *i,
        _ => 0,
    }
}
