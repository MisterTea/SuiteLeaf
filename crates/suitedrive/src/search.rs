//! Search by file name or by the text inside a SuiteLeaf file.

use serde::Serialize;

use crate::{
    Drive, DriveResult, MAX_DEPTH, Principal, Role,
    row::{int, text},
};

/// One file found by [`Drive::search`]. The file's bytes are not included.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub name: String,
    /// The parent folder's name, or "My Drive" when the file is at the top.
    pub parent_name: String,
    /// About 80 characters of the name or file text, with the match in it.
    pub snippet: String,
}

/// One `.slsheet` the caller can read. The file's bytes are not included.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetHit {
    pub id: String,
    pub name: String,
    /// The parent folder's name, or "My Drive" when the file is at the top.
    pub parent_name: String,
}

const SEARCH_HITS: usize = 20;

const SNIPPET_CHARS: usize = 80;

const SEARCH_TEXT_LIMIT: usize = 200_000;

struct Words {
    text: String,
    len: usize,
}

impl Words {
    fn new() -> Self {
        Self {
            text: String::new(),
            len: 0,
        }
    }

    fn full(&self) -> bool {
        self.len >= SEARCH_TEXT_LIMIT
    }

    fn push(&mut self, raw: &str) {
        if self.full() {
            return;
        }
        let mut spaced = !self.text.is_empty();
        for ch in raw.chars() {
            if self.full() {
                break;
            }
            if ch.is_whitespace() {
                spaced = true;
                continue;
            }
            if spaced {
                self.text.push(' ');
                self.len += 1;
                spaced = false;
                if self.full() {
                    break;
                }
            }
            self.text.push(ch);
            self.len += 1;
        }
    }
}

fn collect_doc(node: &serde_json::Value, words: &mut Words, depth: usize) {
    if depth > MAX_DEPTH || words.full() {
        return;
    }
    if node.get("type").and_then(|value| value.as_str()) == Some("hardBreak") {
        words.push(" ");
    }
    if let Some(text) = node.get("text").and_then(|value| value.as_str()) {
        words.push(text);
    }
    if let Some(children) = node.get("content").and_then(|value| value.as_array()) {
        for child in children {
            collect_doc(child, words, depth + 1);
        }
    }
}

fn cell_display(cell: &serde_json::Value) -> Option<String> {
    match cell.get("v") {
        Some(serde_json::Value::String(text)) if !text.is_empty() => return Some(text.clone()),
        Some(serde_json::Value::Number(number)) => return Some(number.to_string()),
        Some(serde_json::Value::Bool(value)) => {
            return Some(if *value { "true" } else { "false" }.into());
        }
        _ => {}
    }
    cell.pointer("/p/body/dataStream")
        .and_then(|value| value.as_str())
        .map(|text| text.trim_end_matches(['\r', '\n']).to_owned())
        .filter(|text| !text.is_empty())
}

fn collect_sheet(file: &serde_json::Value, words: &mut Words) {
    let Some(sheets) = file
        .pointer("/content/workbook/sheets")
        .and_then(|value| value.as_object())
    else {
        return;
    };
    for sheet in sheets.values() {
        let Some(rows) = sheet.get("cellData").and_then(|value| value.as_object()) else {
            continue;
        };
        for row in rows.values() {
            let Some(cells) = row.as_object() else {
                continue;
            };
            for cell in cells.values() {
                if let Some(text) = cell_display(cell) {
                    words.push(&text);
                }
                if words.full() {
                    return;
                }
            }
        }
    }
}

fn collect_slides(file: &serde_json::Value, words: &mut Words) {
    let Some(slides) = file
        .pointer("/content/slides")
        .and_then(|value| value.as_object())
    else {
        return;
    };
    for slide in slides.values() {
        if let Some(elements) = slide.get("elements").and_then(|value| value.as_array()) {
            for element in elements {
                if let Some(content) = element.get("content").and_then(|value| value.as_str()) {
                    words.push(content);
                }
                if let Some(rows) = element.get("rows").and_then(|value| value.as_array()) {
                    for row in rows {
                        let Some(cells) = row.as_array() else {
                            continue;
                        };
                        for cell in cells {
                            if let Some(text) = cell.as_str() {
                                words.push(text);
                            }
                        }
                    }
                }
            }
        }
        if let Some(notes) = slide.get("notes").and_then(|value| value.as_str()) {
            words.push(notes);
        }
        if words.full() {
            return;
        }
    }
}

fn collect_form(file: &serde_json::Value, words: &mut Words, answers: bool) {
    if let Some(questions) = file
        .pointer("/content/questions")
        .and_then(|value| value.as_array())
    {
        for question in questions {
            if let Some(prompt) = question.get("prompt").and_then(|value| value.as_str()) {
                words.push(prompt);
            }
            if let Some(choices) = question.get("choices").and_then(|value| value.as_array()) {
                for choice in choices {
                    if let Some(text) = choice.as_str() {
                        words.push(text);
                    }
                }
            }
        }
    }
    if answers
        && let Some(responses) = file
            .pointer("/content/responses")
            .and_then(|value| value.as_array())
    {
        for response in responses {
            let Some(answers) = response.get("answers").and_then(|value| value.as_object()) else {
                continue;
            };
            for answer in answers.values() {
                if let Some(text) = answer.as_str() {
                    words.push(text);
                }
            }
        }
    }
}

fn doc_text(node: &serde_json::Value) -> String {
    let mut words = Words::new();
    collect_doc(node, &mut words, 0);
    words.text
}

fn named_piece(name: &str, text: &str) -> String {
    if text.is_empty() {
        format!("{name}:")
    } else {
        format!("{name}: {text}")
    }
}

fn first_tab_name(file: &serde_json::Value) -> String {
    file.get("tabTitle")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Document")
        .to_owned()
}

/// One string per tab. A document with no extra tabs is just `content`.
/// With extra tabs, every piece is `Name: text`, including the first tab.
fn doc_pieces(file: &serde_json::Value) -> Vec<String> {
    let Some(content) = file.get("content") else {
        return Vec::new();
    };
    let tabs = file
        .get("tabs")
        .and_then(|value| value.as_array())
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let body = doc_text(content);
    if tabs.is_empty() {
        return vec![body];
    }
    let mut pieces = Vec::with_capacity(tabs.len() + 1);
    pieces.push(named_piece(&first_tab_name(file), &body));
    for (index, tab) in tabs.iter().enumerate() {
        let name = tab
            .get("title")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Tab {}", index + 2));
        let text = tab.get("content").map(doc_text).unwrap_or_default();
        pieces.push(named_piece(&name, &text));
    }
    pieces
}

/// Keep the tab name at the front when the hit sits far enough into the tab
/// that the usual window would start mid-sentence.
fn tab_window(piece: &str, query: &str) -> String {
    let window = snippet_around(piece, query);
    let Some(name) = piece.split(':').next() else {
        return window;
    };
    let prefix = format!("{name}:");
    if window.starts_with(&prefix) {
        return window;
    }
    let head = format!("{name}: ");
    let room = SNIPPET_CHARS.saturating_sub(head.chars().count());
    let rest: String = window.trim().chars().take(room).collect();
    head.chars()
        .chain(rest.chars())
        .take(SNIPPET_CHARS)
        .collect()
}

fn snippet_for_file(bytes: &[u8], query: &str, form_answers: bool) -> String {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return String::new();
    };
    if value.get("kind").and_then(|kind| kind.as_str()) == Some("doc") {
        let pieces = doc_pieces(&value);
        if pieces.len() > 1 {
            for piece in &pieces {
                if find_ci(piece, query).is_some() {
                    return tab_window(piece, query);
                }
            }
        }
    }
    snippet_around(&file_words_for(bytes, form_answers), query)
}

/// Paragraph and heading text, cell display values, slide text and notes, and
/// form prompts, choices, and answers. A document contributes every tab.
/// Anything else contributes nothing.
fn file_words_for(bytes: &[u8], form_answers: bool) -> String {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return String::new();
    };
    let mut words = Words::new();
    match value.get("kind").and_then(|kind| kind.as_str()) {
        Some("doc") => {
            for piece in doc_pieces(&value) {
                words.push(&piece);
            }
        }
        Some("sheet") => collect_sheet(&value, &mut words),
        Some("slide") => collect_slides(&value, &mut words),
        Some("form") => collect_form(&value, &mut words, form_answers),
        _ => {}
    }
    words.text
}

/// Byte range of `needle` in `haystack`, ignoring case. Empty needles never match.
fn find_ci(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    let needle = needle.to_lowercase();
    if needle.is_empty() || haystack.is_empty() {
        return None;
    }
    let mut lower = String::new();
    let mut map = Vec::new();
    for (idx, ch) in haystack.char_indices() {
        for low in ch.to_lowercase() {
            let mut buf = [0; 4];
            let encoded = low.encode_utf8(&mut buf);
            for _ in 0..encoded.len() {
                map.push(idx);
            }
            lower.push(low);
        }
    }
    let at = lower.find(&needle)?;
    let start = *map.get(at)?;
    let last = *map.get(at + needle.len() - 1)?;
    let end = haystack[last..]
        .chars()
        .next()
        .map(|ch| last + ch.len_utf8())
        .unwrap_or(haystack.len());
    Some((start, end))
}

fn snippet_around(text: &str, query: &str) -> String {
    let Some((start, end)) = find_ci(text, query) else {
        return text.chars().take(SNIPPET_CHARS).collect();
    };
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    if chars.len() <= SNIPPET_CHARS {
        return text.to_owned();
    }
    let match_from = chars.iter().position(|(i, _)| *i >= start).unwrap_or(0);
    let match_to = chars
        .iter()
        .position(|(i, _)| *i >= end)
        .unwrap_or(chars.len());
    let match_len = match_to.saturating_sub(match_from);
    if match_len >= SNIPPET_CHARS {
        return chars[match_from..match_from + SNIPPET_CHARS]
            .iter()
            .map(|(_, ch)| *ch)
            .collect();
    }
    let extra = SNIPPET_CHARS - match_len;
    let mut from = match_from.saturating_sub(extra / 3);
    let mut to = (match_to + (extra - (match_from - from))).min(chars.len());
    if to - from < SNIPPET_CHARS {
        from = from.saturating_sub(SNIPPET_CHARS - (to - from));
    }
    to = (from + SNIPPET_CHARS).min(chars.len());
    if from > 0
        && from < match_from
        && let Some(space) = chars[from..match_from]
            .iter()
            .position(|(_, ch)| ch.is_whitespace())
    {
        let next = from + space + 1;
        if next <= match_from {
            from = next;
        }
    }
    let snippet: String = chars[from..to].iter().map(|(_, ch)| *ch).collect();
    let trimmed = snippet.trim();
    if trimmed.chars().count() <= SNIPPET_CHARS {
        trimmed.to_owned()
    } else {
        trimmed.chars().take(SNIPPET_CHARS).collect()
    }
}

impl Drive {
    /// Files the caller can read whose name or text contains `query`.
    ///
    /// The match is a case-insensitive substring of the file name or of the
    /// text inside a native SuiteLeaf file. Folders are not hits. Trashed
    /// files, and files inside a trashed folder, are skipped. At most 20 hits
    /// come back, each with the parent folder name (or "My Drive") and a short
    /// snippet. The response does not include file bytes.
    pub fn search(&self, who: &Principal, query: &str) -> DriveResult<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE kind = 'file' AND trashed = 0 ORDER BY name COLLATE NOCASE",
            &[],
        )?;
        let mut hits = Vec::new();
        for row in rows {
            if hits.len() == SEARCH_HITS {
                break;
            }
            let id = text(&row, "id").unwrap_or_default();
            let Some(role) = self.role(who, &id)? else {
                continue;
            };
            let form_answers = role != Role::Responder;
            let parent_id = text(&row, "parentId");
            if self.hidden_by_trash(parent_id.as_deref())? {
                continue;
            }
            let name = text(&row, "name").unwrap_or_default();
            let bytes = self.head_bytes(&row)?;
            let body = match &bytes {
                Some(raw) => file_words_for(raw, form_answers),
                None => String::new(),
            };
            let in_body = find_ci(&body, query).is_some();
            if !in_body && find_ci(&name, query).is_none() {
                continue;
            }
            let snippet = if in_body {
                match &bytes {
                    Some(raw) => snippet_for_file(raw, query, form_answers),
                    None => String::new(),
                }
            } else {
                snippet_around(&name, query)
            };
            let parent_name = self.folder_name(parent_id.as_deref())?;
            hits.push(SearchHit {
                id,
                name,
                parent_name,
                snippet,
            });
        }
        Ok(hits)
    }

    /// Spreadsheets the caller can read, including files inside folders and
    /// files they have never opened. A folder listing only sees one folder,
    /// so this walks every readable `.slsheet` instead. Trashed files, and
    /// files inside a trashed folder, are left out. Each hit is the file id,
    /// name, and parent folder name. The response does not include file bytes.
    pub fn list_spreadsheets(&self, who: &Principal) -> DriveResult<Vec<SpreadsheetHit>> {
        let rows = self.db.query(
            "SELECT * FROM drive_item WHERE kind = 'file' AND trashed = 0 ORDER BY name COLLATE NOCASE",
            &[],
        )?;
        let mut hits = Vec::new();
        for row in rows {
            let name = text(&row, "name").unwrap_or_default();
            if !name.to_ascii_lowercase().ends_with(".slsheet") {
                continue;
            }
            let id = text(&row, "id").unwrap_or_default();
            if self.role(who, &id)?.is_none() {
                continue;
            }
            let parent_id = text(&row, "parentId");
            if self.hidden_by_trash(parent_id.as_deref())? {
                continue;
            }
            hits.push(SpreadsheetHit {
                id,
                name,
                parent_name: self.folder_name(parent_id.as_deref())?,
            });
        }
        Ok(hits)
    }

    /// The parent folder's name, or "My Drive" when the file is at the top.
    fn folder_name(&self, parent_id: Option<&str>) -> DriveResult<String> {
        Ok(match parent_id {
            Some(parent) => self
                .db
                .get("drive_item", parent)?
                .as_ref()
                .and_then(|folder| text(folder, "name"))
                .filter(|folder| !folder.is_empty())
                .unwrap_or_else(|| "My Drive".into()),
            None => "My Drive".into(),
        })
    }

    /// True when an ancestor folder is in Trash. The file itself is filtered
    /// by the search query; trashing a folder does not mark its children.
    fn hidden_by_trash(&self, parent_id: Option<&str>) -> DriveResult<bool> {
        let mut current = parent_id.map(str::to_owned);
        for _ in 0..MAX_DEPTH {
            let Some(id) = current else {
                return Ok(false);
            };
            let Some(row) = self.db.get("drive_item", &id)? else {
                return Ok(false);
            };
            if int(&row, "trashed") != 0 {
                return Ok(true);
            }
            current = text(&row, "parentId");
        }
        Ok(false)
    }
}
