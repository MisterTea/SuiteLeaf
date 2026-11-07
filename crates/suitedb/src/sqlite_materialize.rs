//! SQLite CRDT materialization, kept separate from the central Postgres backend.
use super::*;

pub(super) fn heads(conn: &Connection) -> Result<Vec<OpId>> {
    let ids: Vec<Vec<u8>> = conn
        .prepare("SELECT id FROM _heads ORDER BY id")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(ids
        .into_iter()
        .filter_map(|b| b.try_into().ok().map(OpId))
        .collect())
}

pub(super) fn apply_change(
    conn: &Connection,
    def: &TableDef,
    change: &Change,
    version: &str,
) -> Result<()> {
    let table = quote(&def.name);
    let pk_col = quote(&def.pk);
    let (created, upserted, deleted): (Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT created, upserted, deleted FROM _rows WHERE tbl = ?1 AND pk = ?2",
            params![def.name, change.pk],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .unwrap_or((None, None, None));
    let save_row =
        |created: &Option<String>, upserted: &Option<String>, deleted: &Option<String>| {
            conn.execute(
            "INSERT INTO _rows (tbl, pk, created, upserted, deleted) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (tbl, pk) DO UPDATE SET created = excluded.created,
               upserted = excluded.upserted, deleted = excluded.deleted",
            params![def.name, change.pk, created, upserted, deleted],
        )
        };
    match &change.kind {
        ChangeKind::Upsert(cols) => {
            let created = Some(created.map_or(version.to_owned(), |c| c.min(version.to_owned())));
            let upserted = Some(upserted.map_or(version.to_owned(), |u| u.max(version.to_owned())));
            save_row(&created, &upserted, &deleted)?;
            let mut visible: Vec<(&String, &Value)> = Vec::new();
            for (col, value) in cols {
                if col == &def.pk {
                    continue;
                }
                let current: Option<String> = conn
                    .query_row(
                        "SELECT version FROM _versions WHERE tbl = ?1 AND pk = ?2 AND col = ?3",
                        params![def.name, change.pk, col],
                        |r| r.get(0),
                    )
                    .optional()?;
                if current.as_deref().is_none_or(|c| version > c) {
                    conn.execute(
                        "INSERT INTO _versions (tbl, pk, col, version) VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT (tbl, pk, col) DO UPDATE SET version = excluded.version",
                        params![def.name, change.pk, col, version],
                    )?;
                    if deleted.as_deref().is_none_or(|d| version > d) {
                        visible.push((col, value));
                    }
                }
            }
            let alive = match (&upserted, &deleted) {
                (Some(u), Some(d)) => u > d,
                _ => true,
            };
            if alive {
                conn.execute(
                    &format!("INSERT INTO {table} ({pk_col}) VALUES (?1) ON CONFLICT ({pk_col}) DO NOTHING"),
                    [&change.pk],
                )?;
                if !visible.is_empty() {
                    let sets: Vec<String> = visible
                        .iter()
                        .enumerate()
                        .map(|(i, (c, _))| format!("{} = ?{}", quote(c), i + 2))
                        .collect();
                    let mut values: Vec<&dyn ToSql> = vec![&change.pk];
                    values.extend(visible.iter().map(|(_, v)| *v as &dyn ToSql));
                    conn.execute(
                        &format!("UPDATE {table} SET {} WHERE {pk_col} = ?1", sets.join(", ")),
                        values.as_slice(),
                    )?;
                }
            }
        }
        ChangeKind::Delete => {
            if deleted.as_deref().is_some_and(|d| d >= version) {
                return Ok(());
            }
            let deleted = Some(version.to_owned());
            save_row(&created, &upserted, &deleted)?;
            if upserted.as_deref().is_none_or(|u| u < version) {
                conn.execute(
                    &format!("DELETE FROM {table} WHERE {pk_col} = ?1"),
                    [&change.pk],
                )?;
            } else {
                let stale: Vec<String> = conn
                    .prepare(
                        "SELECT col FROM _versions WHERE tbl = ?1 AND pk = ?2 AND version < ?3",
                    )?
                    .query_map(params![def.name, change.pk, version], |r| r.get(0))?
                    .collect::<std::result::Result<_, _>>()?;
                let stale: Vec<&String> = stale
                    .iter()
                    .filter(|c| def.column_type(c).is_some())
                    .collect();
                if !stale.is_empty() {
                    let sets: Vec<String> = stale
                        .iter()
                        .map(|c| format!("{} = NULL", quote(c)))
                        .collect();
                    conn.execute(
                        &format!("UPDATE {table} SET {} WHERE {pk_col} = ?1", sets.join(", ")),
                        [&change.pk],
                    )?;
                }
            }
        }
    }
    Ok(())
}

pub(super) fn refresh_conflicts(conn: &Connection, def: &TableDef) -> Result<()> {
    let table = quote(&def.name);
    let pk = quote(&def.pk);
    for col in &def.unique {
        let c = quote(col);
        conn.execute(
            "DELETE FROM _conflicts WHERE tbl = ?1 AND col = ?2",
            params![def.name, col],
        )?;
        let rows: Vec<(String, String)> = conn
            .prepare(&format!(
                "SELECT CAST(t.{c} AS TEXT), t.{pk} FROM {table} t
                 JOIN _rows r ON r.tbl = ?1 AND r.pk = t.{pk}
                 WHERE t.{c} IN (SELECT {c} FROM {table} WHERE {c} IS NOT NULL GROUP BY {c} HAVING COUNT(*) > 1)
                 ORDER BY t.{c}, r.created, t.{pk}"
            ))?
            .query_map([&def.name], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        let mut winner: Option<(String, String)> = None;
        for (value, row) in rows {
            match &winner {
                Some((v, w)) if *v == value => {
                    conn.execute(
                        "INSERT INTO _conflicts (tbl, col, value, winner, loser) VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![def.name, col, value, w, row],
                    )?;
                }
                _ => winner = Some((value, row)),
            }
        }
    }
    Ok(())
}
