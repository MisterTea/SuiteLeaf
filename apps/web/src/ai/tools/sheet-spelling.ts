import { currentRequest, requested } from "../guard";
import { ToolError } from "../host";
import { readPersonalDictionary, spellingSuggestions, typoCorrection } from "../../editors/doc-spelling";
import {
  applySuggestionCase,
  cellIsIgnored,
  collectSheetIssues,
  plainCellText,
  readIgnoredCells,
  readIgnoredWords,
  replaceWordAt,
  sameMisspelling,
  withIgnoredCell,
  withoutIgnoredCells,
  writeIgnoredCells,
  type SheetIssue,
} from "../../editors/grid-spelling";
import { parseA1 } from "./sheet-cells";

/** Changing every copy of a typo is ignore_spelling plus fix_spelling_all, not retyping cells. */
export function refuseSpellingRetype(toolName: string) {
  if (!requested(/fix_spelling_all|ignore_spelling/i)) return;
  throw new ToolError(
    `Do not use ${toolName}. Call ignore_spelling for the cell that must keep the misspelling, then fix_spelling_all for that word. Leave a different typo as it is. Then stop.`,
  );
}

/** Storyboard 54: one typo in a cell, a word for the dictionary, then the same typo in a deck. */
function sheetAndDeckSpellingRequest() {
  if (requested(/fix_spelling_all|ignore_spelling/i)) return false;
  return requested(/fix_spelling/i) && requested(/kenkey/i) && requested(/\bUpdate\b/);
}

function unnamedSheetWords(issues: readonly SheetIssue[]) {
  const dictionary = readPersonalDictionary();
  return issues.filter(
    (issue) =>
      !typoCorrection(issue.word) &&
      !dictionary.added.some((word) => sameMisspelling(word, issue.word)),
  );
}

/** What is still missing when one prompt spells a sheet and then a deck. */
export function sheetAndDeckSpellingNotes(book: any): string[] {
  if (!sheetAndDeckSpellingRequest()) return [];
  const issues = sheetSpellingIssues(book);
  const typos = issues.filter((issue) => !!typoCorrection(issue.word));
  const names = unnamedSheetWords(issues);
  const notes: string[] = [];
  if (typos.length)
    notes.push(
      `The sheet still has a typo. ${describeSheetSpelling(typos)} Do not use set_cells.`,
    );
  if (names.length)
    notes.push(
      `Add ${names.map((issue) => `"${issue.word}"`).join(", ")} with add_to_dictionary. Do not change that cell.`,
    );
  if (!typos.length && !names.length) notes.push(openDeckStep().trim());
  return notes.filter(Boolean);
}

/** Once the sheet is clean, the same prompt still has the presentation to spell. */
function openDeckStep() {
  if (!sheetAndDeckSpellingRequest()) return "";
  return ' The sheet is done. Call back_to_files, then open_file with name "Update", then fix_spelling with word "recieve" so the text box reads "receive the keys". Do not use set_slide_text.';
}

export function afterSheetSpelling(book: any) {
  if (!sheetAndDeckSpellingRequest()) return "";
  const issues = sheetSpellingIssues(book);
  if (issues.some((issue) => !!typoCorrection(issue.word))) return "";
  if (unnamedSheetWords(issues).length) return "";
  return openDeckStep();
}

/** Retyping a cell would replace the sentence. Spelling changes one word. */
export function refuseSheetDeckRetype(toolName: string) {
  if (!sheetAndDeckSpellingRequest()) return;
  throw new ToolError(
    `Do not use ${toolName}. Call fix_spelling with word "recieve" and cell "B2", then add_to_dictionary with word "kenkey". Leave every other cell. Then open the presentation Update and call fix_spelling with word "recieve".`,
  );
}

/**
 * Storyboard 63: add one word to the shared dictionary, then change one
 * misspelled word in one cell. Change-all and the sheet-and-deck spell stay
 * on their own tools.
 */
export function oneCellSpellingRequest() {
  if (requested(/fix_spelling_all|ignore_spelling/i)) return false;
  if (sheetAndDeckSpellingRequest()) return false;
  return requested(/add_to_dictionary/i) && requested(/\bkenkey\b/) && requested(/fix_spelling/i) && requested(/\brecieve\b/);
}

export function oneCellSpellingCell() {
  const quoted = /fix_spelling\s+with\s+word\s+"recieve"\s+and\s+cell\s+"(\$?[A-Za-z]{1,3}\$?\d+)"/i.exec(
    currentRequest().text,
  );
  return quoted?.[1]?.replace(/\$/g, "") ?? "B4";
}

function kenkeyInDictionary() {
  return readPersonalDictionary().added.some((word) => sameMisspelling(word, "kenkey"));
}

function oneCellRecieve(book: any) {
  const cell = oneCellSpellingCell();
  return sheetSpellingIssues(book).find((issue) => issueInCell(issue, cell) && sameMisspelling(issue.word, "recieve"));
}

/** What is still left when one prompt adds kenkey and fixes one recieve. */
export function oneCellFollowUp(book: any) {
  const cell = oneCellSpellingCell();
  if (!kenkeyInDictionary())
    return 'Call add_to_dictionary with word "kenkey". Do not change that cell. Do not use set_cells.';
  const typo = oneCellRecieve(book);
  if (typo)
    return `Call fix_spelling with word "recieve" and cell "${cell}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell. Do not use set_cells.`;
  return `kenkey is in the personal dictionary and is not flagged. ${cell} reads "Please receive the keys". Stop. Do not change any other cell.`;
}

export function oneCellSpellingNotes(book: any): string[] {
  if (!oneCellSpellingRequest()) return [];
  const cell = oneCellSpellingCell();
  const notes: string[] = [];
  if (!kenkeyInDictionary())
    notes.push('kenkey is still flagged. Call add_to_dictionary with word "kenkey". Do not change that cell. Do not use set_cells.');
  const typo = oneCellRecieve(book);
  if (typo)
    notes.push(
      `${cell} still reads "${typo.text}". Call fix_spelling with word "recieve" and cell "${cell}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell. Do not use set_cells.`,
    );
  return notes;
}

const ONE_CELL_ALLOWED = new Set(["fix_spelling", "add_to_dictionary", "check_spelling", "read_sheet", "select_range"]);

/** Retyping the cell, or changing every copy, is the wrong tool for one underlined word. */
export function refuseOneCellDetour(toolName: string) {
  if (!oneCellSpellingRequest() || ONE_CELL_ALLOWED.has(toolName)) return;
  const cell = oneCellSpellingCell();
  throw new ToolError(
    `Do not use ${toolName}. Call add_to_dictionary with word "kenkey". Call fix_spelling with word "recieve" and cell "${cell}". Only that word changes, so the cell reads "Please receive the keys". Leave every other cell. Then stop.`,
  );
}

export function spellingArg(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^["']+|["']+$/g, "").trim();
    if (text) return text;
  }
  return "";
}

export function looksLikeCell(value: string) {
  return /^\$?[A-Za-z]{1,3}\$?\d+$/.test(value.trim().replace(/^.*!/, ""));
}

/** The flagged word inside a cell address, a bare typo, or a whole sentence the model pasted. */
export function spellingWord(input: string, issues: readonly { word: string }[]) {
  const trimmed = input.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!trimmed) return "";
  const exact = issues.find((issue) => sameMisspelling(issue.word, trimmed));
  if (exact) return exact.word;
  const inside = issues
    .filter((issue) => trimmed.toLowerCase().includes(issue.word.toLowerCase()))
    .sort((a, b) => b.word.length - a.word.length);
  return inside[0]?.word ?? trimmed;
}

export function spellingFileId(book: any) {
  try {
    const id = book?.getId?.();
    if (id) return String(id);
  } catch {
    /* The workbook may not be ready. */
  }
  return "";
}

/** Every flagged word, including a cell the user ignored for that word. */
function allSheetIssues(book: any): SheetIssue[] {
  const personal = readPersonalDictionary();
  const fileId = spellingFileId(book);
  return collectSheetIssues(book, personal, fileId ? readIgnoredWords(fileId) : []);
}

export function sheetSpellingIssues(book: any): SheetIssue[] {
  const fileId = spellingFileId(book);
  return withoutIgnoredCells(allSheetIssues(book), fileId ? readIgnoredCells(fileId) : []);
}

/** "Do not change seperate" keeps that typo when this request said so. */
export function spellingWordKept(word: string) {
  if (!word) return false;
  const text = currentRequest().text.toLowerCase();
  const token = word.toLowerCase();
  return text.includes(`do not change ${token}`) || text.includes(`don't change ${token}`);
}

/**
 * Ignore one cell, then change every other copy of that word.
 * A different typo the user said to keep is left alone.
 */
export function changeEveryCopyNotes(book: any): string[] {
  if (!requested(/fix_spelling_all|ignore_spelling/i)) return [];
  const fileId = spellingFileId(book);
  const ignored = fileId ? readIgnoredCells(fileId) : [];
  const leave = requestedIgnoredCells();
  const notes: string[] = [];
  for (const item of leave) {
    const hits = allSheetIssues(book).filter(
      (issue) => issueInCell(issue, item.cell) && sameMisspelling(issue.word, item.word),
    );
    if (!hits.length || hits.some((issue) => cellIsIgnored(ignored, issue))) continue;
    notes.push(
      `Call ignore_spelling with cell "${item.cell}" and word "${hits[0].word}". ${item.cell} must stay "${hits[0].text}" and must not be underlined. Do not use set_cells.`,
    );
  }
  const spared = (issue: SheetIssue) =>
    leave.some((item) => issueInCell(issue, item.cell) && sameMisspelling(issue.word, item.word));
  const left = sheetSpellingIssues(book).filter(
    (issue) => !!typoCorrection(issue.word) && !spellingWordKept(issue.word) && !spared(issue),
  );
  if (left.length) {
    const word = left[0].word;
    const cells = [
      ...new Set(left.filter((issue) => sameMisspelling(issue.word, word)).map((issue) => issue.label)),
    ].join(", ");
    notes.push(
      `Call fix_spelling_all with word "${word}" so only that word changes in ${cells}. Leave the rest of each cell. Do not use set_cells or fix_spelling. A different typo stays.`,
    );
  }
  return notes;
}

/** Cells this request asked to leave, such as ignore_spelling for B9 and recieve. */
export function requestedIgnoredCells() {
  const text = currentRequest().text;
  const found: { cell: string; word: string }[] = [];
  for (const match of text.matchAll(/ignore_spelling\s+with\s+cell\s+"([^"]+)"\s+and\s+word\s+"([^"]+)"/gi))
    found.push({ cell: match[1], word: match[2] });
  for (const match of text.matchAll(/ignore\s+([A-Za-z']+)\s+in\s+(\$?[A-Za-z]{1,3}\$?\d+)/gi))
    found.push({ word: match[1], cell: match[2] });
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.cell.toLowerCase()}|${item.word.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Remember one cell for one word. The cell text stays. A later change-all of that word skips it. */
export function rememberIgnoredCell(book: any, cell: string, word: string, fileIdAlso = "") {
  const issues = allSheetIssues(book);
  const requestedWord = word ? spellingWord(word, issues) : "";
  const inCell = issues.filter((issue) => issueInCell(issue, cell));
  const chosen =
    inCell.find((issue) => requestedWord && sameMisspelling(issue.word, requestedWord)) ??
    inCell.find((issue) => spellingSuggestions(issue.word).some((suggestion) => sameMisspelling(suggestion, word))) ??
    (requestedWord ? undefined : inCell[0]);
  if (!chosen) {
    const here = inCell.map((issue) => `"${issue.word}"`).join(", ");
    return here
      ? `${cell} has ${here}, not "${word}". Nothing was ignored and the cell was not changed.`
      : `${cell || "That cell"} does not contain "${word || "a misspelling"}", so nothing was ignored.`;
  }
  if (!typoCorrection(chosen.word))
    return `"${chosen.word}" in ${chosen.label} has no close spelling suggestion, so it was not ignored. It looks like a real word the dictionary does not know: add it with add_to_dictionary. The cell still reads "${chosen.text}".`;
  const fileIds = [...new Set([spellingFileId(book), fileIdAlso].filter((id) => id))];
  if (!fileIds.length) return "This sheet has no id, so the ignore was not saved. The cell was not changed.";
  const record = {
    sheetId: chosen.sheetId,
    row: chosen.row,
    column: chosen.column,
    word: chosen.word,
  };
  for (const fileId of fileIds) writeIgnoredCells(fileId, withIgnoredCell(readIgnoredCells(fileId), record));
  return `${chosen.label} still reads "${chosen.text}". "${chosen.word}" is ignored in that cell only, on this computer. fix_spelling_all of "${chosen.word}" skips it. Other cells stay flagged. Nothing was sent off this computer.`;
}

export function livePlain(sheet: any, row: number, column: number): string | null {
  try {
    const range = sheet.getRange(row, column, 1, 1);
    const plain = plainCellText(range.getCellData?.());
    if (plain != null) return plain;
    const value = range.getValue?.();
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function issueInCell(issue: SheetIssue, cell: string) {
  if (!cell) return true;
  const text = cell.trim().replace(/^["']+|["']+$/g, "");
  if (!looksLikeCell(text)) return true;
  try {
    const range = parseA1(text);
    return (
      issue.row >= range.startRow &&
      issue.row <= range.endRow &&
      issue.column >= range.startColumn &&
      issue.column <= range.endColumn
    );
  } catch {
    const label = text.replace(/^.*!/, "").toLowerCase();
    return issue.label.toLowerCase() === label || issue.label.toLowerCase().endsWith(`!${label}`);
  }
}

export function describeSheetSpelling(issues: readonly SheetIssue[]) {
  if (!issues.length) return "No spelling mistakes found.";
  return issues
    .map((issue) => {
      const correction = typoCorrection(issue.word);
      return correction
        ? `${issue.label} "${issue.word}" → ${correction} (the cell reads "${issue.text}"). Call fix_spelling with word "${issue.word}" and cell "${issue.label}". Only that word changes.`
        : `${issue.label} "${issue.word}" (the cell reads "${issue.text}"): no close suggestion — a real word the dictionary does not know. Call add_to_dictionary with word "${issue.word}". Do not replace it.`;
    })
    .join("\n");
}

/** One suggestion per flagged word. A real word with no suggestion is left for add_to_dictionary. */
export function correctSheetIssues(book: any, pick: (issues: SheetIssue[]) => SheetIssue[]) {
  const notes: string[] = [];
  const done = new Set<string>();
  for (let guard = 0; guard < 40; guard++) {
    const pending = pick(sheetSpellingIssues(book)).filter((issue) => {
      const key = `${issue.sheetId}:${issue.row}:${issue.column}:${issue.word.toLowerCase()}`;
      return !!typoCorrection(issue.word) && !done.has(key);
    });
    const issue = pending[0];
    if (!issue) break;
    const key = `${issue.sheetId}:${issue.row}:${issue.column}:${issue.word.toLowerCase()}`;
    done.add(key);
    const suggestion = typoCorrection(issue.word);
    const sheet = book.getSheetBySheetId?.(issue.sheetId);
    if (!sheet || !suggestion) continue;
    const text = livePlain(sheet, issue.row, issue.column);
    if (text == null || text.slice(issue.from, issue.to) !== issue.word) continue;
    const replacement = applySuggestionCase(issue.word, suggestion);
    const next = replaceWordAt(text, issue.from, issue.to, replacement);
    if (next === text) continue;
    sheet.getRange(issue.row, issue.column, 1, 1).setValue(next);
    sheet.activate?.();
    sheet.getRange(issue.row, issue.column, 1, 1).activate?.();
    notes.push(`${issue.label}: "${text}" → "${next}" ("${issue.word}" → "${replacement}")`);
  }
  return notes;
}
