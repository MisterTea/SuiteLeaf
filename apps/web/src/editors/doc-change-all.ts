import type { Mark, Node as ProseNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import {
  misspelledRanges,
  sameWord,
  SPELLING_IGNORE_MARK,
  type PersonalDictionary,
  type SpellingRange,
} from "./doc-spelling";

/** Keep a capital the writer already typed: "Recieve" → "Receive". */
export function suggestionCase(source: string, replacement: string) {
  const cleaned = replacement.trim();
  if (!cleaned) return cleaned;
  const letters = [...source].filter((char) => /[A-Za-z]/.test(char)).join("");
  if (letters && letters === letters.toUpperCase()) return cleaned.toUpperCase();
  const first = source[0] ?? "";
  if (first !== first.toLowerCase() && cleaned[0] === cleaned[0].toLowerCase())
    return cleaned[0].toUpperCase() + cleaned.slice(1);
  return cleaned;
}

/** Every still-underlined copy of this misspelling. Ignored copies are already omitted. */
export function copiesOf(
  doc: ProseNode,
  word: string,
  personal: PersonalDictionary,
  ignored: readonly string[],
) {
  return misspelledRanges(doc, personal, ignored).filter((range) => sameWord(range.word, word));
}

export type CopyPreview = SpellingRange & {
  before: string;
  after: string;
  replacement: string;
};

function clipBefore(value: string, atStart: boolean) {
  if (atStart) return value.replace(/^\s+/, "");
  const trimmed = value.replace(/^\s+/, "");
  const at = trimmed.lastIndexOf(" ");
  const tail = (at >= 0 ? trimmed.slice(at + 1) : trimmed).trimEnd();
  return tail ? `…${tail}` : "";
}

function clipAfter(value: string, atEnd: boolean) {
  if (atEnd) return value.replace(/\s+$/, "");
  const trimmed = value.replace(/\s+$/, "");
  const at = trimmed.indexOf(" ");
  const head = (at >= 0 ? trimmed.slice(0, at) : trimmed).trimStart();
  return head ? `${head}…` : "";
}

export function previewCopies(doc: ProseNode, ranges: readonly SpellingRange[], replacement: string) {
  const radius = 42;
  return ranges.map((range): CopyPreview => {
    const $pos = doc.resolve(range.from);
    const text = $pos.parent.textContent;
    const offset = range.from - $pos.start();
    const start = Math.max(0, offset - radius);
    const end = Math.min(text.length, offset + range.word.length + radius);
    return {
      ...range,
      before: clipBefore(text.slice(start, offset), start === 0),
      after: clipAfter(text.slice(offset + range.word.length, end), end === text.length),
      replacement: suggestionCase(range.word, replacement),
    };
  });
}

function keptMarks(state: EditorState, from: number, to: number): Mark[] {
  const marks =
    state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? state.doc.resolve(from).marks();
  return marks.filter((mark) => mark.type.name !== SPELLING_IGNORE_MARK);
}

/** One transaction, so Undo restores every copy this pass edited. */
export function changeAllTransaction(
  state: EditorState,
  ranges: readonly SpellingRange[],
  replacement: string,
): Transaction {
  let tr = state.tr;
  const ordered = [...ranges].sort((a, b) => a.from - b.from);
  for (const range of [...ordered].reverse()) {
    const text = suggestionCase(range.word, replacement);
    if (!text) continue;
    if (state.doc.textBetween(range.from, range.to) !== range.word) continue;
    tr = tr.replaceWith(range.from, range.to, state.schema.text(text, keptMarks(state, range.from, range.to)));
  }
  const first = ordered.find((range) => suggestionCase(range.word, replacement));
  if (first) {
    const at = tr.mapping.map(first.from);
    const text = suggestionCase(first.word, replacement);
    const pos = Math.min(at + text.length, tr.doc.content.size);
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos))).scrollIntoView();
  }
  return tr;
}

export function ignoreOccurrence(state: EditorState, from: number, to: number): Transaction {
  const type = state.schema.marks[SPELLING_IGNORE_MARK];
  if (!type) return state.tr;
  return state.tr.addMark(from, to, type.create());
}

export function checkOccurrence(state: EditorState, from: number, to: number): Transaction {
  const type = state.schema.marks[SPELLING_IGNORE_MARK];
  if (!type) return state.tr;
  return state.tr.removeMark(from, to, type);
}
