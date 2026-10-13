//! The loopback-only database API used by the better-auth adapter.
//!
//! Requests mirror better-auth's `CustomAdapter` methods. Reads hide rows
//! that lost a unique-key conflict, so lookups by email or username always
//! return the deterministic winner on every node.

use std::{collections::BTreeMap, sync::Arc};

use anyhow::{Result, anyhow, bail};
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use serde_json::{Map, Value as Json};
use suitedb::{ColumnType, Db, TableDef, Value, quote};

pub const TOKEN_HEADER: &str = "x-suiteleaf-internal";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbRequest {
    pub op: String,
    pub model: String,
    #[serde(default)]
    pub data: Map<String, Json>,
    #[serde(rename = "where", default)]
    pub filter: Vec<WhereClause>,
    #[serde(default)]
    pub update: Map<String, Json>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort_by: Option<SortBy>,
    pub select: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct WhereClause {
    pub field: String,
    #[serde(default = "eq")]
    pub operator: String,
    pub value: Json,
    #[serde(default)]
    pub connector: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
}

fn eq() -> String {
    "eq".into()
}

#[derive(Debug, Deserialize)]
pub struct SortBy {
    pub field: String,
    pub direction: String,
}

fn table<'a>(db: &'a Db, model: &str) -> Result<&'a TableDef> {
    db.schema()
        .table(model)
        .ok_or_else(|| anyhow!("unknown model {model}"))
}

fn column(def: &TableDef, field: &str) -> Result<ColumnType> {
    def.column_type(field)
        .ok_or_else(|| anyhow!("unknown field {}.{field}", def.name))
}

/// Convert a JSON value from the adapter into the column's storage type.
pub fn to_value(ty: ColumnType, v: &Json) -> Result<Value> {
    Ok(match (ty, v) {
        (_, Json::Null) => Value::Null,
        (ColumnType::Text, Json::String(s)) => Value::Text(s.clone()),
        (ColumnType::Text, Json::Number(n)) => Value::Text(n.to_string()),
        (ColumnType::Text, Json::Bool(b)) => Value::Text(b.to_string()),
        (ColumnType::Text | ColumnType::Any, Json::Array(_) | Json::Object(_)) => {
            Value::Text(v.to_string())
        }
        (ColumnType::Integer | ColumnType::Any, Json::Bool(b)) => Value::Integer(*b as i64),
        (ColumnType::Integer | ColumnType::Real | ColumnType::Any, Json::Number(n)) => {
            match n.as_i64() {
                Some(i) if ty != ColumnType::Real || n.is_i64() => Value::Integer(i),
                _ => Value::Real(n.as_f64().ok_or_else(|| anyhow!("number out of range"))?),
            }
        }
        (ColumnType::Any, Json::String(s)) => Value::Text(s.clone()),
        (ColumnType::Integer, Json::String(s)) => Value::Integer(s.parse()?),
        (ColumnType::Real, Json::String(s)) => Value::Real(s.parse()?),
        (ty, v) => bail!("cannot store {v} in a {ty:?} column"),
    })
}

struct Filter {
    sql: String,
    params: Vec<Value>,
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn build_filter(def: &TableDef, clauses: &[WhereClause]) -> Result<Filter> {
    let mut params = Vec::new();
    let mut and = Vec::new();
    let mut or = Vec::new();
    for clause in clauses {
        let ty = column(def, &clause.field)?;
        let insensitive = clause.mode.as_deref() == Some("insensitive");
        let col = if insensitive {
            format!("LOWER({})", quote(&clause.field))
        } else {
            quote(&clause.field)
        };
        let mut bind = |v: &Json| -> Result<String> {
            let mut value = to_value(ty, v)?;
            if let (true, Value::Text(s)) = (insensitive, &value) {
                value = Value::Text(s.to_lowercase());
            }
            params.push(value);
            Ok(format!("?{}", params.len()))
        };
        let sql = match (clause.operator.as_str(), &clause.value) {
            ("eq", Json::Null) => format!("{col} IS NULL"),
            ("ne", Json::Null) => format!("{col} IS NOT NULL"),
            ("eq", v) => format!("{col} = {}", bind(v)?),
            ("ne", v) => format!("({col} IS NULL OR {col} != {})", bind(v)?),
            ("lt", v) => format!("{col} < {}", bind(v)?),
            ("lte", v) => format!("{col} <= {}", bind(v)?),
            ("gt", v) => format!("{col} > {}", bind(v)?),
            ("gte", v) => format!("{col} >= {}", bind(v)?),
            (op @ ("in" | "not_in"), Json::Array(items)) => {
                if items.is_empty() {
                    if op == "in" { "0".into() } else { "1".into() }
                } else {
                    let marks = items.iter().map(&mut bind).collect::<Result<Vec<_>>>()?;
                    let not = if op == "in" { "" } else { "NOT " };
                    format!("{col} {not}IN ({})", marks.join(", "))
                }
            }
            (op @ ("contains" | "starts_with" | "ends_with"), Json::String(s)) => {
                let s = escape_like(s);
                let pattern = match op {
                    "contains" => format!("%{s}%"),
                    "starts_with" => format!("{s}%"),
                    _ => format!("%{s}"),
                };
                format!("{col} LIKE {} ESCAPE '\\'", bind(&Json::String(pattern))?)
            }
            (op, v) => bail!("unsupported where clause {op} {v}"),
        };
        if clause.connector.as_deref() == Some("OR") {
            or.push(sql);
        } else {
            and.push(sql);
        }
    }
    if !or.is_empty() {
        and.push(format!("({})", or.join(" OR ")));
    }
    params.push(Value::Text(def.name.clone()));
    and.push(format!(
        "{} NOT IN (SELECT loser FROM _conflicts WHERE tbl = ?{})",
        quote(&def.pk),
        params.len()
    ));
    Ok(Filter {
        sql: and.join(" AND "),
        params,
    })
}

fn row_json(row: BTreeMap<String, Value>, select: Option<&[String]>) -> Json {
    Json::Object(
        row.into_iter()
            .filter(|(k, _)| select.is_none_or(|s| s.is_empty() || s.contains(k)))
            .map(|(k, v)| (k, v.to_json()))
            .collect(),
    )
}

fn find(
    db: &Db,
    def: &TableDef,
    req: &DbRequest,
    limit: Option<i64>,
) -> Result<Vec<BTreeMap<String, Value>>> {
    let filter = build_filter(def, &req.filter)?;
    let mut sql = format!("SELECT * FROM {} WHERE {}", quote(&def.name), filter.sql);
    if let Some(sort) = &req.sort_by {
        column(def, &sort.field)?;
        let dir = if sort.direction.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };
        sql.push_str(&format!(" ORDER BY {} {dir}", quote(&sort.field)));
    }
    sql.push_str(&format!(" LIMIT {}", limit.unwrap_or(-1)));
    if let Some(offset) = req.offset {
        sql.push_str(&format!(" OFFSET {}", offset.max(0)));
    }
    Ok(db.query(&sql, &filter.params)?)
}

fn columns(def: &TableDef, data: &Map<String, Json>) -> Result<Vec<(String, Value)>> {
    data.iter()
        .filter(|(k, _)| *k != &def.pk)
        .map(|(k, v)| Ok((k.clone(), to_value(column(def, k)?, v)?)))
        .collect()
}

fn update_rows(
    db: &Db,
    def: &TableDef,
    req: &DbRequest,
    limit: Option<i64>,
) -> Result<Vec<String>> {
    let pks: Vec<String> = find(db, def, req, limit)?
        .into_iter()
        .filter_map(|r| match r.get(&def.pk) {
            Some(Value::Text(s)) => Some(s.clone()),
            _ => None,
        })
        .collect();
    let cols = columns(def, &req.update)?;
    if !cols.is_empty() {
        db.transact(|tx| {
            for pk in &pks {
                tx.upsert(&def.name, pk, cols.clone())?;
            }
            Ok(())
        })?;
    }
    Ok(pks)
}

fn delete_rows(db: &Db, def: &TableDef, req: &DbRequest) -> Result<usize> {
    let rows = find(db, def, req, None)?;
    db.transact(|tx| {
        for row in &rows {
            if let Some(Value::Text(pk)) = row.get(&def.pk) {
                tx.delete(&def.name, pk)?;
            }
        }
        Ok(())
    })?;
    Ok(rows.len())
}

pub fn execute(db: &Db, req: DbRequest) -> Result<Json> {
    let def = table(db, &req.model)?;
    let select = req.select.as_deref();
    Ok(match req.op.as_str() {
        "create" => {
            let pk = match req.data.get(&def.pk) {
                Some(Json::String(s)) if !s.is_empty() => s.clone(),
                Some(Json::Number(n)) => n.to_string(),
                _ => uuid::Uuid::now_v7().to_string(),
            };
            let cols = columns(def, &req.data)?;
            db.transact(|tx| tx.upsert(&def.name, &pk, cols))?;
            db.get(&def.name, &pk)?
                .map_or(Json::Null, |r| row_json(r, select))
        }
        "findOne" => find(db, def, &req, Some(1))?
            .into_iter()
            .next()
            .map_or(Json::Null, |r| row_json(r, select)),
        "findMany" => Json::Array(
            find(db, def, &req, req.limit)?
                .into_iter()
                .map(|r| row_json(r, select))
                .collect(),
        ),
        "count" => {
            let filter = build_filter(def, &req.filter)?;
            let rows = db.query(
                &format!(
                    "SELECT COUNT(*) AS n FROM {} WHERE {}",
                    quote(&def.name),
                    filter.sql
                ),
                &filter.params,
            )?;
            rows.first()
                .and_then(|r| r.get("n"))
                .map_or(Json::from(0), Value::to_json)
        }
        "update" => match update_rows(db, def, &req, Some(1))?.first() {
            Some(pk) => db
                .get(&def.name, pk)?
                .map_or(Json::Null, |r| row_json(r, None)),
            None => Json::Null,
        },
        "updateMany" => Json::from(update_rows(db, def, &req, None)?.len()),
        "delete" | "deleteMany" => Json::from(delete_rows(db, def, &req)?),
        op => bail!("unsupported operation {op}"),
    })
}

#[derive(Clone)]
pub struct InternalState {
    pub db: Arc<Db>,
    pub token: Arc<String>,
}

async fn handle(
    State(state): State<InternalState>,
    headers: HeaderMap,
    axum::Json(req): axum::Json<DbRequest>,
) -> Response {
    if headers.get(TOKEN_HEADER).and_then(|v| v.to_str().ok()) != Some(state.token.as_str()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let db = state.db.clone();
    match tokio::task::spawn_blocking(move || execute(&db, req)).await {
        Ok(Ok(json)) => axum::Json(serde_json::json!({ "result": json })).into_response(),
        Ok(Err(e)) => (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": format!("{e:#}") })),
        )
            .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub fn router(state: InternalState) -> Router {
    Router::new()
        .route("/internal/db", post(handle))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use suitedb::{Schema, TableDef};

    fn db() -> Db {
        let schema = Schema {
            version: 1,
            tables: vec![
                TableDef::new("user", "id")
                    .column("email", ColumnType::Text)
                    .column("name", ColumnType::Text)
                    .column("emailVerified", ColumnType::Integer)
                    .column("createdAt", ColumnType::Text)
                    .unique("email"),
            ],
        };
        Db::open_in_memory(libp2p_ed25519(), schema).unwrap()
    }

    fn libp2p_ed25519() -> suiteleaf_net::identity::ed25519::Keypair {
        suiteleaf_net::identity::ed25519::Keypair::generate()
    }

    fn run(db: &Db, req: Json) -> Json {
        execute(db, serde_json::from_value(req).unwrap()).unwrap()
    }

    #[test]
    fn supports_the_better_auth_adapter_operations() {
        let db = db();
        let created = run(
            &db,
            serde_json::json!({
                "op": "create", "model": "user",
                "data": { "id": "u1", "email": "A@example.com", "name": "Ann", "emailVerified": 0, "createdAt": "2026-01-01T00:00:00.000Z" }
            }),
        );
        assert_eq!(created["email"], "A@example.com");
        run(
            &db,
            serde_json::json!({ "op": "create", "model": "user", "data": { "id": "u2", "email": "b@example.com", "name": "Bob_%", "createdAt": "2026-02-01T00:00:00.000Z" } }),
        );
        let found = run(
            &db,
            serde_json::json!({ "op": "findOne", "model": "user", "where": [{ "field": "email", "operator": "eq", "value": "a@example.com", "mode": "insensitive", "connector": "AND" }] }),
        );
        assert_eq!(found["id"], "u1");
        let many = run(
            &db,
            serde_json::json!({ "op": "findMany", "model": "user", "where": [{ "field": "createdAt", "operator": "gt", "value": "2026-01-15T00:00:00.000Z" }], "sortBy": { "field": "name", "direction": "desc" }, "limit": 10 }),
        );
        assert_eq!(many.as_array().unwrap().len(), 1);
        let like = run(
            &db,
            serde_json::json!({ "op": "findMany", "model": "user", "where": [{ "field": "name", "operator": "contains", "value": "_%" }] }),
        );
        assert_eq!(like[0]["id"], "u2");
        let either = run(
            &db,
            serde_json::json!({ "op": "count", "model": "user", "where": [
            { "field": "id", "operator": "eq", "value": "u1", "connector": "OR" },
            { "field": "id", "operator": "in", "value": ["u2"], "connector": "OR" }
        ] }),
        );
        assert_eq!(either, 2);
        let updated = run(
            &db,
            serde_json::json!({ "op": "update", "model": "user", "where": [{ "field": "id", "value": "u1" }], "update": { "emailVerified": 1 } }),
        );
        assert_eq!(updated["emailVerified"], 1);
        assert_eq!(
            run(
                &db,
                serde_json::json!({ "op": "deleteMany", "model": "user", "where": [{ "field": "id", "operator": "ne", "value": "u1" }] })
            ),
            1
        );
        assert_eq!(
            run(&db, serde_json::json!({ "op": "count", "model": "user" })),
            1
        );
    }

    #[test]
    fn rejects_unknown_fields_and_hides_conflict_losers() {
        let db = db();
        assert!(execute(&db, serde_json::from_value(serde_json::json!({ "op": "findOne", "model": "user", "where": [{ "field": "password\" OR 1=1 --", "value": "x" }] })).unwrap()).is_err());
        assert!(
            execute(
                &db,
                serde_json::from_value(serde_json::json!({ "op": "findOne", "model": "secrets" }))
                    .unwrap()
            )
            .is_err()
        );
        run(
            &db,
            serde_json::json!({ "op": "create", "model": "user", "data": { "id": "first", "email": "x@example.com" } }),
        );
        run(
            &db,
            serde_json::json!({ "op": "create", "model": "user", "data": { "id": "second", "email": "x@example.com" } }),
        );
        let found = run(
            &db,
            serde_json::json!({ "op": "findMany", "model": "user", "where": [{ "field": "email", "value": "x@example.com" }] }),
        );
        assert_eq!(found.as_array().unwrap().len(), 1);
        assert_eq!(found[0]["id"], "first");
    }
}
