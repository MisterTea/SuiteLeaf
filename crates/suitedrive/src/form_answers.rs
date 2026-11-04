//! Checking one response against the form's questions before it is stored.

use std::collections::BTreeMap;

use crate::{DriveError, DriveResult};

fn question_prompt(question: &serde_json::Value) -> &str {
    question
        .get("prompt")
        .and_then(|value| value.as_str())
        .filter(|prompt| !prompt.is_empty())
        .unwrap_or("This question")
}

pub(crate) fn question_labels(question: &serde_json::Value, key: &str) -> Vec<String> {
    question
        .get(key)
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// One column for each named row. Returns None when the value is not that grid.
fn accepted_grid(
    rows: &[String],
    columns: &[String],
    value: &str,
) -> Option<BTreeMap<String, String>> {
    let parsed: serde_json::Value = serde_json::from_str(value).ok()?;
    let object = parsed.as_object()?;
    let mut chosen = BTreeMap::new();
    for (row, column) in object {
        let column = column.as_str()?.trim();
        let row = row.trim();
        if row.is_empty() || column.is_empty() {
            return None;
        }
        if !rows.iter().any(|item| item == row) || !columns.iter().any(|item| item == column) {
            return None;
        }
        chosen.insert(row.to_owned(), column.to_owned());
    }
    Some(chosen)
}

fn grid_answer(
    prompt: &str,
    required: bool,
    question: &serde_json::Value,
    value: &str,
) -> DriveResult<Option<String>> {
    let rows = question_labels(question, "rows");
    let columns = question_labels(question, "columns");
    if value.is_empty() {
        if required {
            return Err(DriveError::BadRequest(format!("{prompt} is required")));
        }
        return Ok(None);
    }
    let Some(chosen) = accepted_grid(&rows, &columns, value) else {
        return Err(DriveError::BadRequest(format!(
            "{prompt} must be one of the columns"
        )));
    };
    if required && rows.iter().any(|row| !chosen.contains_key(row)) {
        return Err(DriveError::BadRequest(format!("{prompt} is required")));
    }
    if chosen.is_empty() {
        return Ok(None);
    }
    if grid_cells_too_long(&chosen) {
        return Err(DriveError::BadRequest(format!("{prompt} is too long")));
    }
    let mut clean = serde_json::Map::new();
    for row in &rows {
        if let Some(column) = chosen.get(row) {
            clean.insert(row.clone(), serde_json::Value::String(column.clone()));
        }
    }
    Ok(Some(serde_json::Value::Object(clean).to_string()))
}

pub(crate) fn new_answers_match_questions(previous: &[u8], next: &[u8]) -> DriveResult<()> {
    let previous: serde_json::Value = serde_json::from_slice(previous)
        .map_err(|_| DriveError::BadRequest("This form could not be read.".into()))?;
    let next: serde_json::Value = serde_json::from_slice(next)
        .map_err(|_| DriveError::BadRequest("This form could not be read.".into()))?;
    let questions = previous
        .pointer("/content/questions")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let previous_len = previous
        .pointer("/content/responses")
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let Some(rows) = next
        .pointer("/content/responses")
        .and_then(serde_json::Value::as_array)
    else {
        return Ok(());
    };
    for row in rows.iter().skip(previous_len) {
        let mut answers = BTreeMap::new();
        if let Some(object) = row.get("answers").and_then(serde_json::Value::as_object) {
            for (key, value) in object {
                let Some(text) = value.as_str() else {
                    return Err(DriveError::BadRequest(
                        "This form could not be read.".into(),
                    ));
                };
                answers.insert(key.clone(), text.to_owned());
            }
        }
        checked_answers(&questions, &answers)?;
    }
    Ok(())
}

/// Text, choice, and rating answers. A grid is JSON around those labels, so
/// it is not held to this.
const ANSWER_CHARS: usize = 2_000;

/// A form label is at most 80 characters. Twenty labels, each answered with
/// an 80-character column, are 3_200 characters of cells.
const GRID_CELL_CHARS: usize = 20 * 80 * 2;

/// JSON quotes and escaping around that grid. Anything larger is rejected
/// before it is parsed.
const GRID_ENVELOPE_CHARS: usize = 32_768;

fn grid_cells_too_long(chosen: &BTreeMap<String, String>) -> bool {
    let cells = chosen.iter().fold(0usize, |sum, (row, column)| {
        sum.saturating_add(row.chars().count())
            .saturating_add(column.chars().count())
    });
    cells > GRID_CELL_CHARS
}

enum FileRefusal {
    Type,
    Size,
}

fn file_name_is_blocked(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("secret")
        || lower.contains("password")
        || lower.contains("token")
        || lower.contains("api_key")
        || lower.contains("api-key")
}

fn plain_number(text: &str) -> bool {
    let mut chars = text.chars();
    if chars.as_str().starts_with('-') {
        chars.next();
    }
    let rest = chars.as_str();
    if rest.is_empty() {
        return false;
    }
    let mut saw_digit = false;
    let mut saw_dot = false;
    for ch in rest.chars() {
        if ch.is_ascii_digit() {
            saw_digit = true;
            continue;
        }
        if ch == '.' && !saw_dot && saw_digit {
            saw_dot = true;
            continue;
        }
        return false;
    }
    saw_digit && (!saw_dot || text.ends_with(|ch: char| ch.is_ascii_digit()))
}

fn number_answer(value: &str, question: &serde_json::Value) -> Result<String, &'static str> {
    let text = value.trim();
    if !plain_number(text) {
        return Err("Enter a number.");
    }
    let number: f64 = text.parse().map_err(|_| "Enter a number.")?;
    if !number.is_finite() {
        return Err("Enter a number.");
    }
    let bound = |key: &str| {
        question
            .get(key)
            .and_then(|value| value.as_f64())
            .filter(|number| number.is_finite())
    };
    let low = bound("min");
    let high = bound("max");
    if let (Some(low), Some(high)) = (low, high)
        && low > high
    {
        return Err("That number range is not valid.");
    }
    if low.is_some_and(|low| number < low) || high.is_some_and(|high| number > high) {
        return Err("That number is outside the range.");
    }
    Ok(text.to_owned())
}

fn file_answer(value: &str) -> Result<String, FileRefusal> {
    let Some((name, size_text)) = value.rsplit_once('|') else {
        return Err(FileRefusal::Type);
    };
    let name = name.trim();
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    let allowed = matches!(
        extension.as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "pdf" | "txt")
    );
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('\0')
        || file_name_is_blocked(name)
        || !allowed
    {
        return Err(FileRefusal::Type);
    }
    let Ok(size) = size_text.trim().parse::<u64>() else {
        return Err(FileRefusal::Size);
    };
    if !(1..=5_000_000).contains(&size) {
        return Err(FileRefusal::Size);
    }
    Ok(format!("{name} ({size} bytes)"))
}

/// Keep answers that satisfy the questions. A required text, choice, rating,
/// or grid must be present. A choice must be one of that question's choices.
/// A rating must be 1, 2, 3, 4, or 5. A grid picks one of that question's
/// columns for each row, and a required grid needs every row.
pub(crate) fn checked_answers(
    questions: &[serde_json::Value],
    answers: &BTreeMap<String, String>,
) -> DriveResult<serde_json::Map<String, serde_json::Value>> {
    let visible = visible_question_ids(questions, answers);
    let mut clean = serde_json::Map::new();
    for question in questions {
        let Some(id) = question
            .get("id")
            .and_then(|value| value.as_str())
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if !visible.contains(id) {
            continue;
        }
        let prompt = question_prompt(question);
        let required = question
            .get("required")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let kind = question
            .get("kind")
            .and_then(|value| value.as_str())
            .unwrap_or("text");
        let value = answers.get(id).map(|answer| answer.trim()).unwrap_or("");
        if kind == "grid" {
            if value.chars().count() > GRID_ENVELOPE_CHARS {
                return Err(DriveError::BadRequest(format!("{prompt} is too long")));
            }
            if let Some(stored) = grid_answer(prompt, required, question, value)? {
                clean.insert(id.to_owned(), serde_json::Value::String(stored));
            }
            continue;
        }
        if value.chars().count() > ANSWER_CHARS {
            return Err(DriveError::BadRequest(format!("{prompt} is too long")));
        }
        if required && value.is_empty() {
            return Err(DriveError::BadRequest(format!("{prompt} is required")));
        }
        if kind == "choice" && !value.is_empty() {
            let allowed = question
                .get("choices")
                .and_then(|choices| choices.as_array())
                .is_some_and(|choices| {
                    choices
                        .iter()
                        .any(|choice| choice.as_str().is_some_and(|text| text.trim() == value))
                });
            if !allowed {
                return Err(DriveError::BadRequest(format!(
                    "{prompt} must be one of the choices"
                )));
            }
        }
        if kind == "number" && !value.is_empty() {
            let stored = match number_answer(value, question) {
                Ok(stored) => stored,
                Err(message) => return Err(DriveError::BadRequest(message.into())),
            };
            clean.insert(id.to_owned(), serde_json::Value::String(stored));
            continue;
        }
        if kind == "file" && !value.is_empty() {
            let stored = match file_answer(value) {
                Ok(stored) => stored,
                Err(FileRefusal::Type) => {
                    return Err(DriveError::BadRequest(
                        "That file is not an allowed upload.".into(),
                    ));
                }
                Err(FileRefusal::Size) => {
                    return Err(DriveError::BadRequest("That file is too large.".into()));
                }
            };
            clean.insert(id.to_owned(), serde_json::Value::String(stored));
            continue;
        }
        if kind == "rating" && !value.is_empty() && !matches!(value, "1" | "2" | "3" | "4" | "5") {
            return Err(DriveError::BadRequest(format!(
                "{prompt} must be a rating from 1 to 5"
            )));
        }
        if !value.is_empty() {
            clean.insert(id.to_owned(), serde_json::Value::String(value.to_owned()));
        }
    }
    Ok(clean)
}

pub(crate) fn form_score(
    questions: &[serde_json::Value],
    answers: &BTreeMap<String, String>,
) -> (i64, i64) {
    let visible = visible_question_ids(questions, answers);
    let mut score = 0i64;
    let mut possible = 0i64;
    for question in questions {
        let Some(id) = question
            .get("id")
            .and_then(|value| value.as_str())
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if !visible.contains(id) {
            continue;
        }
        let Some(points) = question.get("points").and_then(|value| value.as_i64()) else {
            continue;
        };
        if !(1..=1000).contains(&points) {
            continue;
        }
        possible += points;
        let expected = question
            .get("answer")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim();
        let given = answers.get(id).map(|value| value.trim()).unwrap_or("");
        if !expected.is_empty() && given == expected {
            score += points;
        }
    }
    (score, possible)
}

fn visible_question_ids(
    questions: &[serde_json::Value],
    answers: &BTreeMap<String, String>,
) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::new();
    let mut index = 0usize;
    let mut seen = std::collections::HashSet::new();
    while index < questions.len() {
        if !seen.insert(index) {
            break;
        }
        let question = &questions[index];
        let Some(id) = question
            .get("id")
            .and_then(|value| value.as_str())
            .filter(|id| !id.is_empty())
        else {
            index += 1;
            continue;
        };
        ids.insert(id.to_owned());
        let answer = answers.get(id).map(|value| value.trim()).unwrap_or("");
        let next = question
            .get("branches")
            .and_then(|value| value.as_array())
            .and_then(|branches| {
                branches.iter().find_map(|branch| {
                    let when = branch.get("when").and_then(|value| value.as_str())?.trim();
                    if when != answer {
                        return None;
                    }
                    let next = branch.get("next").and_then(|value| value.as_str())?;
                    questions.iter().position(|item| {
                        item.get("id").and_then(|value| value.as_str()) == Some(next)
                    })
                })
            });
        index = match next {
            Some(next) if next > index => next,
            _ => index + 1,
        };
    }
    ids
}
