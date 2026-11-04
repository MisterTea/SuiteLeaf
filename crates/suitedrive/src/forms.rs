//! Form files: what a responder may append, and the public sign-up link.

use std::collections::BTreeMap;

use serde::Serialize;
use suitedb::{Value, hlc::iso_now};

use crate::{
    Drive, DriveError, DriveResult, Principal, Role,
    expiry::normalize_expiry,
    form_answers::{checked_answers, form_score, new_answers_match_questions, question_labels},
    row::{int, text},
};

/// Questions are unchanged, and responses are the previous array plus one or
/// more new items. Earlier response objects are unchanged.
fn appends_form_responses(previous: &[u8], next: &[u8]) -> bool {
    let (Ok(previous), Ok(next)) = (
        serde_json::from_slice::<serde_json::Value>(previous),
        serde_json::from_slice::<serde_json::Value>(next),
    ) else {
        return false;
    };
    let (Some(previous_questions), Some(next_questions)) = (
        previous.pointer("/content/questions"),
        next.pointer("/content/questions"),
    ) else {
        return false;
    };
    if previous_questions.as_array().is_none() || previous_questions != next_questions {
        return false;
    }
    let (Some(previous_rows), Some(next_rows)) = (
        previous
            .pointer("/content/responses")
            .and_then(serde_json::Value::as_array),
        next.pointer("/content/responses")
            .and_then(serde_json::Value::as_array),
    ) else {
        return false;
    };
    if next_rows.len() <= previous_rows.len()
        || next_rows
            .iter()
            .zip(previous_rows)
            .any(|(next_row, previous_row)| next_row != previous_row)
        || !new_response_ids_are_new(previous_rows, next_rows)
    {
        return false;
    }
    let mut expected = previous;
    let Some(responses) = expected.pointer_mut("/content/responses") else {
        return false;
    };
    *responses = serde_json::Value::Array(next_rows.clone());
    expected == next
}

fn response_id(row: &serde_json::Value) -> Option<&str> {
    row.get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
}

/// Each new response needs an id that is not already in the file.
fn new_response_ids_are_new(
    previous_rows: &[serde_json::Value],
    next_rows: &[serde_json::Value],
) -> bool {
    let mut seen = std::collections::HashSet::new();
    for row in previous_rows {
        if let Some(id) = response_id(row) {
            seen.insert(id.to_owned());
        }
    }
    for row in next_rows.iter().skip(previous_rows.len()) {
        let Some(id) = response_id(row) else {
            return false;
        };
        if !seen.insert(id.to_owned()) {
            return false;
        }
    }
    true
}

const FORM_CLOSED: &str = "This form is not taking more responses.";

fn form_is_closed(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .and_then(|file| {
            file.pointer("/content/accepting")
                .and_then(serde_json::Value::as_bool)
        })
        == Some(false)
}

fn form_deadline_passed(bytes: &[u8]) -> bool {
    let Ok(file) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return false;
    };
    let Some(deadline) = file
        .pointer("/content/deadline")
        .and_then(serde_json::Value::as_str)
    else {
        return false;
    };
    let Ok(end) = normalize_expiry(deadline) else {
        return false;
    };
    iso_now().as_str() >= end.as_str()
}

/// A responder can read the questions. Stored answers are left out.
pub(crate) fn form_without_responses(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut file: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    file.pointer("/content/questions")
        .and_then(serde_json::Value::as_array)?;
    let responses = file.pointer_mut("/content/responses")?;
    if !responses.is_array() {
        return None;
    }
    *responses = serde_json::Value::Array(Vec::new());
    serde_json::to_vec(&file).ok()
}

fn is_form_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".slform")
}

fn valid_respond_token(token: &str) -> bool {
    uuid::Uuid::parse_str(token).is_ok()
}

fn public_question(question: &serde_json::Value) -> Option<serde_json::Value> {
    let id = question.get("id").and_then(|value| value.as_str())?;
    if id.is_empty() {
        return None;
    }
    let kind = match question.get("kind").and_then(|value| value.as_str()) {
        Some("choice") => "choice",
        Some("rating") => "rating",
        Some("grid") => "grid",
        Some("file") => "file",
        Some("number") => "number",
        _ => "text",
    };
    let mut out = serde_json::json!({
        "id": id,
        "prompt": question.get("prompt").and_then(|value| value.as_str()).unwrap_or(""),
        "kind": kind,
        "required": question.get("required").and_then(|value| value.as_bool()).unwrap_or(false),
    });
    if kind == "choice" {
        let choices: Vec<&str> = question
            .get("choices")
            .and_then(|value| value.as_array())
            .map(|choices| {
                choices
                    .iter()
                    .filter_map(|choice| choice.as_str())
                    .collect()
            })
            .unwrap_or_default();
        out["choices"] = serde_json::json!(choices);
        if let Some(branches) = question.get("branches").and_then(|value| value.as_array()) {
            let clean: Vec<&serde_json::Value> = branches
                .iter()
                .filter(|branch| {
                    branch
                        .get("when")
                        .and_then(|value| value.as_str())
                        .is_some()
                        && branch
                            .get("next")
                            .and_then(|value| value.as_str())
                            .is_some_and(|next| !next.is_empty())
                })
                .collect();
            if !clean.is_empty() {
                out["branches"] = serde_json::json!(clean);
            }
        }
    }
    if kind == "grid" {
        out["rows"] = serde_json::json!(question_labels(question, "rows"));
        out["columns"] = serde_json::json!(question_labels(question, "columns"));
    }
    if kind == "number" {
        if let Some(min) = question
            .get("min")
            .and_then(|value| value.as_f64())
            .filter(|number| number.is_finite())
        {
            out["min"] = serde_json::json!(min);
        }
        if let Some(max) = question
            .get("max")
            .and_then(|value| value.as_f64())
            .filter(|number| number.is_finite())
        {
            out["max"] = serde_json::json!(max);
        }
    }
    Some(out)
}

fn form_title(file: &serde_json::Value, name: &str) -> String {
    if let Some(title) = file
        .get("title")
        .and_then(|value| value.as_str())
        .filter(|title| !title.is_empty())
    {
        return title.to_owned();
    }
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".slform") && name.len() > 7 {
        return name[..name.len() - 7].to_owned();
    }
    name.to_owned()
}

/// What someone with a sign-up link is allowed to see: the title and the
/// questions. Responses, the file's access list, and the owner's other files
/// are not part of this.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PublicForm {
    pub title: String,
    pub questions: Vec<serde_json::Value>,
    /// False when the form is not taking more responses. Missing on an older file means true.
    pub accepting: bool,
    /// Present when the form names a real deadline.
    pub deadline: Option<String>,
}

impl Drive {
    /// A responder may save a `.slform` file only by appending responses.
    pub(crate) fn responder_may_append(&self, id: &str, bytes: &[u8]) -> DriveResult<bool> {
        let row = self.item_row(id)?;
        let name = text(&row, "name").unwrap_or_default();
        if !name.to_ascii_lowercase().ends_with(".slform") {
            return Ok(false);
        }
        let Some(previous) = self.head_bytes(&row)? else {
            return Ok(false);
        };
        if form_is_closed(&previous) {
            return Err(DriveError::BadRequest(FORM_CLOSED.into()));
        }
        if form_deadline_passed(&previous) {
            return Err(DriveError::BadRequest(
                "The deadline for this form has passed.".into(),
            ));
        }
        if !appends_form_responses(&previous, bytes) {
            return Ok(false);
        }
        new_answers_match_questions(&previous, bytes)?;
        Ok(true)
    }

    fn respond_tokens(&self, item_id: &str) -> DriveResult<Vec<String>> {
        Ok(self
            .db
            .query(
                "SELECT token FROM drive_respond_link WHERE itemId = ?1",
                &[Value::Text(item_id.to_owned())],
            )?
            .into_iter()
            .filter_map(|row| text(&row, "token"))
            .collect())
    }

    /// Create a sign-up link, or return the one already on this form.
    /// Only an editor or owner of a `.slform` file may do this.
    pub fn create_respond_link(&self, who: &Principal, id: &str) -> DriveResult<String> {
        self.require(who, id, Role::Editor)?;
        let row = self.item_row(id)?;
        if text(&row, "kind").as_deref() != Some("file")
            || !is_form_name(&text(&row, "name").unwrap_or_default())
        {
            return Err(DriveError::BadRequest(
                "A sign-up link is only for a form.".into(),
            ));
        }
        if let Some(token) = self.respond_tokens(id)?.into_iter().next() {
            return Ok(token);
        }
        let token = uuid::Uuid::now_v7().to_string();
        let now = iso_now();
        self.db.transact(|tx| {
            tx.upsert(
                "drive_respond_link",
                &token,
                [("itemId", Value::from(id)), ("createdAt", now.into())],
            )
        })?;
        Ok(token)
    }

    /// Turn the sign-up link off. The form, including responses already
    /// collected, stays. Only an editor or owner may do this.
    pub fn clear_respond_link(&self, who: &Principal, id: &str) -> DriveResult<()> {
        self.require(who, id, Role::Editor)?;
        let tokens = self.respond_tokens(id)?;
        if tokens.is_empty() {
            return Ok(());
        }
        self.db.transact(|tx| {
            for token in &tokens {
                tx.delete("drive_respond_link", token)?;
            }
            Ok(())
        })?;
        Ok(())
    }

    fn linked_form(&self, token: &str) -> DriveResult<(String, String, Vec<u8>)> {
        if !valid_respond_token(token) {
            return Err(DriveError::NotFound);
        }
        let link = self
            .db
            .get("drive_respond_link", token)?
            .ok_or(DriveError::NotFound)?;
        let item_id = text(&link, "itemId").ok_or(DriveError::NotFound)?;
        let row = self.item_row(&item_id)?;
        if int(&row, "trashed") != 0 {
            return Err(DriveError::NotFound);
        }
        let name = text(&row, "name").unwrap_or_default();
        if !is_form_name(&name) {
            return Err(DriveError::NotFound);
        }
        let bytes = self.head_bytes(&row)?.ok_or(DriveError::NotFound)?;
        Ok((item_id, name, bytes))
    }

    /// The title and questions for a sign-up link. No account is required.
    /// The response list is not included.
    pub fn public_form(&self, token: &str) -> DriveResult<PublicForm> {
        let (_id, name, bytes) = self.linked_form(token)?;
        let file: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| DriveError::NotFound)?;
        if let Some(kind) = file.get("kind").and_then(|value| value.as_str())
            && kind != "form"
        {
            return Err(DriveError::NotFound);
        }
        let questions = file
            .pointer("/content/questions")
            .and_then(|value| value.as_array())
            .ok_or(DriveError::NotFound)?;
        Ok(PublicForm {
            title: form_title(&file, &name),
            questions: questions.iter().filter_map(public_question).collect(),
            accepting: !form_is_closed(&bytes),
            deadline: file
                .pointer("/content/deadline")
                .and_then(serde_json::Value::as_str)
                .filter(|deadline| normalize_expiry(deadline).is_ok())
                .map(str::to_owned),
        })
    }

    /// Append one response through a sign-up link. Questions stay as they are.
    pub fn submit_public_response(
        &self,
        token: &str,
        answers: &BTreeMap<String, String>,
    ) -> DriveResult<()> {
        let (id, _name, bytes) = self.linked_form(token)?;
        if form_is_closed(&bytes) {
            return Err(DriveError::BadRequest(FORM_CLOSED.into()));
        }
        if form_deadline_passed(&bytes) {
            return Err(DriveError::BadRequest(
                "The deadline for this form has passed.".into(),
            ));
        }
        let file: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|_| DriveError::BadRequest("This form could not be read.".into()))?;
        let questions = file
            .pointer("/content/questions")
            .and_then(|value| value.as_array())
            .cloned()
            .ok_or_else(|| DriveError::BadRequest("This form could not be read.".into()))?;
        let clean = checked_answers(&questions, answers)?;
        let mut next = file;
        let responses = next
            .pointer_mut("/content/responses")
            .ok_or_else(|| DriveError::BadRequest("This form could not be read.".into()))?;
        let rows = responses
            .as_array_mut()
            .ok_or_else(|| DriveError::BadRequest("This form could not be read.".into()))?;
        if rows.len() >= 5000 {
            return Err(DriveError::BadRequest(
                "This form is not taking more responses.".into(),
            ));
        }
        let mut scored = BTreeMap::new();
        for (key, value) in &clean {
            if let Some(text) = value.as_str() {
                scored.insert(key.clone(), text.to_owned());
            }
        }
        let (score, possible) = form_score(&questions, &scored);
        let mut row = serde_json::json!({
            "id": uuid::Uuid::now_v7().to_string(),
            "at": iso_now(),
            "answers": clean,
        });
        if possible > 0 {
            row["score"] = serde_json::json!(score);
            row["possible"] = serde_json::json!(possible);
        }
        rows.push(row);
        let next_bytes = serde_json::to_vec(&next).map_err(|e| DriveError::Other(e.into()))?;
        if !appends_form_responses(&bytes, &next_bytes) {
            return Err(DriveError::BadRequest(
                "That response could not be added.".into(),
            ));
        }
        self.commit_bytes(&id, "", None, &next_bytes)
    }
}
