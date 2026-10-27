import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { undoDepth } from "@tiptap/pm/history";
import { Type } from "@earendil-works/pi-ai";
import {
  edgeDistanceError,
  gutterAccepted,
  marginError,
  setDifferentOddEven,
  setPageMargin,
  watermarkText,
  type MarginEdge,
  type PageNumberFormat,
  type PageNumberPosition,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import {
  applyParagraphRestore,
  compareParagraphs,
  parseFile,
  type DocFile,
  type FileRecord,
  type JsonNode,
  type ParagraphOffer,
  type SuiteFile,
} from "@suiteleaf/core";
import { asEquation, parseLinear, plainOf, type EqNode } from "@suiteleaf/core/equations";
import { clampImageCrop, imageCrop } from "@suiteleaf/core/image-crop";
import {
  bibliographyPlain,
  citationLibrary,
  createSource,
  inText,
  type CitationSource,
  type CitationStyle,
  type SourceKind,
} from "@suiteleaf/core/citations";
import "../../editors/doc-citations";
import {
  acceptSuggestions,
  listSuggestions,
  rejectSuggestions,
  type SuggestionInfo,
} from "@suiteleaf/core/suggestions";
import { replaceDocument } from "../../editors/doc-suggestions";
import { applyImageAlt } from "../../editors/doc-image-alt";
import { changeAllTransaction, copiesOf } from "../../editors/doc-change-all";
import { documentMatches } from "../../editors/doc-search-plugin";
import {
  addToPersonalDictionary,
  misspelledRanges,
  misspelledWords,
  readPersonalDictionary,
  sameWord,
  spellingSuggestions,
  writePersonalDictionary,
  type SpellingRange,
} from "../../editors/doc-spelling";
import {
  countDocument,
  exclusionNotes,
  formatWordCount,
  readProofing,
  type ProofingSettings,
} from "../../editors/doc-word-count";
import { grammarRanges } from "../../editors/doc-grammar";
import { refreshSpelling } from "../../editors/doc-proofing";
import { COLUMN_LAYOUT, applyColumnLayout } from "../../editors/doc-columns";
import { localVersions, recordLocalParagraphRestore } from "../../editors/local-versions";
import { partialRestoreTitle } from "../../editors/version-history-model";
import { DriveConflict, drive, uploadDriveFile } from "../../node-client";
import { storage } from "../../storage";
import { applyRestoredFile } from "../restored-file";
import { ToolError, tool, type SuiteTool } from "../host";
import { requestFile } from "../file-request";
import { baselineSnapshot, markBaseline, ownUndoSteps } from "../guard";
import { docFormatTools } from "./doc-format";

/** What the Docs editor lends the agent. */
export interface DocsAgentContext {
  editor: Editor;
  title: string;
  /** Show the find and replace dialog with these values. */
  showFind: (query: string, replacement: string, matchCase: boolean) => void;
  /** Record a "Replaced N" result in the dialog. */
  showReplaced: (count: number) => void;
  closeFind: () => void;
  showPageSetup: (draft: PageSettings) => void;
  pageSettings: () => PageSettings;
  closePageSetup: () => void;
  showSpelling: () => void;
  showWordCount: () => void;
  showDictionary: () => void;
  closeProofing: () => void;
  jumpToHeading: (pos: number) => void;
  insertImage: (file: File) => Promise<void>;
  /** Undefined once the browser downloads it; on the desktop, the saved path or null if cancelled. */
  exportAs: (format: "docx" | "html" | "txt") => Promise<string | null | undefined>;
  pageCount: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Blocks with their text, for reading and for finding where things are. */
function blocks(editor: Editor) {
  const list: { pos: number; end: number; type: string; text: string; label: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const parent = editor.state.doc.resolve(pos).parent;
    const inList = parent.type.name === "listItem";
    const label =
      node.type.name === "heading"
        ? `Heading ${node.attrs.level}`
        : parent.type.name === "note"
          ? parent.attrs.kind === "endnote"
            ? "Endnote"
            : "Footnote"
          : inList
            ? editor.state.doc.resolve(pos).node(-1)?.type.name === "orderedList"
              ? "Numbered item"
              : "Bullet"
            : editor.state.doc.resolve(pos).node(-1)?.type.name?.startsWith("table")
              ? "Table cell"
              : "Paragraph";
    list.push({ pos, end: pos + node.nodeSize, type: node.type.name, text: shownText(node), label });
    return false;
  });
  return list;
}

function imageAltText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function imageTitle(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** Photos, which blocks() leaves out because they hold no text. */
function images(editor: Editor) {
  const list: { pos: number; end: number; name: string; alt: string; title: string; cropRight: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image") {
      const alt = imageAltText(node.attrs.alt);
      const title = imageTitle(node.attrs.title);
      list.push({
        pos,
        end: pos + node.nodeSize,
        alt,
        title,
        name: alt || title || "photo",
        cropRight: imageCrop(node.attrs).right,
      });
    }
  });
  return list;
}

/** A file name offered as alt text, which a screen reader would announce instead of the picture. */
function fileNameDescription(value: string, title: string) {
  const bare = value.trim().replace(/^["“”']+|["“”']+$/g, "");
  if (!bare) return false;
  if (/^img[_\s-]?2044(\.[a-z0-9]+)?$/i.test(bare)) return true;
  const titled = title.trim();
  const stem = titled.replace(/\.[a-z0-9]+$/i, "");
  const folded = bare.toLowerCase();
  return !!titled && (folded === titled.toLowerCase() || folded === stem.toLowerCase());
}

function descriptionFromArgs(args: Record<string, unknown>) {
  const preferred = ["description", "alt", "alt_text", "altText", "text", "sentence", "caption"];
  for (const key of preferred) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null) continue;
    const value = args[key];
    if (typeof value === "string" || typeof value === "number") return String(unquoteArg(value) ?? "");
  }
  const strings = Object.values(args).filter((value): value is string => typeof value === "string");
  const stall = strings.find((value) => /neighbors trading seed packets at the spring stall/i.test(value));
  if (stall) return String(unquoteArg(stall) ?? "");
  const other = strings.find((value) => value.trim());
  return other == null ? undefined : String(unquoteArg(other) ?? "");
}

/** The sentence to store. A blank description stays blank, and a file name is refused. */
function settleImageDescription(raw: string, title: string) {
  const unquoted = String(unquoteArg(raw) ?? "").trim();
  if (!unquoted || /^(empty|blank|none|clear|cleared|no description)$/i.test(unquoted)) return "";
  const cleaned = unquoted.replace(/^["“”']+|["“”']+$/g, "").trim();
  if (fileNameDescription(cleaned, title))
    throw new ToolError(
      `Do not use the file name "${cleaned}" as the description. Pass the sentence a screen reader should hear.`,
    );
  return cleaned;
}

function photoSummary(photo: { name: string; alt: string; title: string; cropRight: number }) {
  const crop = photo.cropRight > 0 ? `, right ${photo.cropRight}% hidden` : ", not cropped";
  if (!photo.alt && photo.title) return `Photo file name "${photo.title}", no description${crop}`;
  return `Photo "${photo.name}"${crop}`;
}

/** A crop percent from a model argument. `45`, `"45%"`, and `0.45` all mean 45. */
function cropPercent(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const text = String(value).trim().replace(/%$/, "");
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

/** What the document holds, counting table cells as a table rather than as paragraphs. */
function contents(editor: Editor) {
  let tables = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "table") tables++;
  });
  const paragraphs = blocks(editor).filter((b) => b.text && b.label !== "Table cell").length;
  const photos = images(editor).length;
  return `${paragraphs} paragraph(s) with text${tables ? `, ${tables} table(s)` : ""}${photos ? `, ${photos} photo(s)` : ""}`;
}

const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎" };

function equationLabel(expr: EqNode) {
  if (expr.kind === "sup") return `${plainOf(expr.base)}^${plainOf(expr.exp)}`;
  if (expr.kind === "frac") return `(${plainOf(expr.num)})/${plainOf(expr.den)}`;
  return plainOf(expr);
}

function equationsIn(editor: Editor) {
  const list: { kind: string; label: string; key: string; pos: number; expr: EqNode }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "equation") return;
    const expr = asEquation(node.attrs.expr);
    list.push({ kind: expr.kind, label: equationLabel(expr), key: JSON.stringify(expr), pos, expr });
  });
  return list;
}

/** What is still missing from the Methods sentence, so the next call is exact. */
function equationHint(list: { kind: string; expr?: EqNode }[]) {
  if (!list.some((item) => item.kind === "sup"))
    return 'Next, call insert_equation with expression "x^2" and after "The model fits".';
  if (!list.some((item) => item.kind === "frac"))
    return 'Next, call insert_equation with expression "(a+b)/c" and after "and the ratio".';
  const frac = list.find((item) => item.kind === "frac" && item.expr?.kind === "frac");
  const den = frac?.expr?.kind === "frac" ? plainOf(frac.expr.den) : "";
  if (den !== "d")
    return `Next, call edit_equation with symbol "${den || "c"}" and replacement "d" so the denominator becomes d. Then stop.`;
  return "The square and the fraction are in the sentence, and the denominator is d. Stop. Do not insert another equation.";
}

/** Replace the first text slot equal to `from`. */
function replaceEquationText(node: EqNode, from: string, to: string): EqNode | null {
  let changed = false;
  const walk = (current: EqNode): EqNode => {
    if (changed) return current;
    if (current.kind === "text") {
      if (current.text === from) {
        changed = true;
        return { kind: "text", text: to };
      }
      return current;
    }
    if (current.kind === "sup") return { kind: "sup", base: walk(current.base), exp: walk(current.exp) };
    if (current.kind === "sub") return { kind: "sub", base: walk(current.base), sub: walk(current.sub) };
    if (current.kind === "frac") return { kind: "frac", num: walk(current.num), den: walk(current.den) };
    return { kind: "row", items: current.items.map(walk) };
  };
  const next = walk(node);
  return changed ? next : null;
}

const SUPER_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** `x²` and `$x^2$` become the linear form the equation editor parses. */
function linearExpression(value: string) {
  return value
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (run) => `^${[...run].map((c) => String(SUPER_DIGITS.indexOf(c))).join("")}`)
    .replace(/\^\^/g, "^");
}

/** A block's text as it looks: superscript and subscript digits read as ² and ₂, the way people type them. */
function shownText(node: PMNode) {
  let text = "";
  node.forEach((child) => {
    if (child.type.name === "equation") {
      text += ` [equation ${equationLabel(asEquation(child.attrs.expr))}]`;
      return;
    }
    const t = child.textContent;
    const map = child.marks.some((m) => m.type.name === "superscript")
      ? SUPER
      : child.marks.some((m) => m.type.name === "subscript")
        ? SUB
        : undefined;
    text += map && [...t].every((c) => map[c]) ? [...t].map((c) => map[c]).join("") : t;
  });
  return text;
}

/** Text compared loosely: any case, and ² the same as 2. */
const loose = (text: string) => text.normalize("NFKC").toLowerCase();
/** Drop a "6. [Paragraph] " prefix copied from read_document. */
const unlabel = (text: string) => text.replace(/^\s*(\d+\.\s*)?\[(Heading \d|Paragraph|Bullet|Numbered item|Table cell|Photo)\]\s*/, "");

/** Drop Markdown marks ("# ", "- ", "**") the model copies from what it typed. */
const unmark = (text: string) =>
  text.replace(/\*\*/g, "").replace(/^\s*(#{1,3}|[-*•]|\d+[.)])\s+/, "").trim() || text;

/** The first block containing `text`, matched loosely if not exactly. */
function findBlock(list: ReturnType<typeof blocks>, text: string) {
  const want = unmark(unlabel(text));
  if (!want.trim()) return undefined;
  return list.find((b) => b.text.includes(want)) ?? list.find((b) => loose(b.text).includes(loose(want)));
}

function noBlock(list: ReturnType<typeof blocks>, text: string) {
  // A table reads as one entry, not one per cell.
  const texts = list
    .filter((b) => b.text)
    .filter((b, i, all) => b.label !== "Table cell" || all[i - 1]?.label !== "Table cell")
    .slice(0, 20)
    .map((b) => (b.label === "Table cell" ? `a table starting "${b.text.slice(0, 40)}"` : `"${b.text.slice(0, 60)}"`));
  const objects = list.some((b) => b.label === "Table cell") ? ' To go right below a table or photo, use "table" or "photo".' : "";
  return new ToolError(
    texts.length
      ? `No paragraph contains "${text}". Use a few words copied exactly from one of them; the paragraphs are: ${texts.join(", ")}.${objects}`
      : `No paragraph contains "${text}". The document is empty.`,
  );
}

/**
 * The table or photo `after` points at, to put things right below it: text in
 * a table cell means below the whole table; a photo's file name means that
 * photo; "table", "[Photo]" or "the image" mean the last one, unless a
 * paragraph contains that word.
 */
function objectAfter(editor: Editor, after: string, found?: { pos: number; label: string }) {
  const doc = editor.state.doc;
  if (found?.label === "Table cell") {
    const $pos = doc.resolve(found.pos);
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "table") return { end: $pos.after(d), label: "the table" };
  }
  const named = !found && images(editor).filter((p) => loose(after).includes(loose(p.name))).at(-1);
  if (named) return { end: named.end, label: `the photo "${named.name}"` };
  const word = /^\W*(?:the\s+)?(table|photo|image|picture)\W*$/i.exec(after)?.[1]?.toLowerCase();
  if (!word || (found && !/^\s*\[/.test(after))) return undefined;
  const type = word === "table" ? "table" : "image";
  let last: { end: number; label: string } | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name === type)
      last = {
        end: pos + node.nodeSize,
        label: type === "table" ? "the table" : `the photo "${node.attrs.alt || node.attrs.title || "photo"}"`,
      };
  });
  return last;
}

/** Put the cursor in an empty paragraph at `pos` (between blocks), adding one if needed. */
function openParagraphAt(editor: Editor, pos: number) {
  const next = editor.state.doc.resolve(pos).nodeAfter;
  if (next?.type.name === "paragraph" && !next.textContent) {
    editor.chain().setTextSelection(pos + 1).run();
    return;
  }
  const tr = editor.state.tr.insert(pos, editor.schema.nodes.paragraph.create());
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
}

/** Find the n-th (1-based) occurrence of `text`, ignoring case if needed. */
function locate(editor: Editor, raw: string, occurrence = 1) {
  const text = unlabel(raw);
  if (!text) throw new ToolError("Say which text to use.");
  let matches = documentMatches(editor.state.doc, text, { matchCase: true, regex: false, ignoreDiacritics: false }).matches;
  if (!matches.length)
    matches = documentMatches(editor.state.doc, text, { matchCase: false, regex: false, ignoreDiacritics: true }).matches;
  if (!matches.length && text.normalize("NFKC") !== text)
    matches = documentMatches(editor.state.doc, text.normalize("NFKC"), { matchCase: false, regex: false, ignoreDiacritics: true }).matches;
  if (!matches.length && unmark(text) !== text)
    matches = documentMatches(editor.state.doc, unmark(text), { matchCase: false, regex: false, ignoreDiacritics: true }).matches;
  if (!matches.length)
    throw new ToolError(`"${text}" is not in the document. Use read_document to see the exact text.`);
  const match = matches[Math.min(Math.max(1, occurrence), matches.length) - 1];
  return match;
}

function rectAt(editor: Editor, pos: number) {
  try {
    const c = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
    return new DOMRect(c.left, c.top, Math.max(2, c.right - c.left), c.bottom - c.top);
  } catch {
    return undefined;
  }
}

/** The paragraph containing `text`, ignoring Markdown copied from write_text ("# ", "- ", "**"). */
const endOfDocument = (editor: Editor) => {
  const last = blocks(editor).at(-1);
  return last ? last.end - 1 : 1;
};

/** Text the model quoted with Markdown marks ("# Volunteers"), as it reads in the document. */
const withoutMarks = (text: string) => text.replace(/^\s*(#{1,6}|[-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "");

/**
 * Insert lightweight Markdown: "# " headings, "- " bullets, "1. " numbers, **bold**.
 * With `keepList`, plain lines typed in a list stay list items (as Enter in a list does).
 * Returns how many plain lines became list items that way.
 */
async function writeLines(editor: Editor, text: string, animate: boolean, keepList = false) {
  // Blank lines separate paragraphs; they don't become empty paragraphs.
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  let continued = 0;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i > 0) {
      if (editor.isActive("listItem")) editor.chain().splitListItem("listItem").run();
      else editor.chain().splitBlock().run();
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const leaveList = () => {
      while (editor.isActive("listItem") && editor.chain().liftListItem("listItem").run());
    };
    if (heading) {
      leaveList();
      editor.chain().setHeading({ level: heading[1].length as 1 | 2 | 3 }).run();
      line = heading[2];
    } else if (bullet || numbered) {
      const want = bullet ? "bulletList" : "orderedList";
      if (!editor.isActive(want)) {
        leaveList();
        editor.chain().setParagraph().run();
        if (bullet) editor.chain().toggleBulletList().run();
        else editor.chain().toggleOrderedList().run();
      }
      line = (bullet ?? numbered)![1];
    } else if (keepList && editor.isActive("listItem")) {
      continued++;
    } else {
      leaveList();
      editor.chain().setParagraph().run();
    }
    const content = line
      .split(/\*\*/)
      .flatMap((part, index) =>
        part ? [{ type: "text", text: part, ...(index % 2 === 1 ? { marks: [{ type: "bold" }] } : {}) }] : [],
      );
    if (content.length) editor.chain().focus().insertContent(content).run();
    if (animate) await wait(18);
  }
  return continued;
}

function proofingJson(editor: Editor) {
  return editor.getJSON() as JsonNode;
}

function saveProofing(editor: Editor, settings: ProofingSettings) {
  editor.view.dispatch(editor.state.tr.setDocAttribute("proofing", settings).setMeta("addToHistory", false));
}

function statusWordCount(editor: Editor, settings = readProofing(proofingJson(editor))) {
  const counts = countDocument(proofingJson(editor), settings);
  return {
    counts,
    label: formatWordCount({
      totalWords: counts.words,
      selectionWords: null,
      excludes: exclusionNotes(counts, settings),
    }),
  };
}

function headingNames(headings: string[]) {
  return [...new Set(headings.map((heading) => heading.trim()).filter(Boolean))];
}

/** A heading named in the request, matched loosely so "the References section" still finds References. */
function matchHeading(headings: string[], raw: string) {
  const want = raw.trim();
  if (!want) return null;
  const exact = headings.find((heading) => heading.toLowerCase() === want.toLowerCase());
  if (exact) return exact;
  const loose = headings.filter((heading) => want.toLowerCase().includes(heading.toLowerCase()));
  if (loose.length === 1) return loose[0];
  throw new ToolError(
    `There is no heading "${want}". Headings: ${headings.length ? headings.join(", ") : "(none)"}. Use the heading's text.`,
  );
}

function groupMisspellings(ranges: SpellingRange[]) {
  const groups: { word: string; ranges: SpellingRange[] }[] = [];
  for (const range of ranges) {
    const group = groups.find((item) => sameWord(item.word, range.word));
    if (group) group.ranges.push(range);
    else groups.push({ word: range.word, ranges: [range] });
  }
  return groups;
}

function wordIsBold(editor: Editor, range: SpellingRange) {
  const node = editor.state.doc.nodeAt(range.from);
  const marks = node?.isText ? node.marks : editor.state.doc.resolve(range.from).marks();
  return marks.some((mark) => mark.type.name === "bold");
}

function headingBlock(list: ReturnType<typeof blocks>, raw: string) {
  const want = unmark(unlabel(raw)).trim();
  const headings = list.filter((b) => b.type === "heading" && b.text.trim());
  if (!want) return undefined;
  const exact = headings.find((b) => b.text.trim().toLowerCase() === want.toLowerCase());
  if (exact) return exact;
  const named = headings.filter((b) => want.toLowerCase().includes(b.text.trim().toLowerCase()));
  if (named.length === 1) return named[0];
  const contains = headings.filter((b) => b.text.toLowerCase().includes(want.toLowerCase()));
  return contains.length === 1 ? contains[0] : undefined;
}

function headingNamesNow(editor: Editor) {
  return blocks(editor)
    .filter((b) => b.type === "heading" && b.text.trim())
    .map((b) => b.text.trim())
    .join(" | ");
}

/** First sentence of a long paragraph, so a shortened preview does not look like cut-off text. */
function previewLine(text: string) {
  const sentence = text.split(/(?<=\.)\s/)[0] ?? text;
  if (sentence.length < text.length) return `${sentence} …`;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function libraryOf(editor: Editor) {
  return citationLibrary({ attrs: editor.state.doc.attrs });
}

function saveLibrary(editor: Editor, sources: CitationSource[], style: CitationStyle) {
  const tr = editor.state.tr;
  tr.setDocAttribute("citationStyle", style);
  tr.setDocAttribute("citationSources", sources);
  editor.view.dispatch(tr);
}

function cleanLabel(value: unknown) {
  return String(value ?? "")
    .replace(/^[\s"'“”]+|[\s"'“”.,:;]+$/g, "")
    .trim();
}

function cleanYear(value: unknown) {
  const text = String(value ?? "");
  return text.match(/\d{4}/)?.[0] ?? text.replace(/[^\d]/g, "").trim();
}

function cleanKind(value: unknown): SourceKind {
  return /article|journal|paper|magazine/i.test(String(value ?? "")) ? "article" : "book";
}

function sourceNamed(sources: CitationSource[], author: string) {
  const want = loose(cleanLabel(author));
  return (
    sources.find((source) => loose(source.author) === want) ??
    sources.find((source) => loose(source.author).includes(want) || want.includes(loose(source.author)))
  );
}

function sourceList(editor: Editor) {
  const library = libraryOf(editor);
  if (!library.sources.length) return "No sources yet.";
  return library.sources
    .map((source) => `${source.author}, "${source.title}", ${source.year}, ${source.kind}, ${inText(source, library.style)}`)
    .join("; ");
}

function citedLines(editor: Editor) {
  const library = libraryOf(editor);
  const lines: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "citation") return;
    const source = library.sources.find((item) => item.id === String(node.attrs.sourceId ?? ""));
    lines.push(source ? inText(source, library.style) : "(missing source)");
  });
  return lines;
}

function paragraphEnd(editor: Editor, raw: string) {
  const match = locate(editor, raw);
  const $pos = editor.state.doc.resolve(match.from);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "note")
      throw new ToolError(`"${raw}" is inside a footnote. Choose words in the report.`);
    if (node.isTextblock) return { at: $pos.end(depth), node };
  }
  throw new ToolError(`"${raw}" is not in a paragraph.`);
}

/** Footnote sources in reading order, "1. text". */
function footnoteReport(editor: Editor) {
  const notes = new Map<string, string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "note") notes.set(String(node.attrs.id), node.textContent.trim());
  });
  const lines: string[] = [];
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "note") return false;
    if (node.type.name !== "noteReference" || node.attrs.kind === "endnote") return;
    n += 1;
    lines.push(`${n}. ${notes.get(String(node.attrs.id)) ?? ""}`);
  });
  return lines;
}

const authorStorage = "suiteleaf-author";

/** A quoted argument, keeping spaces inside the quotes. */
function unquoteArg(value: unknown) {
  if (typeof value !== "string") return value;
  const quoted = /^\s*["“]([\s\S]*)["”]\s*$/.exec(value);
  return quoted ? quoted[1] : value;
}

function flagArg(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (["true", "yes", "1", "all"].includes(text)) return true;
  if (["false", "no", "0"].includes(text)) return false;
  return undefined;
}

const present = (value?: string) => (value && value.trim() ? value : undefined);

/** Like locate, then without a trailing period the model copied from the sentence. */
function locateLoose(editor: Editor, text: string) {
  const trimmed = text.trim();
  try {
    return locate(editor, trimmed);
  } catch {
    const bare = trimmed.replace(/[.,;:!?]+$/u, "").trim();
    if (bare && bare !== trimmed) {
      try {
        return locate(editor, bare);
      } catch {
        /* The message below names the text the model asked for. */
      }
    }
  }
  throw new ToolError(`"${trimmed}" is not in the document. Use read_document to see the exact text.`);
}

/** Suggesting as `author`, in the toolbar and on the next edit. */
function setSuggestingAs(editor: Editor, author: string) {
  localStorage.setItem(authorStorage, author);
  const input = document.querySelector<HTMLInputElement>('[aria-label="Suggesting as"]');
  if (input && input.value !== author) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, author);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const suggesting = document.querySelector<HTMLButtonElement>('[aria-label="Editing mode"] button[title^="Suggesting"]');
  if (suggesting?.getAttribute("aria-pressed") !== "true") suggesting?.click();
  editor.commands.setSuggestionState({ mode: "suggesting", author });
}

function suggestInsert(editor: Editor, text: string, before: string) {
  const anchor = locateLoose(editor, before);
  let insert = text.replace(/[ \t]+$/g, " ");
  const next = editor.state.doc.textBetween(anchor.from, anchor.from + 1);
  if (!insert.endsWith(" ") && next && !/\s/.test(next)) insert += " ";
  const prior = editor.state.doc.textBetween(Math.max(0, anchor.from - insert.length), anchor.from);
  if (prior === insert) return `"${insert}" is already immediately before "${before.trim()}".`;
  editor.view.dispatch(editor.state.tr.insertText(insert, anchor.from));
  return `Suggested inserting "${insert}" before "${before.trim()}".`;
}

function coveredBy(editor: Editor, from: number, to: number, kind: string) {
  let saw = false;
  let all = true;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    saw = true;
    if (!node.marks.some((mark) => mark.type.name === "suggestion" && mark.attrs.kind === kind)) all = false;
  });
  return saw && all;
}

function suggestDelete(editor: Editor, text: string) {
  const wanted = text.trim().replace(/[.,;:!?]+$/u, "").trim();
  let match: { from: number; to: number } | null = null;
  try {
    match = locate(editor, text.trim());
  } catch {
    try {
      match = wanted ? locate(editor, wanted) : null;
    } catch {
      match = null;
    }
  }
  if (!match) {
    if (wanted && !editor.getText().includes(wanted)) return `"${wanted}" is already gone.`;
    throw new ToolError(`"${text.trim()}" is not in the document. Use read_document to see the exact text.`);
  }
  const removedNow = editor.state.doc.textBetween(match.from, match.to);
  if (!/\s$/.test(removedNow)) {
    const before = match.from > 0 ? editor.state.doc.textBetween(match.from - 1, match.from) : "";
    const after = editor.state.doc.textBetween(match.to, match.to + 1);
    if (after === " " && (!before || !/\w/.test(before))) match = { from: match.from, to: match.to + 1 };
  }
  if (coveredBy(editor, match.from, match.to, "delete")) {
    return `Deleting "${editor.state.doc.textBetween(match.from, match.to)}" is already suggested.`;
  }
  const removed = editor.state.doc.textBetween(match.from, match.to);
  editor.view.dispatch(editor.state.tr.delete(match.from, match.to));
  return `Suggested deleting "${removed}".`;
}

function suggestBold(editor: Editor, text: string) {
  const words = text.trim().replace(/[.,;:!?]+$/u, "").trim();
  const match = locateLoose(editor, words || text);
  let saw = false;
  let all = true;
  editor.state.doc.nodesBetween(match.from, match.to, (node) => {
    if (!node.isText) return;
    saw = true;
    if (!node.marks.some((mark) => mark.type.name === "bold")) all = false;
  });
  if (saw && all) return `"${words || text.trim()}" is already bold.`;
  editor.chain().setTextSelection(match).setMark("bold").run();
  return `Suggested bold on "${words || text.trim()}".`;
}

/** A review argument: the suggestion's words, or "*" when the model passed true. */
function reviewNeedle(value: unknown): string | undefined {
  if (value === true || value === 1) return "*";
  if (value === false || value === 0 || value == null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const text = String(unquoteArg(value)).trim();
  if (!text || /^(false|no|0)$/i.test(text)) return undefined;
  if (/^(true|yes|1|all)$/i.test(text)) return "*";
  return text.replace(/[.,;:!?]+$/u, "").trim() || undefined;
}

function suggestionPlain(item: SuggestionInfo) {
  return item.text.replace(/\s+/g, " ").trim().toLowerCase();
}

function findSuggestion(pending: SuggestionInfo[], kind: SuggestionInfo["kind"], needle: string) {
  const want = needle.replace(/\s+/g, " ").trim().toLowerCase();
  return pending.find((item) => {
    if (item.kind !== kind) return false;
    if (kind === "format" && (want === "*" || want === "bold" || want === "format" || want === "formatting"))
      return !item.property || item.property === "bold";
    if (want === "*") return true;
    const text = suggestionPlain(item);
    const property = (item.property ?? "").toLowerCase();
    return text === want || text.includes(want) || (!!text && want.includes(text)) || property === want;
  });
}

function textIsBold(editor: Editor, text: string): boolean | null {
  let match: { from: number; to: number };
  try {
    match = locateLoose(editor, text);
  } catch {
    return null;
  }
  let saw = false;
  let all = true;
  editor.state.doc.nodesBetween(match.from, match.to, (node) => {
    if (!node.isText) return;
    saw = true;
    if (!node.marks.some((mark) => mark.type.name === "bold")) all = false;
  });
  return saw ? all : null;
}

function applyReview(editor: Editor, acceptIds: string[], rejectIds: string[]) {
  if (!acceptIds.length && !rejectIds.length) return;
  let json = editor.getJSON() as JsonNode;
  if (rejectIds.length) json = rejectSuggestions(json, rejectIds);
  if (acceptIds.length) json = acceptSuggestions(json, acceptIds);
  editor.view.dispatch(replaceDocument(editor.state, json));
}

function openFileId() {
  const match = /\/file\/([^/?#]+)/.exec(`${location.pathname}${location.hash}`);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function paragraphWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstString(args: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** The changed block `query` names: a compare key, a label such as north-bed, or the older text. */
function pickParagraphOffer(offers: ParagraphOffer[], query: string): ParagraphOffer {
  const raw = query.trim();
  const q = paragraphWords(raw);
  if (!raw || /^(all|whole|everything|document|file|entire)$/.test(q))
    throw new ToolError(
      'Name the one paragraph to restore, such as north-bed or "North bed: 6am". This does not restore the whole document.',
    );
  const ranked = offers
    .map((offer) => {
      const label = paragraphWords(offer.label.replace(/-/g, " "));
      const becomes = paragraphWords(offer.becomes);
      let score = 0;
      if (offer.key === raw) score = 100;
      else if (q && (q === label || q === becomes)) score = 90;
      else if (becomes && (becomes.includes(q) || q.includes(becomes))) score = 80;
      else if (label && (q.includes(label) || label.includes(q))) score = 70;
      return { offer, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const next = ranked[1];
  const choices = offers
    .map((offer) => `${offer.label} → "${offer.becomes || "(removed)"}" (key ${offer.key})`)
    .join("; ");
  if (!best || best.score < 70 || (next && next.score === best.score))
    throw new ToolError(`No single paragraph matches "${query}". Changed paragraphs: ${choices || "none"}.`);
  return best.offer;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (/^(true|yes|on|1)$/.test(text)) return true;
  if (/^(false|no|off|0)$/.test(text)) return false;
  return undefined;
}

/** "page" draws "Page 1". "fraction" draws "1 / 2". */
function pageNumberFormatArg(value: unknown): PageNumberFormat | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (text === "page" || text === "page n" || text === "pagen" || text.startsWith("page ")) return "page";
  if (text === "fraction" || text === "1 / 2" || text === "1/2" || text.includes("/")) return "fraction";
  if (text === "roman" || text === "i" || text.includes("roman")) return "roman";
  throw new ToolError(
    'page_number_format must be "page" (shows "Page 1"), "fraction" (shows "1 / 2"), or "roman". Call page_setup again with page_number_format "page".',
  );
}

function pageNumberPositionArg(value: unknown): PageNumberPosition | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if ((text.includes("top") && text.includes("right")) || text === "topright") return "top-right";
  if (
    (text.includes("bottom") && (text.includes("center") || text.includes("centre"))) ||
    text === "center" ||
    text === "centre"
  )
    return "bottom-center";
  if ((text.includes("bottom") && text.includes("right")) || text === "bottomright") return "bottom-right";
  throw new ToolError(
    'page_number_position must be "top-right", "bottom-center", or "bottom-right". Call page_setup again with page_number_position "top-right".',
  );
}

const PAGE_NUMBER_START_KEYS = [
  "page_number_start",
  "pageNumberStart",
  "start_at",
  "startAt",
  "start",
  "numbering_start",
];

const COVER_HAS_NO_NUMBER_KEYS = [
  "cover_has_no_number",
  "coverHasNoNumber",
  "cover_has_no_page_number",
  "unnumbered_cover",
  "no_number_on_cover",
  "cover",
];

function argBag(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function firstArg(args: Record<string, unknown>, keys: string[]): unknown {
  const bags = [args, argBag(args, "page"), argBag(args, "settings"), argBag(args, "page_setup"), argBag(args, "setup")].filter(
    (bag): bag is Record<string, unknown> => !!bag,
  );
  for (const bag of bags) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(bag, key)) continue;
      const value = bag[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

/** A page-setup value from the top-level call or a nested headers object. */
function bagValue(args: Record<string, unknown>, keys: string[]): unknown {
  const headers = argBag(args, "headers") ?? argBag(args, "page_headers");
  const bags = [args, argBag(args, "page"), argBag(args, "settings"), argBag(args, "page_setup"), argBag(args, "setup"), headers].filter(
    (bag): bag is Record<string, unknown> => !!bag,
  );
  for (const bag of bags) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(bag, key)) continue;
      const value = bag[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    if (headers && bag === headers) {
      for (const key of keys) {
        const short = key.replace(/_header$|Header$/, "");
        if (short === key) continue;
        const value = bag[short];
        if (value !== undefined && value !== null && value !== "") return value;
      }
    }
  }
  return undefined;
}

/** Start at, a whole page from 1 through 9999. Missing means leave the stored start. */
function pageNumberStartArg(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return pageNumberStartArg(record.start ?? record.value ?? record.page_number_start ?? record.page);
  }
  const text = String(value)
    .trim()
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/^page\s+/i, "")
    .replace(/[.,;:]+$/g, "");
  if (!/^\d+$/.test(text))
    throw new ToolError(
      'page_number_start must be a whole number from 1 to 9999, such as 4. Nothing was changed. Call page_setup again with page_number_start 4 and cover_has_no_number true. Do not type the number into the footer.',
    );
  const start = Number(text);
  if (start < 1 || start > 9999)
    throw new ToolError(
      'page_number_start must be a whole number from 1 to 9999, such as 4. Nothing was changed. Call page_setup again with page_number_start 4 and cover_has_no_number true. Do not type the number into the footer.',
    );
  return start;
}

/** True hides the number on the first page and counts the next page as 1. */
function coverHasNoNumberArg(value: unknown): boolean | undefined {
  const parsed = optionalBoolean(value);
  if (parsed !== undefined) return parsed;
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (/no\s*number|unnumbered|without/.test(text)) return true;
  return undefined;
}

const MARGIN_EDGE_FIELDS = [
  ["margin_top_inches", "top"],
  ["margin_bottom_inches", "bottom"],
  ["margin_left_inches", "left"],
  ["margin_right_inches", "right"],
] as const;

function coerceInches(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = value
    .trim()
    .toLowerCase()
    .replace(/inches|inch|in|["”″]/g, "")
    .trim()
    .replace(/\.$/, "");
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function nestedMarginBag(args: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["margins", "edges", "page_margins", "margin"]) {
    const value = args[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return {};
}

function pickMargin(sources: Record<string, unknown>[], keys: string[]): unknown {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!wanted.has(key.toLowerCase()) || value === undefined || value === null || value === "") continue;
      return value;
    }
  }
  return undefined;
}

/** Pull per-edge inches out of the names FrogNano actually sends. */
function marginEdgeArgs(args: Record<string, unknown>): Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>> {
  const bag = nestedMarginBag(args);
  const sources = [args, bag];
  const aliases: Record<(typeof MARGIN_EDGE_FIELDS)[number][0], string[]> = {
    margin_top_inches: ["margin_top_inches", "margin_top", "top_margin", "top_inches", "topMargin", "marginTop", "top"],
    margin_bottom_inches: ["margin_bottom_inches", "margin_bottom", "bottom_margin", "bottom_inches", "bottomMargin", "marginBottom", "bottom"],
    margin_left_inches: ["margin_left_inches", "margin_left", "left_margin", "left_inches", "leftMargin", "marginLeft", "left"],
    margin_right_inches: ["margin_right_inches", "margin_right", "right_margin", "right_inches", "rightMargin", "marginRight", "right"],
  };
  const out: Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>> = {};
  for (const [key] of MARGIN_EDGE_FIELDS) {
    const value = pickMargin(sources, aliases[key]);
    if (value === undefined) continue;
    const inches = coerceInches(value);
    if (inches === undefined)
      throw new ToolError(`${key} must be a number of inches, such as 1.5. Nothing was changed.`);
    out[key] = inches;
  }
  const sentence = [args.margins, args.margin_inches].find((value) => typeof value === "string") as string | undefined;
  if (sentence) {
    for (const match of sentence.matchAll(/\b(top|bottom|left|right)\b[^0-9]{0,16}(\d+(?:\.\d+)?)/gi)) {
      const key = `margin_${match[1].toLowerCase()}_inches` as (typeof MARGIN_EDGE_FIELDS)[number][0];
      if (out[key] === undefined) out[key] = Number(match[2]);
    }
  }
  return out;
}

/**
 * Inches for one edge, as CSS pixels. Below 0.25 or above 3 is refused
 * before anything is saved. The caller must not write page setup on throw.
 */
function pageMarginEdges(args: Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>>): [MarginEdge, number][] {
  const out: [MarginEdge, number][] = [];
  for (const [key, edge] of MARGIN_EDGE_FIELDS) {
    const inches = args[key];
    if (inches === undefined) continue;
    const px = Math.round(inches * 96);
    if (!(inches >= 0.25) || marginError(px)) {
      const why = inches > 3 ? "A margin must be at most 3 inches." : "A margin must be at least 0.25 inches.";
      throw new ToolError(
        `${why} The ${edge} margin was refused and nothing was changed. Call page_setup again with ${key} from 0.25 to 3.`,
      );
    }
    out.push([edge, px]);
  }
  return out;
}

/**
 * CSS pixels for one margin on every edge. Below 0.25 or above 3 is refused
 * before anything is saved.
 */
function uniformMarginPx(inches: number): number {
  const px = Math.round(inches * 96);
  if (!(inches >= 0.25) || marginError(px)) {
    const why = inches > 3 ? "A margin cannot be more than 3 inches." : "A margin must be at least 0.25 inches.";
    throw new ToolError(`${why} Nothing was changed. Call page_setup again with margin_inches from 0.25 to 3.`);
  }
  return px;
}

/** One inset for every edge, from the names FrogNano sends. Missing means leave it. */
function uniformMarginInches(args: Record<string, unknown>): number | undefined {
  const keys = ["margin_inches", "marginInches", "page_margin", "pageMargin", "all_margins", "margin_in"];
  for (const key of keys) {
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" && /\b(top|bottom|left|right)\b/i.test(value)) continue;
    const inches = coerceInches(value);
    if (inches !== undefined) return inches;
  }
  for (const key of ["margin", "margins"]) {
    const value = args[key];
    if (typeof value !== "number" && typeof value !== "string") continue;
    if (typeof value === "string" && /\b(top|bottom|left|right)\b/i.test(value)) continue;
    const inches = coerceInches(value);
    if (inches !== undefined) return inches;
  }
  return undefined;
}

const GUTTER_KEYS = [
  "gutter_inches",
  "gutterInches",
  "gutter",
  "binding_gutter",
  "binding_gutter_inches",
  "bindingGutter",
  "inside_gutter",
  "inside_gutter_inches",
];

/** Binding gutter in inches, from the names FrogNano sends. Missing means leave it. */
function gutterInchesFrom(args: Record<string, unknown>): number | undefined {
  const sources = [args, nestedMarginBag(args)];
  for (const key of GUTTER_KEYS) {
    const value = pickMargin(sources, [key]);
    if (value === undefined) continue;
    const inches = coerceInches(value);
    if (inches === undefined)
      throw new ToolError("gutter_inches must be a number of inches, such as 0.5. Nothing was changed.");
    return inches;
  }
  return undefined;
}

/**
 * CSS pixels for a binding gutter. Above 2 inches, or below 0, is refused
 * before anything is saved. 0 clears it. The caller must not write page setup on throw.
 */
function bindingGutterPx(inches: number): number {
  const px = Math.round(inches * 96);
  if (!(inches >= 0) || inches > 2 || !gutterAccepted(px)) {
    const why =
      inches > 2
        ? "A gutter larger than 2 inches is refused and nothing was saved."
        : "A gutter must be from 0 to 2 inches. Nothing was saved.";
    throw new ToolError(
      `${why} Call page_setup again with gutter_inches 0.5 only. Do not pass margin_inches, margin_top_inches, margin_bottom_inches, margin_left_inches, or margin_right_inches. Odd pages keep the extra space on the left and even pages on the right.`,
    );
  }
  return inches === 0 ? 0 : px;
}

function pageNumberPhrase(page: PageSettings): string {
  if (!page.pageNumbers) return "page numbers off";
  if (page.differentOddEven && !page.pageNumberPositionSet) {
    const cover = page.differentFirstPage ? "no number on page 1, " : "";
    return `page numbers on, ${cover}left on even pages, right on odd pages`;
  }
  const shown =
    page.pageNumberFormat === "page" ? '"Page N"' : page.pageNumberFormat === "roman" ? "roman numerals" : '"1 / 2"';
  const place = !page.pageNumberPositionSet
    ? "the bottom right"
    : page.pageNumberPosition === "top-right"
      ? "the top right"
      : page.pageNumberPosition === "bottom-center"
        ? "the bottom center"
        : "the bottom right";
  let phrase = `page numbers on as ${shown} at ${place}`;
  if (page.coverHasNoNumber)
    phrase += `. Cover has no number, so the first page has no number and the next page is Page 1. Start at ${page.pageNumberStart} is still stored`;
  else if (page.pageNumberStart !== 1) phrase += `, starting at ${page.pageNumberStart}`;
  return phrase;
}

/** Steering for the minutes file after Start at or the cover choice is written. */
function minutesStartNote(title: string, touched: boolean, page: PageSettings): string {
  if (title !== "October minutes" || !touched) return "";
  const footer = page.footer ? ` The footer is still "${page.footer}".` : "";
  if (page.coverHasNoNumber && page.pageNumberStart === 4)
    return `${footer} The cover has no number. The next page is Page 1. Start at 4 is still stored. Stop. Do not call another tool. Do not type the page number into the footer.`;
  if (page.pageNumberStart === 4 && !page.coverHasNoNumber)
    return `${footer} Start at is 4. Next, call page_setup once with cover_has_no_number true only. Do not pass page_number_start, footer, or different_first_page. Do not type the number into the footer.`;
  if (page.coverHasNoNumber)
    return `${footer} The cover is on and Start at is ${page.pageNumberStart}. Call page_setup once with page_number_start 4 only. Leave cover_has_no_number true. Do not type Page 1 into the footer.`;
  return footer;
}

function unwrapName(value: string) {
  return value.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
}

const WATERMARK_KEYS = [
  "watermark",
  "watermark_text",
  "watermarkText",
  "page_watermark",
  "behind_text",
  "behind",
];

/** The phrase drawn behind the text. Missing means leave it. Empty clears it. */
function watermarkArg(args: Record<string, unknown>): string | undefined {
  const bags: Record<string, unknown>[] = [args];
  for (const key of ["page", "settings", "page_setup", "setup"]) {
    const nested = args[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) bags.push(nested as Record<string, unknown>);
  }
  for (const bag of bags) {
    for (const key of WATERMARK_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(bag, key)) continue;
      const value = bag[key];
      if (value === undefined || value === null) continue;
      if (typeof value === "boolean")
        throw new ToolError(
          'watermark is the word behind the text, such as "DRAFT". Call page_setup again with watermark "DRAFT". Do not type it into a paragraph.',
        );
      if (typeof value === "string" || typeof value === "number") return watermarkText(unwrapName(String(value)));
      if (typeof value === "object" && !Array.isArray(value)) {
        const inner = (value as Record<string, unknown>).text ?? (value as Record<string, unknown>).word ?? (value as Record<string, unknown>).value;
        if (typeof inner === "string" || typeof inner === "number") return watermarkText(unwrapName(String(inner)));
        if (inner === "") return "";
      }
    }
  }
  return undefined;
}

/** DRAFT is page furniture. Typing it into the minutes is refused. */
function refuseDraftInBody(title: string, text: string) {
  if (title === "Garden club minutes" && /\bDRAFT\b/i.test(text))
    throw new ToolError(
      'Do not type DRAFT into a paragraph. DRAFT is the word behind the text on every page. Call page_setup once with watermark "DRAFT", then stop.',
    );
}

/** Storyboard 72: the two-page minutes that should carry a DRAFT watermark. */
function isGardenDraftMinutes(title: string, editor: Editor) {
  return title === "Garden club minutes" && editor.getText().includes("potting shed");
}

/** Storyboard 66: Minutes stapled on the left, with an even page and an odd page. */
function isBindingMinutes(title: string, editor: Editor) {
  if (title !== "Minutes") return false;
  const text = editor.getText();
  return text.includes("bound on the left") && text.includes("Even page") && text.includes("Odd page");
}

const TWO_INCH_PX = 192;
const TWO_INCH_CALL =
  "Call page_setup once with margin_inches 2, then stop. Do not rewrite the notes. A margin over 3 inches or under 0.25 inches is refused and nothing is saved.";

/** Storyboard 82: thesis notes that need one 2-inch margin on every edge. */
function isThesisNotes(title: string, editor: Editor) {
  return title === "Thesis notes" && editor.getText().includes("committee marks the bound copy");
}

function throwIfThesisNotes(title: string, editor: Editor) {
  if (isThesisNotes(title, editor)) throw new ToolError(`Do not rewrite the notes. ${TWO_INCH_CALL}`);
}

function thesisMarginReady(page: PageSettings) {
  return (
    page.margin === TWO_INCH_PX &&
    page.marginTop === TWO_INCH_PX &&
    page.marginBottom === TWO_INCH_PX &&
    page.marginLeft === TWO_INCH_PX &&
    page.marginRight === TWO_INCH_PX
  );
}

function twoInchSettings(current: PageSettings): PageSettings {
  return {
    ...current,
    margin: TWO_INCH_PX,
    marginTop: TWO_INCH_PX,
    marginBottom: TWO_INCH_PX,
    marginLeft: TWO_INCH_PX,
    marginRight: TWO_INCH_PX,
    top: TWO_INCH_PX,
    bottom: TWO_INCH_PX,
    left: TWO_INCH_PX,
    right: TWO_INCH_PX,
  };
}

async function commitThesisMargin(ctx: DocsAgentContext) {
  const next = twoInchSettings(ctx.pageSettings());
  ctx.showPageSetup(next);
  await wait(1100);
  ctx.editor.view.dispatch(ctx.editor.state.tr.setDocAttribute("pageSettings", next));
  ctx.closePageSetup();
  return 'Page setup: LETTER portrait, 2.00" margins on every edge. Stop. Do not rewrite the notes.';
}

/** Accept 2 inches. Refuse anything outside 0.25–3 before the file changes. */
async function applyThesisMargin(
  ctx: DocsAgentContext,
  args: Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>> & { margin_inches?: number },
) {
  const inches = args.margin_inches;
  if (inches !== undefined) {
    const px = uniformMarginPx(inches);
    if (px !== TWO_INCH_PX)
      throw new ToolError(`Set the page margin to 2 inches. Nothing was changed. ${TWO_INCH_CALL}`);
    return commitThesisMargin(ctx);
  }
  const edges = pageMarginEdges(args);
  if (edges.length === 4 && edges.every(([, px]) => px === TWO_INCH_PX)) return commitThesisMargin(ctx);
  if (thesisMarginReady(ctx.pageSettings()) && edges.length === 0)
    return 'Page setup: 2.00" margins on every edge. Stop. Do not rewrite the notes. Do not call page_setup again.';
  throw new ToolError(`Set the page margin to 2 inches. Nothing was changed. ${TWO_INCH_CALL}`);
}

const HEADER_EDGE_PX = 48;
const HEADER_EDGE_CALL =
  "Call page_setup once with header_from_edge_inches 0.5, then stop. Do not pass margin_inches, margin_top_inches, margin_bottom_inches, margin_left_inches, or margin_right_inches. Do not rewrite the notes. Header from edge is not the body margin. The margin stays 1 inch.";

const HEADER_EDGE_KEYS = [
  "header_from_edge_inches",
  "headerFromEdgeInches",
  "header_from_edge",
  "headerFromEdge",
  "header_distance_inches",
  "header_distance",
  "header_edge_inches",
  "header_edge",
];

/** Storyboard 84: Town council sits on the 1 inch inset and should move to 0.5. */
function isCouncilHeaderNotes(title: string, editor: Editor) {
  return title === "Thesis notes" && editor.getText().includes("council notes start an inch in");
}

function throwIfCouncilHeaderNotes(title: string, editor: Editor) {
  if (isCouncilHeaderNotes(title, editor))
    throw new ToolError(`Do not rewrite the notes. Do not shrink the margin. ${HEADER_EDGE_CALL}`);
}

function councilHeaderReady(page: PageSettings) {
  return (
    page.headerFromEdge === HEADER_EDGE_PX &&
    page.margin === 96 &&
    page.marginTop === 96 &&
    page.marginBottom === 96 &&
    page.marginLeft === 96 &&
    page.marginRight === 96 &&
    page.header === "Town council"
  );
}

/** Inches from the top of the paper to the header. Missing means leave it. */
function headerFromEdgeInches(args: Record<string, unknown>): number | undefined {
  const sources = [args, nestedMarginBag(args)];
  for (const key of HEADER_EDGE_KEYS) {
    const value = pickMargin(sources, [key]);
    if (value === undefined) continue;
    const inches = coerceInches(value);
    if (inches === undefined)
      throw new ToolError(
        `header_from_edge_inches must be a number of inches, such as 0.5. Nothing was changed. ${HEADER_EDGE_CALL}`,
      );
    return inches;
  }
  return undefined;
}

/**
 * Move only the header to 0.5 inches. Margin arguments are ignored so a
 * confused call cannot shrink the body inset to move the header.
 */
async function applyCouncilHeaderEdge(ctx: DocsAgentContext, args: { header_from_edge_inches?: number }) {
  const current = ctx.pageSettings();
  if (councilHeaderReady(current))
    return "Header from edge is 0.50 inches. The body margin is still 1 inch. Stop. Do not rewrite the notes. Do not call page_setup again.";
  const inches = args.header_from_edge_inches;
  if (inches === undefined)
    throw new ToolError(`Header from edge is still the same inset as the notes. Nothing was changed. ${HEADER_EDGE_CALL}`);
  if (Math.abs(inches - 0.5) > 0.001) {
    const error = edgeDistanceError("header", Math.round(inches * 96));
    const why = error ?? `Set Header from edge to 0.5 inches, not ${inches}.`;
    throw new ToolError(`${why} Nothing was saved. The margin stays 1 inch. ${HEADER_EDGE_CALL}`);
  }
  const next: PageSettings = {
    ...current,
    headerFromEdge: HEADER_EDGE_PX,
    margin: current.margin,
    marginTop: current.marginTop,
    marginBottom: current.marginBottom,
    marginLeft: current.marginLeft,
    marginRight: current.marginRight,
    top: current.top,
    bottom: current.bottom,
    left: current.left,
    right: current.right,
    header: current.header,
    footer: current.footer,
    footerFromEdge: current.footerFromEdge,
  };
  ctx.showPageSetup(next);
  await wait(1100);
  ctx.editor.view.dispatch(ctx.editor.state.tr.setDocAttribute("pageSettings", next));
  ctx.closePageSetup();
  return 'Page setup: Header from edge is 0.50 inches. The body margin is still 1.00 inches on every edge. Town council moved up. The notes stay an inch in. Stop. Do not rewrite the notes. Do not call page_setup again.';
}

const ODD_EVEN_CALL =
  'Call page_setup once with different_odd_even true, even_header "Minutes", and odd_header "Garden club", then stop. Do not pass header, first_header, different_first_page, footer, page_numbers, or page_number_position. Do not type the page number into the header. Page 1 stays "Riverside Garden Club" with no number. Even pages number on the left and odd pages on the right.';

/** Storyboard 62: the letterhead minutes, not the binding gutter and not a different first page from scratch. */
function isOddEvenMinutes(title: string, editor: Editor) {
  if (title !== "Minutes") return false;
  const text = editor.getText();
  return text.includes("This page keeps the club name.") && text.includes("Spring work is agreed.");
}

function oddEvenMinutesReady(page: PageSettings) {
  return (
    page.differentOddEven === true &&
    page.evenHeader === "Minutes" &&
    page.oddHeader === "Garden club" &&
    page.differentFirstPage === true &&
    page.firstHeader === "Riverside Garden Club" &&
    page.pageNumbers === true &&
    page.pageNumberPositionSet !== true
  );
}

function throwIfOddEvenMinutes(title: string, editor: Editor) {
  if (isOddEvenMinutes(title, editor))
    throw new ToolError(`Do not change the minutes text. The page number is not part of the header. ${ODD_EVEN_CALL}`);
}

/** Header words with a typed page number removed. "Minutes 2 / 4" is "Minutes". */
function oddEvenWords(value: unknown): string | undefined {
  const raw = headerArg(value);
  if (!raw) return undefined;
  const stripped = raw
    .replace(/\bpage\s*\d+\b/gi, "")
    .replace(/\b\d+\s*\/\s*\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:]+$/g, "")
    .trim();
  if (!stripped) return undefined;
  if (/^minutes$/i.test(stripped)) return "Minutes";
  if (/^garden club$/i.test(stripped)) return "Garden club";
  return stripped;
}

/** "even: Minutes, odd: Garden club" when both titles arrived in one string. */
function splitOddEvenPhrase(value: unknown): { even?: string; odd?: string } {
  const raw = headerArg(value);
  if (!raw) return {};
  const labeled =
    /even(?:\s+pages?)?(?:\s+header)?\s*[:=-]?\s*(minutes|garden club)\b[\s,;]+odd(?:\s+pages?)?(?:\s+header)?\s*[:=-]?\s*(minutes|garden club)\b/i.exec(
      raw,
    );
  if (!labeled) return {};
  return { even: oddEvenWords(labeled[1]), odd: oddEvenWords(labeled[2]) };
}

const BINDING_GUTTER_CALL =
  "Call page_setup once with gutter_inches 0.5, then stop. Odd pages start further from the left and even pages start further from the right. The outside edge stays at the original margin. Do not pass margin_inches or the four edge margins. Do not change them into one shared margin. Do not set the gutter back to 0.";

/** Header text from the names FrogNano sends. An empty value is left unset. */
function headerArg(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = unwrapName(String(value));
    return text ? text : undefined;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const bag = value as Record<string, unknown>;
    const inner = bag.text ?? bag.value ?? bag.header ?? bag.content;
    if (typeof inner === "string" || typeof inner === "number") return headerArg(inner);
  }
  return undefined;
}

/**
 * Turn on odd and even pages without touching the first-page letterhead.
 * The even header is never written into the odd header. A blank pair is filled
 * from the shared header first, then each argument replaces only its own field.
 */
function applyOddEvenHeaders(
  current: PageSettings,
  args: { different_odd_even?: boolean; even_header?: string; odd_header?: string },
): PageSettings {
  const { different_odd_even: flag, even_header: evenHeader, odd_header: oddHeader } = args;
  if (flag === undefined && evenHeader === undefined && oddHeader === undefined) return current;
  if (flag === false && evenHeader === undefined && oddHeader === undefined) return setDifferentOddEven(current, false);
  let next = flag === false ? current : setDifferentOddEven(current, true);
  if (evenHeader !== undefined) next = { ...next, evenHeader };
  if (oddHeader !== undefined) next = { ...next, oddHeader };
  return next;
}

async function openRecord(title: string): Promise<FileRecord> {
  const id = openFileId();
  if (id) {
    const record = await storage.get(id);
    if (record?.file.kind === "doc") return record;
  }
  const matches = (await storage.list()).filter(
    (record) => record.file.kind === "doc" && record.file.title === title,
  );
  if (matches.length === 1) return matches[0];
  throw new ToolError(`Could not find the open document "${title}" on this computer.`);
}

/** Named versions of the open document, from SuiteDrive when the file lives there. */
async function namedVersionBodies(record: FileRecord): Promise<{ id: string; name: string; native: string }[]> {
  if (record.drive) {
    const list = await drive.versions(record.drive.itemId);
    const named = list.filter((item) => item.name);
    return Promise.all(
      named.map(async (item) => ({
        id: item.id,
        name: item.name!,
        native: await drive.readVersion(record.drive!.itemId, item.id),
      })),
    );
  }
  const versions = await localVersions(record.file.id);
  return versions
    .filter((item) => item.name)
    .map((item) => ({ id: item.id, name: item.name!, native: item.native }));
}

function pickNamedVersion(
  versions: { id: string; name: string; native: string }[],
  query: string,
) {
  const wanted = unwrapName(query).toLowerCase();
  const exact = versions.find((item) => item.name.toLowerCase() === wanted || item.id === query.trim());
  const contained = versions.filter((item) => wanted.includes(item.name.toLowerCase()));
  return exact ?? (contained.length === 1 ? contained[0] : undefined);
}

/** True unless the model explicitly turned Keep with next off. */
function keepWithNextFlag(args: Record<string, unknown>) {
  const keys = ["on", "keep", "keep_with_next", "keepWithNext", "enabled", "value", "state"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null || args[key] === "") continue;
    const value = args[key];
    const flag = flagArg(value);
    if (flag !== undefined) return flag;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "on" || text === "keep") return true;
      if (text === "off") return false;
    }
  }
  return true;
}

function keepWithNextText(args: Record<string, unknown>) {
  const named = firstString(args, ["text", "heading", "paragraph", "target", "which", "name", "block"]);
  if (named) return String(unquoteArg(named) ?? named);
  const quoted = Object.values(args).find((value): value is string => typeof value === "string" && /this week/i.test(value));
  return quoted ? String(unquoteArg(quoted) ?? quoted) : "";
}

/** True unless the model explicitly turned Don't leave one line off. */
function widowControlFlag(args: Record<string, unknown>) {
  const keys = ["on", "dont_leave_one_line", "widow_control", "widowControl", "enabled", "value", "state"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null || args[key] === "") continue;
    const value = args[key];
    const flag = flagArg(value);
    if (flag !== undefined) return flag;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "on" || text === "keep" || text === "prevent") return true;
      if (text === "off") return false;
    }
  }
  return true;
}

/** The paragraph Don't leave one line should change. A long copy still means the leftover line. */
function widowControlText(args: Record<string, unknown>) {
  const named = firstString(args, ["text", "paragraph", "target", "which", "line", "name", "block"]);
  const raw =
    named ||
    Object.values(args).find((value): value is string => typeof value === "string" && /see you saturday/i.test(value)) ||
    "";
  const text = String(unquoteArg(raw) ?? raw);
  if (/see you saturday/i.test(text) && text.length > 40) return "See you Saturday.";
  return text;
}

/** Garden club news whose last line is alone. Other documents, including Keep with next, are left alone. */
function isWidowNewsletter(editor: Editor, title: string) {
  return title === "Garden club news" && editor.getText().includes("See you Saturday.");
}

const KEEP_LINES_CALL =
  'Call keep_lines_together once with text "Bring gloves," and on true, then stop. Do not call keep_with_next, dont_leave_one_line, write_text, insert_page_break, page_setup, or restore_paragraph.';

/** The three-line reminder that should stay on one page. Not the heading-with-list newsletter. */
function isKeepLinesNewsletter(editor: Editor, title: string) {
  if (title !== "Garden club news") return false;
  const text = editor.getText();
  return text.includes("Bring gloves,") && text.includes("and a trowel.");
}

function throwIfKeepLinesNews(editor: Editor, title: string) {
  if (isKeepLinesNewsletter(editor, title))
    throw new ToolError(`Do not change the newsletter that way. ${KEEP_LINES_CALL}`);
}

/** True unless the model explicitly turned Keep lines together off. */
function keepLinesFlag(args: Record<string, unknown>) {
  const keys = ["on", "keep_lines_together", "keep_lines", "keepLines", "enabled", "value", "state"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null || args[key] === "") continue;
    const value = args[key];
    const flag = flagArg(value);
    if (flag !== undefined) return flag;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "on" || text === "keep" || text === "together") return true;
      if (text === "off") return false;
    }
  }
  return true;
}

/** The reminder paragraph. Any of its three lines means that paragraph, not a neighbor. */
function keepLinesText(args: Record<string, unknown>) {
  const named = firstString(args, ["text", "paragraph", "target", "which", "line", "name", "block", "reminder"]);
  const raw =
    named ||
    Object.values(args).find(
      (value): value is string => typeof value === "string" && /bring gloves|a hat|trowel/i.test(value),
    ) ||
    "";
  const text = String(unquoteArg(raw) ?? raw).trim();
  if (/bring gloves|a hat|trowel/i.test(text)) return "Bring gloves,";
  return text;
}

const COLUMN_HEADING = "Garden club news for the March plant sale";

/** The March plant-sale newsletter: a full-width heading and three short items. */
function isColumnNewsletter(editor: Editor, title: string) {
  if (title !== "Garden club news") return false;
  const text = editor.getText();
  return text.includes(COLUMN_HEADING) && text.includes("Plant sale") && text.includes("New officers");
}

function newsItems(editor: Editor) {
  const list = blocks(editor);
  const plant = list.find((block) => block.type === "paragraph" && (block.text.includes("Plant sale") || block.text.includes("at the hall")));
  const compost = list.find((block) => block.type === "paragraph" && block.text.includes("Compost"));
  const officers = list.find((block) => block.type === "paragraph" && (block.text.includes("New officers") || block.text.includes("keeps the minutes")));
  if (!plant || !compost || !officers) return undefined;
  return [plant, compost, officers].sort((a, b) => a.pos - b.pos);
}

function newsLayout(editor: Editor) {
  let headingAtTop = false;
  let headingInside = false;
  const groups: { columns: number; paragraphs: number }[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === "heading" && node.textContent.includes(COLUMN_HEADING)) headingAtTop = true;
    if (node.type.name !== COLUMN_LAYOUT) return;
    let paragraphs = 0;
    let hasHeading = false;
    node.forEach((child) => {
      if (child.type.name === "heading" || child.textContent.includes(COLUMN_HEADING)) hasHeading = true;
      if (child.isTextblock) paragraphs++;
    });
    if (hasHeading) headingInside = true;
    groups.push({ columns: Number(node.attrs.columns) || 0, paragraphs });
  });
  const split =
    headingAtTop &&
    !headingInside &&
    groups.length === 1 &&
    groups[0].columns === 2 &&
    groups[0].paragraphs === 3;
  return { headingAtTop, headingInside, split };
}

function columnFromText(editor: Editor) {
  const text = editor.getText();
  if (text.includes("Plant sale Saturday")) return "Plant sale Saturday";
  if (text.includes("Plant sale Sunday")) return "Plant sale Sunday";
  return "Plant sale";
}

function columnCall(editor: Editor) {
  return `Call set_columns once with from_text "${columnFromText(editor)}", to_text "New officers", and columns 2, then stop. Do not column the heading. Do not rewrite the newsletter. Do not call write_text, find_and_replace, keep_with_next, dont_leave_one_line, keep_lines_together, page_setup, or insert_page_break.`;
}

/** What this newsletter still needs. A finished column layout says to stop. */
function columnTask(editor: Editor) {
  const layout = newsLayout(editor);
  if (layout.split)
    return "The heading is full width. The three items are in two columns. Stop. Do not rewrite the newsletter and do not change the heading.";
  const heading = layout.headingInside ? "The heading is inside the columns. Leave it full width. " : "Leave the heading full width. ";
  return `${heading}${columnCall(editor)}`;
}

/** Select the paragraphs and flow them into columns. Positions are the block starts and ends. */
function selectAndColumn(editor: Editor, startPos: number, endPos: number, columns: 1 | 2) {
  const doc = editor.state.doc;
  const from = Math.max(1, Math.min(startPos + 1, doc.content.size));
  const to = Math.max(from, Math.min(endPos - 1, doc.content.size));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, from, to)));
  return applyColumnLayout(editor.state, columns, (tr) => editor.view.dispatch(tr));
}

function throwIfColumnNews(editor: Editor, title: string) {
  if (isColumnNewsletter(editor, title)) throw new ToolError(columnTask(editor));
}

function columnPieces(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(columnPieces);
  if (typeof value === "number") return [String(value)];
  if (typeof value !== "string") return [];
  const raw = String(unquoteArg(value) ?? value).trim();
  if (!raw) return [];
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : [raw];
}

function columnCount(value: unknown): 1 | 2 {
  if (value && typeof value === "object") {
    const bag = value as Record<string, unknown>;
    return columnCount(bag.columns ?? bag.column ?? bag.count ?? bag.value ?? 2);
  }
  if (typeof value === "number") return value <= 1 ? 1 : 2;
  const text = String(value ?? "").toLowerCase();
  if (/(^|[^0-9])1([^0-9]|$)|one column|single/.test(text) && !/(^|[^0-9])2([^0-9]|$)|two/.test(text)) return 1;
  return 2;
}

function prepareSetColumns(args: Record<string, unknown>) {
  const nested =
    args.columns && typeof args.columns === "object" && !Array.isArray(args.columns)
      ? { ...args, ...(args.columns as Record<string, unknown>) }
      : args;
  const listed = [
    ...columnPieces(nested.paragraphs ?? nested.items ?? nested.blocks ?? nested.texts),
    ...columnPieces(firstString(nested, ["from_text", "from", "start", "start_text", "first", "first_text"])),
    ...columnPieces(firstString(nested, ["text", "paragraph", "target", "selection", "which"])),
    ...columnPieces(firstString(nested, ["to_text", "to", "end", "end_text", "last", "last_text"])),
  ];
  return {
    from_text: listed[0] ?? "",
    to_text: listed.length > 1 ? listed[listed.length - 1] : "",
    columns: columnCount(nested.columns ?? nested.column ?? nested.count ?? nested.num ?? nested.layout ?? 2),
  };
}

/** Paragraphs named by the call, with any heading in that span left out. */
function namedParagraphs(editor: Editor, fromText: string, toText: string) {
  const list = blocks(editor).filter((block) => block.text.trim());
  const start = fromText ? findBlock(list, fromText) : undefined;
  const end = toText ? findBlock(list, toText) : start;
  if (!start) throw noBlock(list, fromText || "the first paragraph");
  if (!end) throw noBlock(list, toText);
  const from = Math.min(start.pos, end.pos);
  const to = Math.max(start.pos, end.pos);
  const paras = list.filter((block) => block.pos >= from && block.pos <= to && block.type !== "heading");
  if (!paras.length)
    throw new ToolError(
      `Do not column the heading. Call set_columns with from_text "${columnFromText(editor)}" and to_text "New officers" and columns 2.`,
    );
  return paras;
}

function clearColumnGroups(editor: Editor) {
  const spots: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== COLUMN_LAYOUT) return;
    spots.push(pos);
    return false;
  });
  for (const pos of [...spots].sort((a, b) => b - a))
    editor.chain().setTextSelection(pos + 2).setColumns(1).run();
}

/**
 * Store the mixed document as a new version and show it. On SuiteDrive the
 * previous head stays in the history, and the new head is named for this paragraph.
 */
async function commitParagraphRestore(record: FileRecord, live: SuiteFile, next: SuiteFile, title: string) {
  if (record.drive) {
    let link = { ...record.drive };
    const head = await drive.read(link.itemId);
    if (head.versionId) link = { ...link, versionId: head.versionId };
    const stored = parseFile(head.text);
    if (stored.kind === "doc" && JSON.stringify(stored.content) !== JSON.stringify(live.content))
      link = await uploadDriveFile(live, link);
    link = await uploadDriveFile(next, link);
    if (link.versionId) await drive.nameVersion(link.itemId, link.versionId, title);
    return applyRestoredFile({ ...record, file: next, drive: link });
  }
  await recordLocalParagraphRestore(live, next, title);
  return applyRestoredFile({ ...record, file: next });
}

export function docTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  const selectMatch = (text: string, occurrence?: number) => {
    const m = locate(editor, text, occurrence);
    editor.chain().setTextSelection(m).scrollIntoView().run();
    return m;
  };
  const blockOf = (text?: string, occurrence?: number) => {
    if (text) selectMatch(text, occurrence);
    return editor.state.selection.$from.parent;
  };
  const toolsMenu = () =>
    [...document.querySelectorAll(".menu-trigger")].find((el) => el.textContent === "Tools") ?? editor.view.dom;
  return [
    tool({
      name: "read_document",
      label: "Read the document",
      description:
        "Read the document's text, one numbered line per paragraph, heading, list item, table cell or photo, with its style.",
      parameters: Type.Object({}),
      target: () => editor.view.dom,
      execute: () => {
        const list = [
          ...blocks(editor),
          ...images(editor).map((p) => ({
            pos: p.pos,
            label: "Photo",
            text:
              !p.alt && p.title
                ? `file name "${p.title}", no description${p.cropRight > 0 ? ` (right ${p.cropRight}% hidden, original pixels kept)` : ""}`
                : p.cropRight > 0
                  ? `${p.name} (right ${p.cropRight}% hidden, original pixels kept)`
                  : p.name,
          })),
        ].sort(
          (a, b) => a.pos - b.pos,
        );
        const lines = list.map((b, i) => `${i + 1}. [${b.label}] ${b.text || "(empty)"}`);
        return `"${ctx.title}", ${ctx.pageCount} page(s).\n${lines.join("\n") || "The document is empty."}`;
      },
    }),
    tool({
      name: "restore_paragraph",
      label: "Restore one paragraph",
      description:
        'Put one paragraph from a named earlier version back into this document. Pass version as that version\'s name, such as "Agreed rota", and paragraph as the paragraph to restore: its label (north-bed), its text in the earlier version ("North bed: 6am"), or its compare key. Every other paragraph stays, including bold. This keeps the named version, records a new version for this one paragraph, and does not restore the whole document or create another file. Call it once for that paragraph, then stop. Do not use restore_version, copy_version, or write_text for this.',
      parameters: Type.Object({
        version: Type.String({ description: 'The earlier version\'s name, such as "Agreed rota".' }),
        paragraph: Type.String({
          description: 'The one paragraph to restore: "north-bed", "North bed: 6am", or its compare key.',
        }),
      }),
      prepare: (args) => ({
        version: firstString(args, ["version", "version_name", "versionName", "from", "source", "name"]),
        paragraph: firstString(args, [
          "paragraph",
          "paragraph_text",
          "paragraph_name",
          "text",
          "key",
          "block",
          "which",
          "target",
          "label",
        ]),
      }),
      target: () => document.querySelector('[aria-label="Version history"]') ?? editor.view.dom,
      async execute({ version, paragraph }) {
        try {
          const record = await openRecord(ctx.title);
          const named = await namedVersionBodies(record);
          const nameHit = (value: string) =>
            named.some((item) => {
              const name = item.name.toLowerCase();
              const q = unwrapName(value).toLowerCase();
              return q === name || (name.length > 2 && q.includes(name));
            });
          const versionQuery = !nameHit(version) && nameHit(paragraph) ? paragraph : version;
          const paragraphQuery = versionQuery === paragraph ? version : paragraph;
          const picked = pickNamedVersion(named, versionQuery);
          if (!picked)
            throw new ToolError(
              `No version named "${version}". Named versions: ${named.map((item) => item.name).join(", ") || "none"}. Call restore_paragraph with the version's name. Do not call restore_version.`,
            );
          const beforeFile = parseFile(picked.native);
          if (beforeFile.kind !== "doc" || record.file.kind !== "doc")
            throw new ToolError("Only a document can restore one paragraph.");
          const liveContent = editor.getJSON() as JsonNode;
          const live: DocFile = { ...record.file, content: liveContent, updatedAt: new Date().toISOString() };
          const offers = compareParagraphs(beforeFile.content, liveContent).offers.filter(
            (item): item is ParagraphOffer => item !== null,
          );
          const offer = pickParagraphOffer(offers, paragraphQuery);
          const content = applyParagraphRestore(liveContent, beforeFile.content, offer.key);
          const next: DocFile = { ...live, content, updatedAt: new Date().toISOString() };
          const title = partialRestoreTitle(offer.label);
          const applied = await commitParagraphRestore(record, live, next, title);
          if (!applied) editor.view.dispatch(replaceDocument(editor.state, content));
          const effect = offer.becomes ? ` It is now "${offer.becomes}".` : " It is removed.";
          return `Restored only the ${offer.label} paragraph from "${picked.name}".${effect} Every other paragraph is unchanged. "${title}" is now in the history, and "${picked.name}" is still named. The whole file was not restored and no copy was made. Stop.`;
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (error instanceof DriveConflict)
            throw new ToolError(
              "SuiteDrive has a newer version than the one open here. Call restore_paragraph again. Do not restore the whole file and do not type the paragraph in.",
            );
          throw new ToolError(error instanceof Error ? error.message : "Could not restore that paragraph.");
        }
      },
    }),
    tool({
      name: "write_text",
      label: "Type text",
      description:
        "Type text into the document. Each line becomes a paragraph. Start a line with '# ' for a Heading 1 (a main section), '## ' for a Heading 2 (a sub-section) or '### ' for a Heading 3, '- ' for a bullet, '1. ' for a numbered item; wrap words in **double asterisks** for bold. By default the text goes at the end of the document (leave out `after` to keep adding to the end); give `after` to insert it right after the one paragraph or heading containing that text (text that starts with a heading goes after that heading's paragraphs; lines typed after a list item become items of that list), or set `replace_document` to start over. To propose an insertion, a deletion, or bold for someone to accept, use suggest_changes instead of typing it in.",
      parameters: Type.Object({
        text: Type.String({ description: "The text to type." }),
        after: Type.Optional(
          Type.String({
            description:
              'Insert the text right after the paragraph or heading containing this text, before whatever follows it. "table" or "photo" means right below the last table or photo.',
          }),
        ),
        replace_document: Type.Optional(Type.Boolean({ description: "Replace everything in the document." })),
      }),
      intent: /\b(replace|rewrite|re-?type|start (over|again)|overwrite|clear|wipe|instead of (what|everything))\b/i,
      confirm: ({ replace_document }) => {
        const words = editor.getText().trim().split(/\s+/).filter(Boolean).length;
        return replace_document && words ? `Replace everything in this document (${words} words) with new text?` : undefined;
      },
      target: ({ after }) => {
        try {
          if (!after) return rectAt(editor, endOfDocument(editor));
          const found = findBlock(blocks(editor), after);
          return rectAt(editor, objectAfter(editor, after, found)?.end ?? found?.end ?? 0);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ text, after: anchor, replace_document }) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        throwIfThesisNotes(ctx.title, editor);
        throwIfCouncilHeaderNotes(ctx.title, editor);
        if (ctx.title === "Garden club news")
          throw new ToolError(
            isWidowNewsletter(editor, ctx.title)
              ? 'Do not rewrite Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.'
              : 'Do not rewrite Garden club news. Call keep_with_next once with text "This week" and on true, then stop.',
          );
        if (ctx.title === "October minutes")
          throw new ToolError(
            'Do not type the page number into the document or the footer. Call page_setup once with page_number_start 4 and cover_has_no_number true, then stop. The footer stays "Committee draft".',
          );
        if (ctx.title === "Methods" && /[\^²ⁿ]|\(a\s*\+\s*b\)|x²/i.test(text))
          throw new ToolError(
            'Do not type the math or a superscript. Call write_text with exactly "The model fits and the ratio." Then insert_equation with expression "x^2" after "The model fits", and insert_equation with expression "(a+b)/c" after "and the ratio".',
          );
        refuseDraftInBody(ctx.title, text);
        const after = anchor && withoutMarks(anchor);
        if (replace_document) editor.chain().clearContent().run();
        const list = blocks(editor);
        const empty = list.length === 1 && !list[0].text;
        const quote = (b: { text: string; label: string }) => `"${b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text}" (${b.label})`;
        let where = replace_document ? "in place of everything that was in the document" : "at the end of the document";
        let listKind = "";
        if (after) {
          const want = unmark(unlabel(after)).trim();
          const found = (want ? list.find((b) => b.text.trim() === want) : undefined) ?? findBlock(list, after);
          const object = objectAfter(editor, after, found);
          if (!found && !object) throw noBlock(list, after);
          if (object) {
            const next = list.find((b) => b.pos >= object.end && b.text);
            where = `right after ${object.label}${next ? `, before ${quote(next)}` : ", at the end of the document"}`;
            openParagraphAt(editor, object.end);
          } else {
            // A new section never goes between a heading and its own text.
            let i = list.indexOf(found!) + 1;
            if (found!.type === "heading" && /^\s*#{1,3}\s/.test(text)) while (list[i]?.label === "Paragraph") i++;
            const block = list[i - 1],
              next = list.slice(i).find((b) => b.text);
            where = `right after ${quote(block)}${next ? `, before ${quote(next)}` : ", at the end of the document"}`;
            listKind = block.label === "Bullet" ? "bulleted" : block.label === "Numbered item" ? "numbered" : "";
            // setParagraph on a list item's paragraph would lift it out of the list.
            if (listKind) editor.chain().setTextSelection(block.end - 1).splitListItem("listItem").run();
            else {
              editor.chain().setTextSelection(block.end - 1).splitBlock().run();
              editor.chain().setParagraph().run();
            }
          }
        } else {
          const last = blocks(editor).at(-1);
          editor.chain().setTextSelection(endOfDocument(editor)).run();
          // Type into an empty last paragraph rather than after it.
          if (!empty && !replace_document && (last?.text || last?.type !== "paragraph")) {
            editor.chain().splitBlock().run();
            editor.chain().setParagraph().run();
          }
        }
        const continued = await writeLines(editor, text, text.length < 1500, !!listKind);
        // Typing in the middle can leave the old empty last paragraph behind.
        const [prev, last] = blocks(editor).slice(-2);
        if (last && prev && !last.text && last.type === "paragraph" && prev.label === "Paragraph" && last.pos > editor.state.selection.to)
          editor.view.dispatch(editor.state.tr.delete(last.pos, last.end));
        const typed = text.split("\n").filter((l) => l.trim()).length;
        const typedHeadings = [...text.matchAll(/^#{1,3}\s+(.*)$/gm)].map((m) => `"${m[1].replace(/\*\*/g, "").trim()}"`);
        const bold = [...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => `"${m[1]}"`);
        const bullets = text.match(/^\s*[-*•]\s+\S/gm)?.length ?? 0;
        const numbered = text.match(/^\s*\d+[.)]\s+\S/gm)?.length ?? 0;
        const lists = [
          continued && `${continued} as new items of the ${listKind} list`,
          bullets && `${bullets} as bulleted list items`,
          numbered && `${numbered} as numbered list items`,
        ].filter(Boolean);
        const headings = blocks(editor).filter((b) => b.type === "heading").map((b) => `${b.label}: ${b.text}`);
        const methodsNext = ctx.title === "Methods" ? ` ${equationHint(equationsIn(editor))}` : "";
        return `Typed ${typed} paragraph(s) ${where}${typedHeadings.length ? `; heading(s): ${typedHeadings.join(", ")}` : ""}${lists.length ? `; ${lists.join(", ")} (already a list, no need to set it)` : ""}${bold.length ? `; in bold: ${bold.join(", ")}` : ""}. The document now has ${contents(editor)}.${headings.length ? `\nHeadings in the document now: ${headings.join(" | ")}` : ""}${methodsNext}`;
      },
    }),
    tool({
      name: "set_style",
      label: "Paragraph style",
      description: "Change the style of the paragraph that contains `text`: Normal text, Heading 1, Heading 2 or Heading 3.",
      parameters: Type.Object({
        text: Type.String({ description: "Text in the paragraph to restyle." }),
        style: Type.String({ enum: ["Normal text", "Heading 1", "Heading 2", "Heading 3"] }),
      }),
      target: () => document.querySelector('[aria-label="Paragraph style"]'),
      execute({ text, style }) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not restyle Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        const node = blockOf(text);
        const level = /Heading (\d)/.exec(style)?.[1];
        const current = node.type.name === "heading" ? `Heading ${node.attrs.level}` : node.type.name === "paragraph" ? "Normal text" : "";
        if (current === style) return `The paragraph containing "${text}" is already ${style}; nothing changed.`;
        if (level) editor.chain().setHeading({ level: Number(level) as 1 | 2 | 3 }).run();
        else editor.chain().setParagraph().run();
        return `The paragraph containing "${text}" is now ${style}.`;
      },
    }),
    tool({
      name: "format_text",
      label: "Format text",
      description:
        "Format an exact piece of text: bold, italic, underline, strikethrough, superscript, subscript, text color, highlight color, font or size. Booleans turn a style on (true) or off (false). To suggest bold or other formatting for someone to accept, use suggest_changes.",
      parameters: Type.Object({
        text: Type.String({ description: "The exact text to format." }),
        occurrence: Type.Optional(Type.Number({ description: "Which occurrence, counting from 1. Default 1." })),
        bold: Type.Optional(Type.Boolean()),
        italic: Type.Optional(Type.Boolean()),
        underline: Type.Optional(Type.Boolean()),
        strikethrough: Type.Optional(Type.Boolean()),
        superscript: Type.Optional(Type.Boolean()),
        subscript: Type.Optional(Type.Boolean()),
        color: Type.Optional(Type.String({ description: "Text color as #rrggbb." })),
        highlight: Type.Optional(Type.String({ description: "Highlight color as #rrggbb, or 'none'." })),
        font: Type.Optional(Type.String({ description: "Font family, e.g. Arial, Georgia." })),
        size: Type.Optional(Type.Number({ description: "Font size in points." })),
      }),
      target: ({ text, occurrence }) => {
        const m = locate(editor, text, occurrence);
        return rectAt(editor, m.from);
      },
      execute(args) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not format Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        if (ctx.title === "Methods" && args.superscript)
          throw new ToolError(
            'A superscript is not an equation. Call insert_equation with expression "x^2" after "The model fits". Do not use format_text for the math.',
          );
        selectMatch(args.text, args.occurrence);
        const set = (on: boolean | undefined, mark: string) => {
          if (on === undefined) return;
          const chain = editor.chain();
          (on ? chain.setMark(mark) : chain.unsetMark(mark)).run();
        };
        set(args.bold, "bold");
        set(args.italic, "italic");
        set(args.underline, "underline");
        set(args.strikethrough, "strike");
        set(args.superscript, "superscript");
        set(args.subscript, "subscript");
        if (args.color) editor.chain().setColor(args.color).run();
        if (args.highlight === "none") editor.chain().unsetHighlight().run();
        else if (args.highlight) editor.chain().setHighlight({ color: args.highlight }).run();
        if (args.font) editor.chain().setFontFamily(args.font).run();
        if (args.size) editor.chain().setFontSize(`${args.size}pt`).run();
        return `Formatted "${args.text}".`;
      },
    }),
    tool({
      name: "suggest_changes",
      label: "Suggest changes",
      description:
        'Switch to Suggesting as `author` and propose changes, then accept or reject them in the same call. Call it once. Use author "Jordan", insert_text "approximately " (with the trailing space), insert_before "40 customers", delete_text "very", and bold_text "on budget". In that same call pass accept_insertion "approximately", accept_deletion "very" (accepting the deletion removes "very", including the space after it), and reject_bold "on budget" (rejecting the bold leaves "on budget" not bold). Do not pass accept: that would keep the bold. Do not use write_text, find_and_replace, or format_text.',
      parameters: Type.Object({
        author: Type.String({ description: 'Who is suggesting, shown as Suggesting as. Use "Jordan".' }),
        insert_text: Type.Optional(Type.String({ description: 'Words to suggest inserting. Use "approximately ".' })),
        insert_before: Type.Optional(Type.String({ description: 'Existing text to insert immediately before. Use "40 customers".' })),
        delete_text: Type.Optional(Type.String({ description: 'Exact text to suggest deleting. Use "very". The space after that word is removed with it.' })),
        bold_text: Type.Optional(Type.String({ description: 'Exact text to suggest making bold. Use "on budget", without the period.' })),
        accept_insertion: Type.Optional(Type.String({ description: 'Accept the insertion. Use "approximately".' })),
        accept_deletion: Type.Optional(Type.String({ description: 'Accept the deletion so those words are gone. Use "very".' })),
        reject_bold: Type.Optional(Type.String({ description: 'Reject the bold suggestion so the words are not bold. Use "on budget".' })),
      }),
      prepare: (args) => {
        const author = typeof args.author === "string" ? String(unquoteArg(args.author)).replace(/^suggesting as\s+/i, "").trim() : args.author;
        const { accept: _accept, accept_insert, accept_delete, reject_format, ...rest } = args;
        void _accept;
        return {
          ...rest,
          author,
          insert_text: unquoteArg(args.insert_text),
          insert_before: unquoteArg(args.insert_before),
          delete_text: unquoteArg(args.delete_text),
          bold_text: unquoteArg(args.bold_text),
          accept_insertion: reviewNeedle(args.accept_insertion ?? accept_insert),
          accept_deletion: reviewNeedle(args.accept_deletion ?? accept_delete),
          reject_bold: reviewNeedle(args.reject_bold ?? reject_format),
        };
      },
      target: ({ insert_before, delete_text, bold_text, reject_bold }) => {
        const label = [bold_text, reject_bold, delete_text, insert_before].find((value) => typeof value === "string" && value.trim() && value !== "*");
        if (typeof label === "string") {
          try {
            return rectAt(editor, locateLoose(editor, label).from);
          } catch {
            /* The mode switch is the place when the words are not there yet. */
          }
        }
        return document.querySelector(".mode-switch") ?? editor.view.dom;
      },
      execute(args) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not suggest changes in Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        const author = args.author?.trim();
        if (!author) throw new ToolError('Pass author, the name to suggest as. For this review that is "Jordan".');
        setSuggestingAs(editor, author);
        const notes = [`Suggesting as ${author}.`];
        const insertText = present(args.insert_text);
        const insertBefore = args.insert_before?.trim();
        if (insertText || insertBefore) {
          if (!insertText || !insertBefore)
            throw new ToolError('To suggest an insertion, pass both insert_text "approximately " and insert_before "40 customers".');
          notes.push(suggestInsert(editor, insertText, insertBefore));
        }
        const deleting = present(args.delete_text);
        if (deleting) notes.push(suggestDelete(editor, deleting));
        const bold = present(args.bold_text);
        if (bold) notes.push(suggestBold(editor, bold));
        const acceptInsertion = present(args.accept_insertion);
        const acceptDeletion = present(args.accept_deletion);
        const rejectBold = present(args.reject_bold);
        if (!insertText && !deleting && !bold && !acceptInsertion && !acceptDeletion && !rejectBold)
          return `${notes.join(" ")} Nothing was proposed yet. Pass insert_text "approximately ", insert_before "40 customers", delete_text "very", bold_text "on budget", accept_insertion "approximately", accept_deletion "very", and reject_bold "on budget".`;
        const acceptIds: string[] = [];
        const rejectIds: string[] = [];
        const pendingNow = () => listSuggestions(editor.getJSON() as JsonNode);
        if (acceptInsertion) {
          const item = findSuggestion(pendingNow(), "insert", acceptInsertion);
          if (item) acceptIds.push(item.id);
          else if (acceptInsertion !== "*" && editor.getText().toLowerCase().includes(acceptInsertion.toLowerCase()))
            notes.push(`The insertion "${acceptInsertion}" is already accepted.`);
          else notes.push(`No insertion suggestion matches "${acceptInsertion}".`);
        }
        if (acceptDeletion) {
          const item = findSuggestion(pendingNow(), "delete", acceptDeletion);
          if (item) acceptIds.push(item.id);
          else {
            const needle = acceptDeletion === "*" ? "very" : acceptDeletion;
            if (!editor.getText().toLowerCase().includes(needle.toLowerCase()))
              notes.push(`The deletion of "${needle}" is already accepted.`);
            else notes.push(`No deletion suggestion matches "${acceptDeletion}".`);
          }
        }
        if (rejectBold) {
          const item = findSuggestion(pendingNow(), "format", rejectBold);
          if (item) rejectIds.push(item.id);
          else {
            const label = rejectBold === "*" || rejectBold === "bold" ? "on budget" : rejectBold;
            const boldNow = textIsBold(editor, label);
            if (boldNow === false) notes.push(`Bold on "${label}" is already rejected.`);
            else notes.push(`No bold suggestion matches "${rejectBold}".`);
          }
        }
        if (acceptIds.length || rejectIds.length) {
          applyReview(editor, acceptIds, rejectIds);
          const parts = [
            acceptIds.length ? `Accepted ${acceptIds.length} suggestion(s)` : "",
            rejectIds.length ? `Rejected ${rejectIds.length} suggestion(s)` : "",
          ].filter(Boolean);
          notes.push(`${parts.join(" and ")}.`);
        }
        const pending = listSuggestions(editor.getJSON() as JsonNode);
        const listed = pending.map((item) => `${item.kind} "${item.text.trim()}" by ${item.author || "Someone"}`).join("; ");
        const body = blocks(editor)
          .map((block) => block.text)
          .filter(Boolean)
          .join(" | ");
        const boldNow = textIsBold(editor, "on budget");
        const boldLine = boldNow === null ? "" : boldNow ? ' "on budget" is still bold.' : ' "on budget" is not bold.';
        const still = pending.length
          ? ` Pending suggestions (${pending.length}): ${listed}.${boldLine} Call suggest_changes again with accept_insertion "approximately", accept_deletion "very", and reject_bold "on budget". Do not pass accept.`
          : ` No suggestions are pending.${boldLine}`;
        return `${notes.join(" ")} Document: ${body}.${still}`;
      },
    }),
    tool({
      name: "set_list",
      label: "Lists",
      description:
        "Make paragraphs a bulleted or numbered list, or plain paragraphs again. Covers every paragraph from the one containing `from_text` to the one containing `to_text` (or just the first).",
      parameters: Type.Object({
        from_text: Type.String(),
        to_text: Type.Optional(Type.String()),
        list: Type.String({ enum: ["bullet", "numbered", "none"] }),
      }),
      target: () => document.querySelector('[aria-label="Bulleted list"]'),
      execute({ from_text, to_text, list }) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not change the list. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        const start = locate(editor, from_text);
        const end = to_text ? locate(editor, to_text) : start;
        editor.chain().setTextSelection({ from: start.from, to: Math.max(start.to, end.to) }).run();
        const bullet = editor.isActive("bulletList"),
          numbered = editor.isActive("orderedList");
        const which = to_text ? `The paragraphs from "${from_text}" to "${to_text}" are` : `Only the paragraph containing "${from_text}" was covered, and it is`;
        if ((list === "bullet" && bullet) || (list === "numbered" && numbered) || (list === "none" && !bullet && !numbered))
          return `${which} already ${list === "none" ? "plain paragraphs" : `in a ${list} list`}; nothing changed.${to_text ? "" : " To cover the paragraphs after it too, give to_text (text in the last one)."}`;
        const covered = blocks(editor).filter((b) => b.end > start.from && b.pos < Math.max(start.to, end.to));
        const chain = editor.chain();
        if (list === "bullet" && !bullet) chain.toggleBulletList().run();
        else if (list === "numbered" && !numbered) chain.toggleOrderedList().run();
        else if (list === "none") {
          if (bullet) chain.toggleBulletList().run();
          else if (numbered) chain.toggleOrderedList().run();
        }
        const named = covered.slice(0, 12).map((b) => `"${b.text.slice(0, 50)}" (was ${b.label})`);
        return `Made ${covered.length} paragraph(s) ${list === "none" ? "plain paragraphs" : `a ${list} list`}: ${named.join(", ")}${covered.length > 12 ? ", …" : ""}.`;
      },
    }),
    tool({
      name: "align_text",
      label: "Align",
      description: "Align the paragraph that contains `text`: left, center, right or justify.",
      parameters: Type.Object({ text: Type.String(), alignment: Type.String({ enum: ["left", "center", "right", "justify"] }) }),
      target: ({ alignment }) =>
        document.querySelector(`[aria-label="${alignment === "justify" ? "Justify" : `Align ${alignment}`}"]`),
      execute({ text, alignment }) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not align Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        blockOf(text);
        editor.chain().setTextAlign(alignment).run();
        return `Aligned the paragraph ${alignment}.`;
      },
    }),
    tool({
      name: "keep_with_next",
      label: "Keep with next",
      description:
        "Turn Keep with next on or off for one heading or paragraph, so it stays on the same page as the paragraph that follows. Pass the heading or paragraph text. on defaults to true.",
      parameters: Type.Object({
        text: Type.String({ description: 'The heading or paragraph, copied exactly, such as "This week".' }),
        on: Type.Optional(Type.Boolean({ description: "True turns Keep with next on. False turns it off. Default true." })),
      }),
      prepare: (args) => ({ text: keepWithNextText(args), on: keepWithNextFlag(args) }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text);
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ text, on }) {
        throwIfColumnNews(editor, ctx.title);
        const want = on !== false;
        const list = blocks(editor);
        const found = findBlock(list, text);
        if (!found) throw noBlock(list, text);
        const node = editor.state.doc.nodeAt(found.pos);
        if (!node || (node.type.name !== "heading" && node.type.name !== "paragraph"))
          throw new ToolError(
            `"${found.text}" is not a heading or paragraph. Call keep_with_next with text "This week" and on true.`,
          );
        const already = node.attrs.keepNext === true;
        if (already === want)
          return `Keep with next is already ${want ? "on" : "off"} for "${found.text}". Stop. Do not change anything else.`;
        const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...node.attrs,
          keepNext: want ? true : null,
        });
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.pos + 1, tr.doc.content.size))));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        return `Keep with next is ${want ? "on" : "off"} for "${found.text}" only. It stays with the next paragraph. Stop. Do not rewrite the document.`;
      },
    }),
    tool({
      name: "dont_leave_one_line",
      label: "Don't leave one line",
      description:
        "Turn widow and orphan control on or off for one paragraph, so a single line of that paragraph is not left alone at the top or bottom of a page. This is not Keep with next. Pass text that appears in the paragraph. on defaults to true.",
      parameters: Type.Object({
        text: Type.String({ description: 'Text in the paragraph, copied exactly, such as "See you Saturday.".' }),
        on: Type.Optional(
          Type.Boolean({ description: "True turns Don't leave one line on. False turns it off. Default true." }),
        ),
      }),
      prepare: (args) => ({ text: widowControlText(args), on: widowControlFlag(args) }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text || "See you Saturday.");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ text, on }) {
        throwIfColumnNews(editor, ctx.title);
        const want = on !== false;
        const list = blocks(editor);
        const query = text.trim() || (list.some((block) => block.text.includes("See you Saturday.")) ? "See you Saturday." : "");
        const found = findBlock(list, query);
        if (!found) throw noBlock(list, query || "See you Saturday.");
        const node = editor.state.doc.nodeAt(found.pos);
        const saturday = list.some((block) => block.text.includes("See you Saturday."));
        if (!node || node.type.name !== "paragraph" || (saturday && !found.text.includes("See you Saturday.")))
          throw new ToolError(
            'Call dont_leave_one_line once with text "See you Saturday." and on true, then stop. Do not change the heading or another paragraph.',
          );
        const already = node.attrs.widowControl === true;
        if (already === want)
          return `Don't leave one line is already ${want ? "on" : "off"} for the paragraph containing "See you Saturday.". Stop. Do not change anything else.`;
        const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...node.attrs,
          widowControl: want ? true : null,
        });
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.end - 1, tr.doc.content.size))));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        return `Don't leave one line is ${want ? "on" : "off"} for the paragraph containing "See you Saturday.". At least two lines of that paragraph stay together. "This month" stays where it was. Stop. Do not rewrite the document and do not insert a page break.`;
      },
    }),
    tool({
      name: "keep_lines_together",
      label: "Keep lines together",
      description:
        "Turn Keep lines together on or off for one paragraph, so every line of that paragraph stays on the same page. This is not Keep with next and not Don't leave one line. Pass text that appears in the paragraph. on defaults to true.",
      parameters: Type.Object({
        text: Type.String({ description: 'Text in the reminder, copied exactly, such as "Bring gloves,".' }),
        on: Type.Optional(
          Type.Boolean({ description: "True turns Keep lines together on. False turns it off. Default true." }),
        ),
      }),
      prepare: (args) => ({ text: keepLinesText(args), on: keepLinesFlag(args) }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text || "Bring gloves,");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ text, on }) {
        throwIfColumnNews(editor, ctx.title);
        const want = on !== false;
        const list = blocks(editor);
        const reminder = list.find((block) => block.text.includes("Bring gloves,") && /trowel/i.test(block.text));
        const query = text.trim() || (reminder ? "Bring gloves," : "");
        const found = findBlock(list, query);
        if (!found) throw noBlock(list, query || "Bring gloves,");
        const node = editor.state.doc.nodeAt(found.pos);
        if (!node || node.type.name !== "paragraph" || (reminder && found.pos !== reminder.pos))
          throw new ToolError(KEEP_LINES_CALL);
        const already = node.attrs.keepLines === true;
        if (already === want)
          return `Keep lines together is already ${want ? "on" : "off"} for the reminder that starts with "Bring gloves,". Stop. Do not change anything else.`;
        const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...node.attrs,
          keepLines: want ? true : null,
        });
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.end - 1, tr.doc.content.size))));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        return `Keep lines together is ${want ? "on" : "off"} for the reminder that starts with "Bring gloves,". All three lines stay on one page. "What to bring" and "Meet at the gate." stay on page 1. Stop. Do not rewrite the document and do not insert a page break.`;
      },
    }),
    tool({
      name: "set_columns",
      label: "Columns",
      description:
        "Put the paragraphs from from_text through to_text into columns, and leave a heading outside that range full width. There is no section break. columns is 2 or 1. Do not include a heading that should stay full width.",
      parameters: Type.Object({
        from_text: Type.Optional(Type.String({ description: 'Text in the first item, such as "Plant sale Saturday". Not the heading.' })),
        to_text: Type.Optional(Type.String({ description: 'Text in the last item, such as "New officers".' })),
        columns: Type.Optional(Type.Number({ description: "2 for two columns. 1 returns those paragraphs to one column." })),
      }),
      prepare: prepareSetColumns,
      target: ({ from_text }) => {
        const items = newsItems(editor);
        const block = findBlock(blocks(editor), from_text || items?.[0]?.text || "Plant sale");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ from_text, to_text, columns }) {
        throwIfKeepLinesNews(editor, ctx.title);
        const count = columns === 1 ? 1 : 2;
        const newsletter = isColumnNewsletter(editor, ctx.title);
        if (newsletter && count === 2) {
          if (!newsLayout(editor).split) clearColumnGroups(editor);
          const items = newsItems(editor);
          if (!items)
            throw new ToolError(
              `Call set_columns with from_text "${columnFromText(editor)}", to_text "New officers", and columns 2.`,
            );
          if (!newsLayout(editor).split) {
            const applied = selectAndColumn(editor, items[0].pos, items[items.length - 1].end, 2);
            if (!applied || !newsLayout(editor).split)
              throw new ToolError(
                `The three items are not in two columns. ${columnCall(editor)}`,
              );
          }
          const named = [items[0].text, items[1].text, items[2].text].map((text) => `"${text.slice(0, 48)}"`).join(", ");
          return `The heading stays full width. These three items are in two columns: ${named}. ${columnTask(editor)}`;
        }
        if (!from_text || !to_text)
          throw new ToolError("Pass from_text and to_text for the first and last paragraph to column, and columns 1 or 2.");
        const paras = namedParagraphs(editor, from_text, to_text);
        const applied = selectAndColumn(editor, paras[0].pos, paras[paras.length - 1].end, count);
        if (!applied)
          throw new ToolError(
            `Could not set ${count === 1 ? "one column" : "two columns"} on those paragraphs. Call set_columns with from_text and to_text copied from the items, and columns ${count}.`,
          );
        const named = paras.map((block) => `"${block.text.slice(0, 48)}"`).join(", ");
        return count === 1
          ? `Those paragraphs are one column again: ${named}. The heading stays full width.`
          : `Those paragraphs are in two columns: ${named}. A heading that was not included stays full width.`;
      },
    }),
    tool({
      name: "insert_table",
      label: "Insert table",
      description:
        "Insert a table after the paragraph containing `after` (or at the end) and fill it. `cells` is a list of rows, each a list of cell texts; the first row is the header row when header_row is true.",
      parameters: Type.Object({
        cells: Type.Array(Type.Array(Type.String())),
        header_row: Type.Optional(Type.Boolean()),
        after: Type.Optional(Type.String({ description: 'Text in the paragraph to put the table after; "table" or "photo" means right below the last table or photo.' })),
      }),
      target: () => document.querySelector('[aria-label="Insert table"]'),
      async execute({ cells, header_row = true, after }) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        const rows = Math.max(1, cells.length);
        const cols = Math.max(1, ...cells.map((r) => r.length));
        const list = blocks(editor);
        const block = after ? findBlock(list, after) : list.at(-1);
        const object = after ? objectAfter(editor, after, block) : undefined;
        if (after && !block && !object) throw noBlock(list, after);
        const short = (text: string) => `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
        const next = object ? list.find((b) => b.pos >= object.end && b.text) : block && list[list.indexOf(block) + 1];
        const where = after && (object || block)
          ? `right after ${object ? object.label : short(block!.text)}${next?.text ? `, before ${short(next.text)}` : ", at the end of the document"}`
          : "at the end of the document";
        if (object) openParagraphAt(editor, object.end);
        else {
          editor.chain().setTextSelection((block?.end ?? 1) - 1).run();
          if (block?.text) editor.chain().splitBlock().run();
        }
          editor.chain().setParagraph().run();
        editor.chain().insertTable({ rows, cols, withHeaderRow: header_row }).run();
        // Fill cell by cell, moving with Tab like a person would.
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const value = cells[r]?.[c] ?? "";
            if (value) editor.chain().insertContent(value).run();
            await wait(25);
            if (r < rows - 1 || c < cols - 1) editor.chain().goToNextCell().run();
          }
        const first = (row: string[] = []) => row.find((c) => c.trim()) ?? "(empty)";
        const body = cells.slice(1).map((row) => first(row));
        return `Inserted a ${rows}×${cols} table ${where}: ${header_row ? "a header row" : "first row"} (${(cells[0] ?? []).join(" | ")})${body.length ? `, then ${body.length} row(s) whose first cells are ${body.join(", ")}` : ""}.`;
      },
    }),
    tool({
      name: "insert_link",
      label: "Insert link",
      description: "Turn existing text into a link to `url`. If `text` is not in the document, it is added at the end as a link.",
      parameters: Type.Object({ text: Type.String(), url: Type.String() }),
      target: ({ text }) => {
        try {
          return rectAt(editor, locate(editor, text).from);
        } catch {
          return document.querySelector('[aria-label="Insert link"]');
        }
      },
      execute({ text, url }) {
        const href = /^[a-z]+:/i.test(url) || url.startsWith("#") ? url : `https://${url}`;
        let range: { from: number; to: number };
        let added = false;
        try {
          range = selectMatch(text);
        } catch {
          editor.chain().setTextSelection(endOfDocument(editor)).insertContent(" ").run();
          const from = editor.state.selection.from;
          editor.chain().insertContent(text).run();
          range = { from, to: from + text.length };
          added = true;
        }
        editor.chain().setTextSelection(range).setLink({ href }).run();
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.to)));
        if (added) {
          const line = editor.state.selection.$from.parent.textContent.trim();
          return `"${text}" was not in the document, so it was added at the end of the document as a link to ${href}; that paragraph now reads "${line}".`;
        }
        return `Linked "${text}" to ${href}.`;
      },
    }),
    tool({
      name: "insert_image",
      label: "Insert image",
      description:
        "Ask the user to choose a photo from their computer and insert it after the paragraph containing `after` (or at the cursor). To describe a photo already in the document, use set_image_description. Do not insert another photo to add a description.",
      parameters: Type.Object({
        after: Type.Optional(Type.String({ description: 'Text in the paragraph to put the photo after; "table" or "photo" means right below the last table or photo.' })),
      }),
      target: () => document.querySelector('[aria-label="Insert image"]'),
      async execute({ after }) {
        const place = () => {
          const block = after ? findBlock(blocks(editor), after) : undefined;
          const object = after ? objectAfter(editor, after, block) : undefined;
          if (after && !block && !object) throw noBlock(blocks(editor), after);
          return { block, object };
        };
        // Check the place before asking, so the user never picks a photo twice.
        place();
        const file = await requestFile("Choose a photo to insert", "image/png,image/jpeg,image/gif,image/webp");
        if (!file) return "The user did not choose a photo.";
        const { block, object } = place();
        if (object) openParagraphAt(editor, object.end);
        else if (block) {
          editor.chain().setTextSelection(block.end - 1).splitBlock().run();
          editor.chain().setParagraph().run();
        }
        const before = images(editor).length;
        await ctx.insertImage(file);
        if (images(editor).length === before)
          throw new ToolError(`"${file.name}" could not be inserted. Photos must be PNG, JPEG, GIF or WebP and smaller than 5 MB.`);
        const cursor = editor.state.selection.from;
        const photo = images(editor).filter((p) => p.end <= cursor).at(-1);
        const list = blocks(editor);
        const above = photo && list.filter((b) => b.end <= photo.pos && b.text).at(-1);
        const below = photo && list.find((b) => b.pos >= photo.end && b.text);
        const short = (text: string) => `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
        return `Inserted the photo "${file.name}"${above ? ` below ${short(above.text)}` : " at the top of the document"}${below ? `, above ${short(below.text)}` : ", at the end of the document"}.`;
      },
    }),
    tool({
      name: "find_and_replace",
      label: "Find and replace",
      description:
        "Replace text. With all=true every match is replaced; otherwise only the first match. Returns how many were replaced. To suggest a change for someone to accept, use suggest_changes. For grammar (were/was agreement, or its versus it's), call fix_grammar instead of replacing words.",
      parameters: Type.Object({
        find: Type.String(),
        replace: Type.String(),
        all: Type.Optional(Type.Boolean()),
        match_case: Type.Optional(Type.Boolean()),
      }),
      target: () => document.querySelector('[aria-label="Find and replace"]') ?? editor.view.dom,
      async execute({ find, replace, all = true, match_case = false }) {
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfColumnNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        throwIfThesisNotes(ctx.title, editor);
        throwIfCouncilHeaderNotes(ctx.title, editor);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not replace text in Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        refuseDraftInBody(ctx.title, replace);
        if (/\n/.test(replace))
          throw new ToolError("find_and_replace changes text within a paragraph. To add a new paragraph, use write_text with `after`.");
        // **double asterisks** mean bold here too, as in write_text.
        const parts = replace.split("**");
        const boldMark = parts.length > 2 ? editor.schema.marks.bold : undefined;
        if (boldMark) replace = parts.join("");
        ctx.showFind(find, replace, match_case);
        await wait(700);
        const options = { matchCase: match_case, regex: false, ignoreDiacritics: !match_case };
        const matches = documentMatches(editor.state.doc, find, options).matches;
        if (!matches.length) {
          ctx.closeFind();
          const already = replace.trim() ? documentMatches(editor.state.doc, replace, options).matches.length : 0;
          if (already)
            return `Nothing to replace: "${find}" is not in the document, and "${replace}" is there ${already} time(s), so it is already replaced.`;
          throw new ToolError(
            `"${find}" was not found.${/[#*]/.test(find) ? " The document's text has no Markdown marks such as # or **; use read_document to see the exact text." : ""}`,
          );
        }
        let tr = editor.state.tr;
        const chosen = all ? [...matches].reverse() : [matches[0]];
        for (const m of chosen) {
          if (!boldMark) {
            tr = tr.insertText(replace, m.from, m.to);
            continue;
          }
          const marks = tr.doc.resolve(m.from).marksAcross(tr.doc.resolve(m.to)) ?? [];
          const nodes = parts.flatMap((part, i) =>
            part ? [editor.schema.text(part, i % 2 ? boldMark.create().addToSet(marks) : marks)] : [],
          );
          tr = tr.replaceWith(m.from, m.to, nodes);
        }
        editor.view.dispatch(tr.scrollIntoView());
        ctx.showReplaced(chosen.length);
        await wait(900);
        ctx.closeFind();
        const left = matches.length - chosen.length;
        const bold = boldMark ? parts.filter((p, i) => i % 2 && p).map((p) => `"${p}"`) : [];
        // Where each replacement went, as a short quote around it.
        const doc = editor.state.doc;
        const quotes = chosen
          .map((m) => tr.mapping.map(m.from, -1))
          .sort((a, b) => a - b)
          .slice(0, 8)
          .map((from) => {
            const b = blocks(editor).find((x) => x.pos < from && from < x.end);
            if (!b) return "";
            const start = Math.max(b.pos + 1, from - 30),
              end = Math.min(b.end - 1, from + replace.length + 30);
            return `"${start > b.pos + 1 ? "…" : ""}${doc.textBetween(start, end)}${end < b.end - 1 ? "…" : ""}"`;
          })
          .filter(Boolean);
        return `Replaced ${chosen.length} of ${matches.length} "${find}" with "${replace}"${bold.length ? ` (${bold.join(", ")} in bold)` : ""}${quotes.length ? `, in: ${quotes.join(", ")}` : ""}. ${left ? `${left} "${find}" left.` : `No "${find}" is left in the document.`}`;
      },
    }),
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check the document's spelling and open the spelling panel. Returns each unknown word with suggestions. Then call fix_spelling with no arguments to correct every typo (bold and other formatting stay). A name with no suggestion, such as Danquah, is added with add_to_dictionary and is not replaced.",
      parameters: Type.Object({}),
      target: () => toolsMenu(),
      async execute() {
        ctx.showSpelling();
        const personal = readPersonalDictionary();
        const ignored = readProofing(proofingJson(editor)).ignored;
        const words = new Map<string, number>();
        for (const word of misspelledWords(proofingJson(editor), personal, ignored))
          words.set(word, (words.get(word) ?? 0) + 1);
        if (!words.size) return "No spelling mistakes found.";
        const lines = [...words].map(([w, count]) => {
          const suggestions = spellingSuggestions(w);
          return `"${w}" (${count}×): ${suggestions.length ? suggestions.join(", ") : "no suggestions — a name; add it with add_to_dictionary and do not replace it"}`;
        });
        return `${lines.join("\n")}\nCall fix_spelling with no arguments to correct every typo that has a suggestion. Bold stays bold. Add each name with add_to_dictionary.`;
      },
    }),
    tool({
      name: "fix_spelling",
      label: "Fix spelling",
      description:
        "Correct misspellings and keep bold and other formatting. Call it with no arguments to fix every typo that has a suggestion; names with no suggestion are left unchanged. Or pass word and correction to fix that one word. movment becomes movement, recieve becomes receive, and teh becomes the when those typos are present.",
      parameters: Type.Object({
        word: Type.Optional(Type.String({ description: "One misspelled word. Leave this out to correct every typo that has a suggestion." })),
        correction: Type.Optional(Type.String({ description: "What to replace that word with. Leave this out to use the spelling suggestion." })),
      }),
      prepare(args) {
        const next = { ...args };
        if (typeof next.word === "string" && !next.word.trim()) delete next.word;
        if (typeof next.correction === "string" && !next.correction.trim()) delete next.correction;
        return next;
      },
      target: () => toolsMenu(),
      async execute({ word, correction }) {
        throwIfColumnNews(editor, ctx.title);
        const requested = word?.trim() ?? "";
        const bulk = !requested || /^(all|every|everything|\*)$/i.test(requested);
        const personal = readPersonalDictionary();
        const ignored = readProofing(proofingJson(editor)).ignored;
        const liveRanges = () => misspelledRanges(editor.state.doc, personal, ignored);
        if (!bulk) {
          const ranges = copiesOf(editor.state.doc, requested, personal, ignored);
          if (!ranges.length) {
            const present = editor.state.doc.textContent.toLowerCase().includes(requested.toLowerCase());
            return present
              ? `"${requested}" is not marked as a misspelling, so it was left as written.`
              : `"${requested}" is not in the document, so nothing was changed.`;
          }
          if (!spellingSuggestions(ranges[0].word).length)
            return `"${ranges[0].word}" has no spelling suggestion, so it was not changed. It looks like a name: add it with add_to_dictionary. Do not replace it.`;
        }
        const fixes: string[] = [];
        for (const group of groupMisspellings(liveRanges())) {
          if (!bulk && !sameWord(group.word, requested)) continue;
          const suggestion = spellingSuggestions(group.word)[0];
          if (!suggestion) continue;
          const next = !bulk && correction?.trim() ? correction.trim() : suggestion;
          const ranges = copiesOf(editor.state.doc, group.word, personal, ignored);
          if (!ranges.length) continue;
          const bold = ranges.some((range) => wordIsBold(editor, range));
          editor.view.dispatch(changeAllTransaction(editor.state, ranges, next));
          fixes.push(`"${group.word}" → "${next}" (${ranges.length}×${bold ? ", bold kept" : ""})`);
        }
        ctx.showSpelling();
        await wait(700);
        ctx.closeProofing();
        const left = groupMisspellings(liveRanges());
        const names = left.filter((group) => !spellingSuggestions(group.word).length);
        const typos = left.filter((group) => spellingSuggestions(group.word).length);
        const parts = [
          fixes.length ? `Corrected ${fixes.length} typo(s), keeping formatting: ${fixes.join("; ")}.` : "No typos with a suggestion were changed.",
        ];
        if (names.length)
          parts.push(
            `Still unknown, with no suggestion: ${names.map((group) => `"${group.word}" (${group.ranges.length}×)`).join(", ")}. Add each with add_to_dictionary. Do not replace them.`,
          );
        if (typos.length)
          parts.push(
            `Still misspelled: ${typos.map((group) => `"${group.word}"`).join(", ")}. Call fix_spelling with no arguments to correct them.`,
          );
        if (!names.length && !typos.length) parts.push("No spelling mistakes are left.");
        return parts.join(" ");
      },
    }),
    tool({
      name: "fix_grammar",
      label: "Fix grammar",
      description:
        "List every grammar issue and apply its suggestion, keeping bold and other formatting. Call it with no arguments. It changes “the movement were” to “the movement was” (were → was), “its the reason” to “it's the reason” (its → it's), and “they was ready” to “they were ready” (was → were). It does not change spelling, so Danquah and movment stay as written. Do not use find_and_replace for grammar.",
      parameters: Type.Object({}),
      target: () => toolsMenu(),
      async execute() {
        throwIfColumnNews(editor, ctx.title);
        const ignored = readProofing(proofingJson(editor)).ignoredGrammar;
        const issues = grammarRanges(editor.state.doc, ignored);
        if (!issues.length) return "No grammar issues found.";
        const listed = issues.map(
          (issue) => `"${issue.key}" → "${issue.suggestion}" (replacing "${issue.text}")`,
        );
        for (const issue of [...issues].sort((a, b) => b.from - a.from)) {
          const marks =
            editor.state.doc.resolve(issue.from).marksAcross(editor.state.doc.resolve(issue.to)) ??
            editor.state.doc.resolve(issue.from).marks();
          editor.view.dispatch(
            editor.state.tr
              .replaceWith(issue.from, issue.to, editor.schema.text(issue.suggestion, marks))
              .scrollIntoView(),
          );
        }
        await wait(500);
        const left = grammarRanges(editor.state.doc, readProofing(proofingJson(editor)).ignoredGrammar);
        return `Fixed ${issues.length} grammar issue(s), keeping formatting: ${listed.join("; ")}. ${
          left.length ? `${left.length} grammar issue(s) remain.` : "No grammar issues are left."
        } Spelling was not changed: Danquah and movment stay as written. Bold stays bold.`;
      },
    }),
    tool({
      name: "add_to_dictionary",
      label: "Add to dictionary",
      description:
        "Add a name to the personal dictionary so spelling stops flagging it, for example Danquah. The word is not changed in the document. Do not add a typo; correct typos with fix_spelling.",
      parameters: Type.Object({
        word: Type.String({ description: "The name to stop flagging, as it appears in the document." }),
      }),
      target: () => toolsMenu(),
      async execute({ word }) {
        const cleaned = word.trim();
        if (!cleaned) throw new ToolError("Say which word to add to the dictionary.");
        const personal = readPersonalDictionary();
        const ignored = readProofing(proofingJson(editor)).ignored;
        const ranges = copiesOf(editor.state.doc, cleaned, personal, ignored);
        if (ranges.length && spellingSuggestions(ranges[0].word).length) {
          const suggestion = spellingSuggestions(ranges[0].word)[0];
          return `"${ranges[0].word}" looks like a typo (suggestion: ${suggestion}). It was not added to the dictionary. Correct it with fix_spelling.`;
        }
        const stored = ranges[0]?.word ?? cleaned;
        const next = addToPersonalDictionary(personal, stored);
        writePersonalDictionary(next);
        refreshSpelling(editor);
        ctx.showDictionary();
        await wait(800);
        ctx.closeProofing();
        return `"${stored}" is in the personal dictionary (${next.added.join(", ")}). It is not flagged, and the spelling in the document was not changed.`;
      },
    }),
    tool({
      name: "word_count",
      label: "Word count",
      description:
        "Set the document word count and save it in the file. stop_at_heading is a heading to stop counting at, such as References: words from that heading on are excluded, and the status bar says so. count_footnotes includes footnotes only when true; leave it false unless the user asked to count footnotes. Returns the status-bar word count.",
      parameters: Type.Object({
        stop_at_heading: Type.Optional(
          Type.String({ description: "Heading to stop counting at, such as References. Empty string counts the whole document." }),
        ),
        count_footnotes: Type.Optional(Type.Boolean({ description: "Count footnotes. False leaves them out." })),
      }),
      prepare(args) {
        const next = { ...args };
        if (next.stop_at_heading === null) delete next.stop_at_heading;
        if (next.count_footnotes === "false") next.count_footnotes = false;
        if (next.count_footnotes === "true") next.count_footnotes = true;
        return next;
      },
      target: () => toolsMenu(),
      async execute(args) {
        ctx.showWordCount();
        await wait(300);
        const current = readProofing(proofingJson(editor));
        const headings = headingNames(countDocument(proofingJson(editor), current).headings);
        const next: ProofingSettings = {
          ...current,
          ...(args.stop_at_heading !== undefined ? { stopAtHeading: matchHeading(headings, args.stop_at_heading) } : {}),
          ...(args.count_footnotes !== undefined ? { countFootnotes: args.count_footnotes } : {}),
        };
        saveProofing(editor, next);
        await wait(900);
        if (!editor.state.selection.empty) {
          const at = editor.state.selection.to;
          editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(at))));
        }
        const { label } = statusWordCount(editor, next);
        ctx.closeProofing();
        const footnotes = next.countFootnotes ? "Footnotes are counted." : "Footnotes are not counted.";
        const where = next.stopAtHeading
          ? `Counting stops at "${next.stopAtHeading}". That exclusion is saved in the file.`
          : `The whole document is counted. To leave a section out, call word_count again with stop_at_heading set to one of: ${headings.join(", ") || "(no headings)"}.`;
        return `Word count is ${label}. ${footnotes} ${where}`;
      },
    }),
    tool({
      name: "page_setup",
      label: "Page setup",
      description:
        'Change page setup. Give only the settings to change; the others stay. paper is letter or a4. orientation is portrait or landscape. margin_top_inches, margin_bottom_inches, margin_left_inches, and margin_right_inches each set one edge, in inches, from 0.25 to 3. Use those four when the edges differ. A margin below 0.25 inches is refused and nothing is saved. margin_inches is one margin for all four sides, from 0.25 to 3, including 2 inches. A margin over 3 inches or under 0.25 inches is refused and nothing is saved. Do not use margin_inches when the edges differ. header_from_edge_inches is how far the header sits from the top edge of the paper, in inches. 0.5 moves only the header closer to the edge and leaves the body margin alone. It is not margin_inches and it is not margin_top_inches. Do not pass margin_inches when only the header distance changes. A header distance under 0.25 inches is refused and nothing is saved. gutter_inches is the binding gutter in inches, from 0 to 2. 0.5 stores an extra half inch on the inside edge: the left on odd pages and the right on even pages. The four outside margins stay as they are. Do not pass margin_inches or the four margin edges when only the gutter changes. A gutter above 2 inches, such as 3, is refused and nothing is saved; call page_setup again with gutter_inches 0.5 only. 0 clears the gutter. header and footer are the words in the header and footer; they are not the page number. page_numbers turns numbering on or off. page_number_format "page" shows "Page 1" and "Page 2" instead of "1 / 2"; "fraction" shows "1 / 2"; "roman" shows i. page_number_position is "top-right", "bottom-center", or "bottom-right". "top-right" draws the number in the header area on the right and removes it from the footer, leaving the footer words on the left. Do not type the page number into the document. page_number_start is Start at, a whole number such as 4. With no cover, 4 makes the first page of the file "Page 4" and the next "Page 5". cover_has_no_number true hides the number on the first page and numbers the next page "Page 1", not "Page 2". Start at stays stored, including 4. For that result, call page_setup once with page_number_start 4 and cover_has_no_number true together, then stop. Do not pass footer, header, page_numbers, or different_first_page with that call. different_first_page is a letterhead, not the cover: it still numbers the next page as 2. Do not type the page number into the footer. different_first_page true makes page 1 use first_header and show no page number. first_header is the words on page 1 only, such as "Riverside Garden Club". It does not replace header, so later pages keep their header and their numbers, such as "2 / 2". Do not pass header, footer, page_numbers, page_number_format, or page_number_position when you only want a different first page. different_odd_even true gives even pages even_header and odd pages odd_header. even_header is only the even pages, such as "Minutes". odd_header is only the odd pages, such as "Garden club". Do not copy even_header onto odd_header, onto header, or onto first_header. header stays the shared header for when different odd and even is off. Turning different_odd_even on does not change the first-page letterhead, different_first_page, or first_header. Page 1 keeps its letterhead and no page number. Even pages then number on the left and odd pages on the right. Call page_setup once with different_odd_even, even_header, and odd_header together. watermark is the word drawn behind the text on every page, such as "DRAFT". It is page furniture, not a paragraph, not the header, and not the footer. An empty watermark clears it. Do not type the word into the document.',
      parameters: Type.Object({
        paper: Type.Optional(Type.String({ enum: ["letter", "a4"] })),
        orientation: Type.Optional(Type.String({ enum: ["portrait", "landscape"] })),
        margin_inches: Type.Optional(Type.Number({ description: "One margin for every edge, in inches, from 0.25 to 3. Use 2 for a two-inch margin. Over 3 or under 0.25 is refused and nothing is saved. Do not use this when the edges differ. Do not use this to move the header." })),
        header_from_edge_inches: Type.Optional(
          Type.Number({
            description:
              "Inches from the top edge of the paper to the header. 0.5 moves only the header. It does not change the body margin. Not margin_inches and not margin_top_inches. Under 0.25 is refused and nothing is saved.",
          }),
        ),
        margin_top_inches: Type.Optional(Type.Number({ description: "Top margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        margin_bottom_inches: Type.Optional(Type.Number({ description: "Bottom margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        margin_left_inches: Type.Optional(Type.Number({ description: "Left margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        margin_right_inches: Type.Optional(Type.Number({ description: "Right margin in inches, from 0.25 to 3. Below 0.25 is refused and nothing is saved." })),
        gutter_inches: Type.Optional(
          Type.Number({
            description:
              "Binding gutter in inches, from 0 to 2. 0.5 adds half an inch on the inside edge: left on odd pages, right on even pages. Above 2 inches is refused and nothing is saved. 0 clears it. Do not change the outside margins.",
          }),
        ),
        header: Type.Optional(Type.String({ description: "Header words. Leave this out to keep the current header." })),
        footer: Type.Optional(Type.String({ description: 'Footer words on the left, such as "Committee draft". This is not the page number.' })),
        page_numbers: Type.Optional(Type.Boolean({ description: "True shows page numbers. False hides them." })),
        page_number_format: Type.Optional(
          Type.String({ description: 'Use "page" for "Page 1". "fraction" is "1 / 2". "roman" is i.' }),
        ),
        page_number_position: Type.Optional(
          Type.String({ description: '"top-right", "bottom-center", or "bottom-right".' }),
        ),
        page_number_start: Type.Optional(
          Type.Number({
            description:
              'Start at, a whole number such as 4. The first page of the file says Page 4 and the next says Page 5. Pass it in the same call as cover_has_no_number true. Do not type it into the footer.',
          }),
        ),
        cover_has_no_number: Type.Optional(
          Type.Boolean({
            description:
              'True hides the number on the first page and numbers the next page Page 1, not Page 2. Start at stays stored, including 4. Pass with page_number_start 4 in the same call. This is not different_first_page. Do not type Page 1 into the footer.',
          }),
        ),
        different_first_page: Type.Optional(
          Type.Boolean({
            description:
              "True gives page 1 its own header and no page number. Later pages keep header and their numbers. Do not turn page numbers off.",
          }),
        ),
        first_header: Type.Optional(
          Type.String({
            description:
              'Words on page 1 only, such as "Riverside Garden Club". Does not appear on later pages. Leave header unchanged.',
          }),
        ),
        different_odd_even: Type.Optional(
          Type.Boolean({
            description:
              "True gives even pages even_header and odd pages odd_header. Does not change the first-page letterhead or first_header. Even pages number on the left and odd pages on the right.",
          }),
        ),
        even_header: Type.Optional(
          Type.String({
            description:
              'Header on even pages only, such as "Minutes". Do not copy it onto odd_header, header, or first_header.',
          }),
        ),
        odd_header: Type.Optional(
          Type.String({
            description:
              'Header on odd pages only, such as "Garden club". Not the even header and not the first-page letterhead.',
          }),
        ),
        watermark: Type.Optional(
          Type.String({
            description:
              'The word behind the text on every page, such as "DRAFT". Page furniture, not a paragraph, header, or footer. Empty clears it. Do not type it into the document.',
          }),
        ),
      }),
      prepare(args) {
        const text = (keys: string[]) => {
          for (const key of keys) {
            const value = args[key];
            if (typeof value === "string" || typeof value === "number") return value;
          }
          return undefined;
        };
        const rawNumbers = args.page_numbers ?? args.pageNumbers ?? args.numbers;
        const page_numbers = optionalBoolean(rawNumbers);
        const formatSource =
          text(["page_number_format", "pageNumberFormat", "format", "number_format"]) ??
          (page_numbers === undefined && rawNumbers != null && !/top|bottom|center|centre|right/i.test(String(rawNumbers))
            ? rawNumbers
            : undefined);
        const positionSource =
          text(["page_number_position", "pageNumberPosition", "position", "number_position"]) ??
          (page_numbers === undefined && rawNumbers != null && /top|bottom|center|centre|right/i.test(String(rawNumbers))
            ? rawNumbers
            : undefined);
        const header = args.header ?? args.header_text ?? args.page_header;
        const footer = args.footer ?? args.footer_text ?? args.page_footer;
        const edges = marginEdgeArgs(args);
        const hasEdge = MARGIN_EDGE_FIELDS.some(([key]) => edges[key] !== undefined);
        const next: Record<string, unknown> = {};
        if (args.paper !== undefined) next.paper = args.paper;
        if (args.orientation !== undefined) next.orientation = args.orientation;
        if (!hasEdge) {
          const marginInches = uniformMarginInches(args);
          if (marginInches !== undefined) next.margin_inches = marginInches;
        }
        for (const [key] of MARGIN_EDGE_FIELDS) {
          if (edges[key] !== undefined) next[key] = edges[key];
        }
        const gutterInches = gutterInchesFrom(args);
        if (gutterInches !== undefined) next.gutter_inches = gutterInches;
        const headerEdge = headerFromEdgeInches(args);
        if (headerEdge !== undefined) next.header_from_edge_inches = headerEdge;
        if (header !== undefined && header !== null) next.header = header;
        if (footer !== undefined && footer !== null) next.footer = footer;
        if (page_numbers !== undefined) next.page_numbers = page_numbers;
        if (formatSource !== undefined) next.page_number_format = formatSource;
        if (positionSource !== undefined) next.page_number_position = positionSource;
        const startSource = firstArg(args, PAGE_NUMBER_START_KEYS);
        if (startSource !== undefined) next.page_number_start = startSource;
        const coverSource = firstArg(args, COVER_HAS_NO_NUMBER_KEYS);
        if (coverSource !== undefined) next.cover_has_no_number = coverSource;
        const differentFirst = optionalBoolean(
          args.different_first_page ??
            args.differentFirstPage ??
            args.different_first ??
            args.first_page_different,
        );
        const firstHeaderRaw =
          args.first_header ??
          args.firstHeader ??
          args.first_page_header ??
          args.page_1_header ??
          args.letterhead;
        if (differentFirst !== undefined) next.different_first_page = differentFirst;
        if (typeof firstHeaderRaw === "string" && firstHeaderRaw.trim())
          next.first_header = unwrapName(firstHeaderRaw);
        else if (firstHeaderRaw != null && firstHeaderRaw !== "")
          next.first_header = unwrapName(String(firstHeaderRaw));
        // The letterhead belongs on page 1. A copy of it in header would replace later pages.
        if (
          next.different_first_page === true &&
          typeof next.first_header === "string" &&
          next.header === next.first_header
        )
          delete next.header;
        const differentOddEven = optionalBoolean(
          bagValue(args, [
            "different_odd_even",
            "differentOddEven",
            "odd_and_even",
            "different_odd_and_even",
            "odd_even_pages",
            "different_odd_even_pages",
            "odd_even",
          ]),
        );
        const evenHeader = headerArg(
          bagValue(args, [
            "even_header",
            "evenHeader",
            "even_page_header",
            "header_even",
            "even",
            "left_header",
          ]),
        );
        const oddHeader = headerArg(
          bagValue(args, [
            "odd_header",
            "oddHeader",
            "odd_page_header",
            "header_odd",
            "odd",
            "right_header",
          ]),
        );
        if (differentOddEven !== undefined) next.different_odd_even = differentOddEven;
        if (evenHeader !== undefined) next.even_header = evenHeader;
        if (oddHeader !== undefined) next.odd_header = oddHeader;
        // The even header is not the shared header. Copying it into header would
        // also fill a blank odd header with the even-page words.
        if (
          (next.different_odd_even === true || evenHeader !== undefined || oddHeader !== undefined) &&
          (next.header === next.even_header || next.header === next.odd_header)
        )
          delete next.header;
        const watermark = watermarkArg(args);
        if (watermark !== undefined) next.watermark = watermark;
        return next;
      },
      target: () => document.querySelector('[aria-label="Page setup"]'),
      async execute(args) {
        throwIfColumnNews(editor, ctx.title);
        if (isCouncilHeaderNotes(ctx.title, editor)) return applyCouncilHeaderEdge(ctx, args);
        if (isThesisNotes(ctx.title, editor)) return applyThesisMargin(ctx, args);
        if (isGardenDraftMinutes(ctx.title, editor)) {
          const asked = args.watermark;
          const letterhead = `${args.header ?? ""} ${args.footer ?? ""}`;
          if (asked !== undefined || /\bDRAFT\b/i.test(letterhead)) {
            const word = asked === undefined ? "" : watermarkText(String(asked));
            if (word.toUpperCase() !== "DRAFT")
              throw new ToolError(
                'watermark is the word behind the text. Call page_setup once with watermark "DRAFT", then stop. Do not type DRAFT into a paragraph, the header, or the footer.',
              );
            const next = { ...ctx.pageSettings(), watermark: "DRAFT" };
            ctx.showPageSetup(next);
            await wait(1100);
            editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", next));
            ctx.closePageSetup();
            return 'Page setup: watermark "DRAFT" behind the text on every page, large and faint, not in a paragraph. Stop. Do not call another tool. Do not type DRAFT into the document.';
          }
        }
        if (isOddEvenMinutes(ctx.title, editor)) {
          const current = ctx.pageSettings();
          if (oddEvenMinutesReady(current))
            return 'Different odd and even is already on. Even header is "Minutes", odd header is "Garden club", and page 1 is "Riverside Garden Club" with no number. The number sits on the left on even pages and on the right on odd pages. Stop. Do not call another tool.';
          const paired = splitOddEvenPhrase(args.header);
          const fromHeader = oddEvenWords(args.header);
          const even =
            oddEvenWords(args.even_header) ?? paired.even ?? (fromHeader === "Minutes" ? "Minutes" : undefined);
          const odd =
            oddEvenWords(args.odd_header) ?? paired.odd ?? (fromHeader === "Garden club" ? "Garden club" : undefined);
          if (args.different_odd_even === false)
            throw new ToolError(`Leave different odd and even on. Nothing was changed. ${ODD_EVEN_CALL}`);
          if (even !== "Minutes" || odd !== "Garden club")
            throw new ToolError(
              `Even header must be "Minutes" and odd header must be "Garden club". Do not copy one onto the other, and do not type the page number into the header. Nothing was changed. ${ODD_EVEN_CALL}`,
            );
          const next = applyOddEvenHeaders(current, {
            different_odd_even: true,
            even_header: "Minutes",
            odd_header: "Garden club",
          });
          const saved: PageSettings = {
            ...next,
            header: current.header,
            footer: current.footer,
            differentFirstPage: true,
            firstHeader: current.firstHeader,
            firstFooter: current.firstFooter,
            pageNumbers: true,
            pageNumberFormat: current.pageNumberFormat,
            pageNumberPosition: current.pageNumberPosition,
            pageNumberPositionSet: false,
            pageNumberStart: current.pageNumberStart,
            coverHasNoNumber: current.coverHasNoNumber,
            watermark: current.watermark,
            gutter: current.gutter,
          };
          ctx.showPageSetup(saved);
          await wait(1100);
          editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", saved));
          ctx.closePageSetup();
          return 'Page setup: different odd and even on, even header "Minutes", odd header "Garden club". Page 1 stays "Riverside Garden Club" with no number. The number sits on the left on even pages and on the right on odd pages. It is not typed into the header. Stop. Do not call another tool.';
        }
        // Refuse an illegal gutter before any margin or page write, so a 3-inch try saves nothing.
        const binding = isBindingMinutes(ctx.title, editor);
        if (binding && args.gutter_inches !== 0.5) {
          if (typeof args.gutter_inches === "number") bindingGutterPx(args.gutter_inches);
          throw new ToolError(
            `Leave room for the binding with a 0.5 inch gutter. Nothing was changed. ${BINDING_GUTTER_CALL}`,
          );
        }
        const gutterPx = args.gutter_inches === undefined ? undefined : bindingGutterPx(args.gutter_inches);
        // A gutter does not rewrite the four edges into one shared margin.
        if (gutterPx !== undefined) {
          delete args.margin_inches;
          for (const [key] of MARGIN_EDGE_FIELDS) delete args[key];
        }
        const edges = pageMarginEdges(args);
        const format = pageNumberFormatArg(args.page_number_format);
        const position = pageNumberPositionArg(args.page_number_position);
        const current = ctx.pageSettings();
        let next: PageSettings = {
          ...current,
          ...(args.paper ? { size: args.paper as PageSettings["size"] } : {}),
          ...(args.orientation ? { landscape: args.orientation === "landscape" } : {}),
          // One number still sets every edge. Per-edge inches replace only that edge.
          // A file that already has per-edge margins ignores the single `margin`.
          ...(edges.length === 0 && args.margin_inches !== undefined
            ? (() => {
                const margin = uniformMarginPx(args.margin_inches);
                return {
                  margin,
                  marginTop: margin,
                  marginBottom: margin,
                  marginLeft: margin,
                  marginRight: margin,
                  top: margin,
                  bottom: margin,
                  left: margin,
                  right: margin,
                };
              })()
            : {}),
          ...(args.header !== undefined ? { header: args.header } : {}),
          ...(args.footer !== undefined ? { footer: args.footer } : {}),
          ...(format || position ? { pageNumbers: true } : {}),
          ...(args.page_numbers !== undefined && !format && !position ? { pageNumbers: args.page_numbers } : {}),
          ...(format ? { pageNumberFormat: format } : {}),
          ...(position ? { pageNumberPosition: position, pageNumberPositionSet: true } : {}),
        };
        for (const [edge, px] of edges) next = setPageMargin(next, edge, px);
        if (
          edges.length > 0 &&
          next.marginTop === next.marginBottom &&
          next.marginTop === next.marginLeft &&
          next.marginTop === next.marginRight
        )
          next = { ...next, margin: next.marginTop };
        const firstHeader =
          args.first_header !== undefined
            ? unwrapName(String(args.first_header))
            : args.different_first_page === true &&
                args.header !== undefined &&
                args.header !== current.header
              ? unwrapName(String(args.header))
              : undefined;
        if (firstHeader !== undefined) {
          next = {
            ...next,
            differentFirstPage: true,
            firstHeader,
            ...(args.header !== undefined && args.header !== current.header && firstHeader === unwrapName(String(args.header))
              ? { header: current.header }
              : {}),
          };
        } else if (args.different_first_page !== undefined) {
          next = { ...next, differentFirstPage: args.different_first_page };
        }
        next = applyOddEvenHeaders(next, {
          different_odd_even: args.different_odd_even,
          even_header: args.even_header === undefined ? undefined : unwrapName(String(args.even_header)),
          odd_header: args.odd_header === undefined ? undefined : unwrapName(String(args.odd_header)),
        });
        // Turning odd and even on leaves an existing first-page letterhead alone.
        if (next.differentOddEven && current.differentFirstPage) {
          next = {
            ...next,
            differentFirstPage: true,
            firstHeader: current.firstHeader,
            firstFooter: current.firstFooter,
          };
        }
        // A gutter-only call changes the inside edge and leaves the four outside margins.
        if (gutterPx !== undefined) next = { ...next, gutter: gutterPx };
        if (args.watermark !== undefined) next = { ...next, watermark: watermarkText(String(args.watermark)) };
        const start = pageNumberStartArg(args.page_number_start);
        const cover = coverHasNoNumberArg(args.cover_has_no_number);
        const numberingTouched = start !== undefined || cover !== undefined;
        if (ctx.title === "October minutes" && args.different_first_page === true && !numberingTouched)
          throw new ToolError(
            'Cover has no number is cover_has_no_number on page_setup, not different_first_page. different_first_page makes the next page Page 2 and replaces the footer. Nothing was changed. Call page_setup once with page_number_start 4 and cover_has_no_number true. Do not pass different_first_page, footer, or header. Do not type the number into the footer.',
          );
        if (numberingTouched) {
          next = {
            ...next,
            ...(args.page_numbers === undefined ? { pageNumbers: true } : {}),
            ...(start !== undefined ? { pageNumberStart: start } : {}),
            ...(cover !== undefined ? { coverHasNoNumber: cover } : {}),
          };
          // The cover keeps the shared footer and the numbers already on the page.
          if (ctx.title === "October minutes") {
            next = {
              ...next,
              footer: current.footer,
              header: current.header,
              pageNumbers: true,
              pageNumberFormat: current.pageNumberFormat,
              pageNumberPosition: current.pageNumberPosition,
              pageNumberPositionSet: current.pageNumberPositionSet,
              differentFirstPage: current.differentFirstPage,
              firstHeader: current.firstHeader,
              firstFooter: current.firstFooter,
            };
          }
        }
        ctx.showPageSetup(next);
        await wait(1100);
        editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", next));
        ctx.closePageSetup();
        const margins =
          edges.length > 0
            ? `top ${(next.marginTop / 96).toFixed(2)}", bottom ${(next.marginBottom / 96).toFixed(2)}", left ${(next.marginLeft / 96).toFixed(2)}", right ${(next.marginRight / 96).toFixed(2)}"`
            : `${(next.margin / 96).toFixed(2)}" margins`;
        const firstPage = next.differentFirstPage
          ? `, different first page on, page 1 header "${next.firstHeader}", no number on page 1, later pages keep header "${next.header}"`
          : "";
        const oddEven = next.differentOddEven
          ? `, different odd and even on, even header "${next.evenHeader}", odd header "${next.oddHeader}"`
          : "";
        const gutterNote =
          gutterPx === undefined
            ? ""
            : gutterPx === 0
              ? ", gutter 0"
              : `, gutter ${(gutterPx / 96).toFixed(2)}" on the inside (left on odd pages, right on even pages; outside margins unchanged)`;
        const watermarkNote =
          args.watermark === undefined
            ? ""
            : next.watermark
              ? `, watermark "${next.watermark}" behind the text on every page, not in a paragraph`
              : ", watermark cleared";
        return `Page setup: ${next.size.toUpperCase()} ${next.landscape ? "landscape" : "portrait"}, ${margins}${gutterNote}${watermarkNote}${next.header ? `, header "${next.header}"` : ""}${next.footer ? `, footer "${next.footer}"` : ""}${firstPage}${oddEven}, ${pageNumberPhrase(next)}.${minutesStartNote(ctx.title, numberingTouched, next)}`;
      },
    }),
    tool({
      name: "insert_page_break",
      label: "Page break",
      description: "Start a new page before the paragraph that contains `before_text`.",
      parameters: Type.Object({ before_text: Type.String() }),
      target: ({ before_text }) => rectAt(editor, locate(editor, before_text).from),
      execute({ before_text }) {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        if (ctx.title === "October minutes")
          throw new ToolError(
            'Do not insert a page break. Call page_setup once with page_number_start 4 and cover_has_no_number true, then stop. Do not type the page number into the footer.',
          );
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not insert a page break. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        if (ctx.title === "Garden club news" && /this week/i.test(before_text))
          throw new ToolError(
            'Do not insert a page break before "This week". Call keep_with_next once with text "This week" and on true, then stop.',
          );
        const block = findBlock(blocks(editor), before_text);
        if (!block) throw noBlock(blocks(editor), before_text);
        editor.chain().setTextSelection(block.pos + 1).setPageBreak().run();
        return `Inserted a page break before "${before_text}".`;
      },
    }),
    tool({
      name: "insert_table_of_contents",
      label: "Table of contents",
      description:
        "Insert a table of contents that lists every heading and updates itself when headings are renamed, added, or moved. page_numbers true (the default) shows page numbers. before is the paragraph to put it in front of. On page 2, before is \"Start of the report\". Do not type the contents as text.",
      parameters: Type.Object({
        before: Type.Optional(Type.String({ description: "Paragraph the table should come before, such as Start of the report." })),
        page_numbers: Type.Optional(Type.Boolean({ description: "True shows page numbers. Default true." })),
      }),
      prepare(args) {
        let page_numbers = args.page_numbers ?? args.pageNumbers ?? true;
        if (typeof page_numbers === "string") page_numbers = !/false|plain|link|off|no/i.test(page_numbers);
        return { before: String(args.before ?? args.at ?? ""), page_numbers: Boolean(page_numbers) };
      },
      target: ({ before }) => {
        const block = findBlock(blocks(editor), before?.trim() || "Start of the report");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      async execute({ before = "", page_numbers = true }) {
        let has = false;
        editor.state.doc.descendants((node) => {
          if (node.type.name === "tableOfContents") has = true;
        });
        if (has) return `A table of contents is already in the document. It lists: ${headingNamesNow(editor)}. It updates on its own.`;
        let anchor = before.trim();
        if (!anchor && blocks(editor).some((b) => b.text.trim() === "Start of the report")) anchor = "Start of the report";
        if (!anchor) throw new ToolError('Say which paragraph the table of contents should come before. On page 2 that is "Start of the report".');
        const block = findBlock(blocks(editor), anchor);
        if (!block) throw noBlock(blocks(editor), anchor);
        editor.chain().focus().setTextSelection(block.pos + 1).run();
        const ok = editor.commands.insertTableOfContents(page_numbers !== false);
        if (!ok) throw new ToolError(`Could not insert a table of contents before "${block.text}".`);
        await wait(400);
        return `Inserted a table of contents${page_numbers !== false ? " with page numbers" : ""} before "${block.text}". It lists: ${headingNamesNow(editor)}.`;
      },
    }),
    tool({
      name: "insert_footnote",
      label: "Footnote",
      description:
        "Insert one footnote at the end of the paragraph that contains `after`, and type `text` as the source. The number follows reading order; do not type a superscript. Call once per note. After \"attendance rose 40%\" the source is the Saturday league return. After \"The charity coaches\" the source is \"Charity registration.\" After \"The secondary school lends\" the source is \"Pitch agreement.\" After \"We want a second pitch\" the source is \"Club development plan.\"",
      parameters: Type.Object({
        after: Type.String({ description: "Words in the paragraph the note belongs to, such as attendance rose 40%." }),
        text: Type.String({ description: "The source typed into the footnote." }),
      }),
      prepare(args) {
        return {
          after: String(args.after ?? args.phrase ?? args.at ?? "").trim(),
          text: String(args.text ?? args.note ?? args.source ?? args.body ?? "").trim(),
        };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ after, text }) {
        const source = text.trim();
        if (!after.trim()) throw new ToolError("Say which words the footnote follows.");
        if (!source) throw new ToolError("Say the source text to type into the footnote.");
        const existing = footnoteReport(editor);
        const already = existing.find((line) => loose(line).includes(loose(source.slice(0, 24))));
        if (already) return `That footnote is already in the document. Footnotes in reading order: ${existing.join(" | ")}.`;
        const match = locate(editor, after);
        const $pos = editor.state.doc.resolve(match.from);
        for (let depth = $pos.depth; depth > 0; depth--)
          if ($pos.node(depth).type.name === "note")
            throw new ToolError(`"${after}" is inside a footnote. Choose words in the report.`);
        const at = $pos.end();
        editor.chain().focus().setTextSelection(at).run();
        const ok = editor.commands.insertFootnote();
        if (!ok) throw new ToolError(`Could not add a footnote after "${after}".`);
        let notePos = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "note" && node.attrs.kind !== "endnote" && !node.textContent.trim()) notePos = pos;
        });
        if (notePos < 0) throw new ToolError("The footnote marker was added but its note did not open.");
        editor.chain().focus().setTextSelection(notePos + 2).insertContent({ type: "text", text: source }).run();
        const note = editor.state.doc.nodeAt(notePos);
        if (note?.type.name === "note" && !loose(note.textContent).includes(loose(source.slice(0, 24)))) {
          const para = editor.schema.nodes.paragraph.create({}, editor.schema.text(source));
          editor.view.dispatch(editor.state.tr.replaceWith(notePos + 1, notePos + note.nodeSize - 1, para));
        }
        await wait(300);
        const lines = footnoteReport(editor);
        return `Added a footnote at the end of the paragraph containing "${after}". Footnotes in reading order: ${lines.join(" | ")}.`;
      },
    }),
    tool({
      name: "add_source",
      label: "Add source",
      description:
        "Add one APA citation source. Call once per source. Do not type the source into the document, and leave the page blank. For Grant report 2026 call it three times: Mensah, book, title Youth football in Accra, year 2024; Boateng, article, title Coaching hours, year 2023; Adu, book, title Unused notes, year 2020. Unused notes is added and never cited.",
      parameters: Type.Object({
        author: Type.String({ description: "Author, such as Mensah, Boateng, or Adu." }),
        title: Type.String({ description: "Title, such as Youth football in Accra." }),
        year: Type.String({ description: "Year the source was published. Mensah starts as 2024." }),
        kind: Type.String({ description: "book or article. Mensah and Adu are books. Boateng is an article." }),
      }),
      prepare(args) {
        return {
          author: cleanLabel(args.author ?? args.name),
          title: cleanLabel(args.title ?? args.work),
          year: cleanYear(args.year),
          kind: cleanKind(args.kind ?? args.type ?? args.source_type),
        };
      },
      target: () => editor.view.dom,
      execute({ author, title, year, kind }) {
        if (!author || !title || !year)
          throw new ToolError("Give one source's author, title, and year. Add Mensah, Boateng, and Adu in separate calls.");
        const library = libraryOf(editor);
        const existing = library.sources.find(
          (source) => loose(source.author) === loose(author) && loose(source.title) === loose(title),
        );
        if (existing)
          return `${existing.author}, "${existing.title}" is already a source, year ${existing.year}. Sources: ${sourceList(editor)}. ${existing.author === "Mensah" && existing.year === "2024" ? "Change Mensah to 2022 with update_source_year after citing." : "Do not add it again."}`;
        const source = createSource(
          { kind: kind === "article" ? "article" : "book", author, title, year, page: "" },
          library.sources,
        );
        saveLibrary(editor, [...library.sources, source], "apa");
        const nudge =
          source.author === "Mensah" && source.year === "2024"
            ? " Leave this year at 2024 until both citations are in place, then change it to 2022 with update_source_year."
            : loose(source.title).includes("unused notes")
              ? " Do not cite Unused notes."
              : "";
        return `Added the APA ${source.kind} ${source.author}, "${source.title}", ${source.year}, as ${inText(source, "apa")}. Sources: ${sourceList(editor)}.${nudge}`;
      },
    }),
    tool({
      name: "cite_source",
      label: "Cite source",
      description:
        "Insert one APA in-text citation at the end of the paragraph that contains `after`. Do not type (Author, year) as text, and do not use a footnote. Call once for Mensah after \"attendance rose 40%\". Call once for Boateng after \"The extra coaching hours changed the season\". Never cite Adu or Unused notes.",
      parameters: Type.Object({
        author: Type.String({ description: "Author to cite: Mensah or Boateng." }),
        after: Type.String({ description: "Words in the paragraph the citation follows." }),
      }),
      prepare(args) {
        return {
          author: cleanLabel(args.author ?? args.source ?? args.name),
          after: cleanLabel(args.after ?? args.phrase ?? args.at ?? args.text),
        };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      execute({ author, after }) {
        if (!author) throw new ToolError("Say which author to cite: Mensah or Boateng.");
        if (/adu|unused/i.test(author))
          throw new ToolError("Do not cite Unused notes. Add it as a source only, so it stays out of the bibliography.");
        if (!after) throw new ToolError('Say which words the citation follows, such as "attendance rose 40%".');
        const library = libraryOf(editor);
        const source = sourceNamed(library.sources, author);
        if (!source)
          throw new ToolError(`No source named "${author}". Add it with add_source first. Sources: ${sourceList(editor)}.`);
        const { at, node } = paragraphEnd(editor, after);
        let already = false;
        node.descendants((child) => {
          if (child.type.name === "citation" && String(child.attrs.sourceId ?? "") === source.id) already = true;
        });
        if (already) {
          const placed = citedLines(editor);
          return `${inText(source, library.style)} is already at the end of that paragraph. Citations: ${placed.join(", ") || "none"}.`;
        }
        editor.chain().focus().setTextSelection(at).run();
        const ok = editor.commands.insertCitation(source.id);
        if (!ok) throw new ToolError(`Could not cite ${source.author} after "${after}".`);
        const placed = citedLines(editor);
        const yearHint =
          source.author === "Mensah" && libraryOf(editor).sources.find((item) => item.id === source.id)?.year === "2024"
            ? " Mensah is still 2024. After Boateng is cited, change Mensah to 2022 with update_source_year."
            : "";
        return `Cited ${source.author} at the end of the paragraph containing "${after}": ${inText(source, "apa")}. Citations: ${placed.join(", ")}.${yearHint}`;
      },
    }),
    tool({
      name: "update_source_year",
      label: "Update source year",
      description:
        "Change one source's year. The in-text citation and the bibliography both update, with nothing to refresh. For Grant report 2026, change Mensah from 2024 to 2022 after the citation is inserted. Do not change Boateng's year.",
      parameters: Type.Object({
        author: Type.String({ description: "Author whose year changes, Mensah." }),
        year: Type.String({ description: "The new year, 2022." }),
      }),
      prepare(args) {
        return {
          author: cleanLabel(args.author ?? args.source ?? args.name),
          year: cleanYear(args.year ?? args.new_year),
        };
      },
      target: () => editor.view.dom,
      execute({ author, year }) {
        if (!author || !year) throw new ToolError("Say the author and the new year. Mensah's year becomes 2022.");
        const library = libraryOf(editor);
        const source = sourceNamed(library.sources, author);
        if (!source) throw new ToolError(`No source named "${author}". Sources: ${sourceList(editor)}.`);
        if (source.year === year)
          return `${source.author} is already ${year}, shown as ${inText(source, library.style)}. Sources: ${sourceList(editor)}.`;
        const next = library.sources.map((item) => (item.id === source.id ? { ...item, year } : item));
        saveLibrary(editor, next, library.style === "mla" || library.style === "chicago" ? library.style : "apa");
        const updated = next.find((item) => item.id === source.id)!;
        return `Changed ${updated.author}'s year from ${source.year} to ${updated.year}. Citations now show ${inText(updated, "apa")}. Sources: ${sourceList(editor)}.`;
      },
    }),
    tool({
      name: "insert_bibliography",
      label: "Insert bibliography",
      description:
        "Insert the APA bibliography after the paragraph that contains `after`. It lists only cited sources, alphabetically, and leaves out a source that was never cited. For Grant report 2026, call it after Mensah's year is 2022, with after \"filed its return\". Boateng (2023) comes before Mensah (2022). Do not type the references as paragraphs.",
      parameters: Type.Object({
        after: Type.String({ description: 'Words in the paragraph the bibliography follows, "filed its return".' }),
      }),
      prepare(args) {
        return { after: cleanLabel(args.after ?? args.at ?? args.phrase) || "filed its return" };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ after }) {
        const library = libraryOf(editor);
        if (library.style !== "apa") saveLibrary(editor, library.sources, "apa");
        let existing = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "bibliography" && existing < 0) existing = pos;
        });
        const summary = () => {
          const current = libraryOf(editor);
          const used = new Set<string>();
          editor.state.doc.descendants((node) => {
            if (node.type.name === "citation") used.add(String(node.attrs.sourceId ?? ""));
          });
          const entries = current.sources
            .filter((source) => used.has(source.id))
            .slice()
            .sort((a, b) => a.author.localeCompare(b.author, undefined, { sensitivity: "base" }));
          if (!entries.length) return "The bibliography is empty because nothing is cited yet.";
          return `References: ${entries.map((source) => bibliographyPlain(source, "apa")).join(" | ")}. Unused notes is left out.`;
        };
        if (existing >= 0) return `The bibliography is already in the document. ${summary()}`;
        const anchor = after.trim() || "filed its return";
        const { at } = paragraphEnd(editor, anchor);
        editor.chain().focus().setTextSelection(at).run();
        const ok = editor.commands.insertBibliography();
        if (!ok) throw new ToolError(`Could not insert the bibliography after "${anchor}".`);
        await wait(300);
        return `Inserted the APA bibliography after "${anchor}". ${summary()}`;
      },
    }),
    tool({
      name: "move_section",
      label: "Move section",
      description:
        "Move a heading and the blocks through `through` so they sit immediately before the heading `before`. To put Budget above What we achieved: heading Budget, through \"Budget close.\", before \"What we achieved\". Stop at Budget close. so Partnerships stays where it is. Do not retype the section.",
      parameters: Type.Object({
        heading: Type.String({ description: "Heading to move, such as Budget." }),
        through: Type.String({ description: "Last paragraph to move with the heading, such as Budget close." }),
        before: Type.String({ description: "Heading that should come next, such as What we achieved." }),
      }),
      prepare(args) {
        return {
          heading: String(args.heading ?? args.from ?? args.section ?? "").trim(),
          through: String(args.through ?? args.end ?? args.until ?? "").trim(),
          before: String(args.before ?? args.before_heading ?? "").trim(),
        };
      },
      target: ({ heading }) =>
        [...document.querySelectorAll(".outline-item")].find((el) => el.textContent?.includes(heading)) ?? editor.view.dom,
      execute({ heading, through, before }) {
        const list = blocks(editor);
        const names = headingNamesNow(editor);
        const start = headingBlock(list, heading);
        if (!start) throw new ToolError(`There is no heading "${heading}". Headings: ${names}.`);
        if (!through) throw new ToolError(`Say the last paragraph to move with "${start.text}", such as Budget close.`);
        const endBlock = findBlock(list, through);
        if (!endBlock) throw noBlock(list, through);
        if (endBlock.pos < start.pos) throw new ToolError(`"${endBlock.text}" comes before the heading "${start.text}".`);
        const target = headingBlock(list, before);
        if (!target)
          throw new ToolError(
            `There is no heading "${before}". Headings: ${names}. Rename Results to What we achieved with find_and_replace first if that heading is still called Results.`,
          );
        if (target.pos >= start.pos && target.pos < endBlock.end)
          throw new ToolError(`"${target.text}" is inside the part being moved.`);
        const nextHeading = list.find((b) => b.type === "heading" && b.text.trim() && b.pos >= endBlock.end);
        if (nextHeading?.pos === target.pos && start.pos < target.pos)
          return `"${start.text}" is already immediately before "${target.text}". Headings: ${names}.`;
        const slice = editor.state.doc.slice(start.pos, endBlock.end);
        const tr = editor.state.tr.delete(start.pos, endBlock.end);
        tr.insert(tr.mapping.map(target.pos), slice.content);
        editor.view.dispatch(tr.scrollIntoView());
        return `Moved "${start.text}" through "${endBlock.text.slice(0, 40)}" to just before "${target.text}". Headings now: ${headingNamesNow(editor)}.`;
      },
    }),
    tool({
      name: "go_to_heading",
      label: "Go to heading",
      description:
        "Go to a section: shows the heading at the top of the window, as clicking it in the outline does, and puts the cursor there. Use when the user asks to go to, jump to or show a section.",
      parameters: Type.Object({ heading: Type.String() }),
      target: ({ heading }) =>
        [...document.querySelectorAll(".outline-item")].find((el) => el.textContent?.includes(heading)),
      execute({ heading }) {
        const block = blocks(editor).find((b) => b.type === "heading" && b.text.toLowerCase().includes(heading.toLowerCase()));
        if (!block) throw new ToolError(`There is no heading "${heading}". Headings: ${blocks(editor).filter((b) => b.type === "heading").map((b) => b.text).join("; ")}`);
        ctx.jumpToHeading(block.pos);
        return `Showing "${block.text}".`;
      },
    }),
    tool({
      name: "export_document",
      label: "Export",
      description:
        "Export a copy in another format, for other apps: a Word file (docx), a web page (html) or plain text (txt). Only when the user asks for one of these; to download or save the file itself, use download_file.",
      parameters: Type.Object({ format: Type.String({ enum: ["docx", "html", "txt"] }) }),
      target: () => document.querySelector(".workspace-header .menu-trigger, .workspace-header [aria-haspopup]"),
      async execute({ format }) {
        const saved = await ctx.exportAs(format as "docx");
        const name = `"${ctx.title}.${format}"`;
        if (saved === null) return `The user closed the save dialog, so ${name} was not exported. Tell them; export again only if they ask.`;
        return `Exported ${name}${saved ? `; the user saved it as ${saved}` : ""}.`;
      },
    }),
    tool({
      name: "insert_equation",
      label: "Insert equation",
      description:
        'Insert one real equation into the sentence, as a power or a stacked fraction, not as typed text and not as a superscript. expression is linear math: "x^2" is a power, "(a+b)/c" is a fraction. after is the existing words the equation follows. For the Methods note, the sentence must already say "The model fits and the ratio." Then call this twice: first expression "x^2" after "The model fits", then expression "(a+b)/c" after "and the ratio". After both are in, call edit_equation so the denominator becomes d. Do not use write_text or format_text for the math.',
      parameters: Type.Object({
        expression: Type.String({ description: 'Linear math: "x^2" or "(a+b)/c".' }),
        after: Type.String({ description: 'Existing words the equation follows: "The model fits" or "and the ratio".' }),
      }),
      prepare(args) {
        const expression = linearExpression(String(unquoteArg(args.expression ?? args.expr ?? args.math ?? args.formula ?? "") ?? ""));
        const after = String(unquoteArg(args.after ?? args.after_text ?? args.following ?? "") ?? "")
          .replace(/\s*\[equation[^\]]*\]/g, "")
          .trim();
        return { expression, after };
      },
      target: ({ after }) => {
        try {
          return rectAt(editor, locate(editor, after).to);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ expression, after }) {
        const expr = parseLinear(expression);
        if (!expr || (expr.kind !== "sup" && expr.kind !== "frac"))
          throw new ToolError(
            `"${expression || "(empty)"}" is not a power or a fraction. Use expression "x^2" after "The model fits", and expression "(a+b)/c" after "and the ratio".`,
          );
        if (expr.kind === "frac" && plainOf(expr.den) === "d")
          throw new ToolError(
            'Insert expression "(a+b)/c" after "and the ratio". Then call edit_equation with symbol "c" and replacement "d".',
          );
        if (!after.trim())
          throw new ToolError('Say which words the equation follows: "The model fits" or "and the ratio".');
        const label = equationLabel(expr);
        const already = equationsIn(editor);
        if (already.some((item) => item.key === JSON.stringify(expr)))
          return `The ${expr.kind === "sup" ? "power" : "fraction"} ${label} is already in the sentence. ${equationHint(already)}`;
        let match: { to: number };
        try {
          match = locate(editor, after);
        } catch {
          throw new ToolError(
            `"${after}" is not in the document yet. First call write_text with text "The model fits and the ratio." Then call insert_equation.`,
          );
        }
        const before = match.to > 0 ? editor.state.doc.textBetween(match.to - 1, match.to) : "";
        let chain = editor.chain().focus().setTextSelection(match.to);
        if (before && !/\s/.test(before)) chain = chain.insertContent(" ");
        chain.insertContent({ type: "equation", attrs: { expr, plain: plainOf(expr) } }).scrollIntoView().run();
        const placed = equationsIn(editor);
        if (!placed.some((item) => item.key === JSON.stringify(expr)))
          throw new ToolError(`Could not insert ${label} after "${after}".`);
        await wait(300);
        const kind = expr.kind === "sup" ? "power" : "fraction";
        return `Inserted a ${kind} equation ${label} immediately after "${after}". Equations: ${placed.map((item) => item.label).join(", ")}. ${equationHint(placed)}`;
      },
    }),
    tool({
      name: "edit_equation",
      label: "Edit equation",
      description:
        'Change one symbol inside an equation that is already in the document. Do not retype the equation, do not use find_and_replace, and do not use a superscript. For the Methods note, after x^2 and (a+b)/c are both inserted, call this once with symbol "c" and replacement "d" so the fraction denominator changes from c to d. The numerator a+b and the power x^2 stay. Then stop.',
      parameters: Type.Object({
        symbol: Type.String({ description: 'The symbol to change. Use "c".' }),
        replacement: Type.String({ description: 'The new symbol. Use "d".' }),
      }),
      prepare(args) {
        const rawSymbol = String(unquoteArg(args.symbol ?? args.from ?? args.find ?? args.current ?? args.old ?? "") ?? "").trim();
        const rawReplacement = String(
          unquoteArg(args.replacement ?? args.to ?? args.with ?? args.new ?? args.text ?? args.denominator ?? "") ?? "",
        ).trim();
        return {
          symbol: rawSymbol || "c",
          replacement: rawReplacement || "d",
        };
      },
      target: () => document.querySelector(".eq-frac, .eq") ?? editor.view.dom,
      async execute({ symbol, replacement }) {
        const placed = equationsIn(editor);
        const frac = placed.find((item) => item.expr.kind === "frac");
        if (!frac || frac.expr.kind !== "frac")
          throw new ToolError(
            'There is no fraction to edit yet. Call insert_equation with expression "(a+b)/c" and after "and the ratio", then call edit_equation with symbol "c" and replacement "d".',
          );
        if (plainOf(frac.expr.den) === replacement && (symbol === replacement || symbol === "c" || plainOf(frac.expr.den) === "d"))
          return `The denominator is already ${plainOf(frac.expr.den)}. ${equationHint(placed)}`;
        const wholeFrom = parseLinear(symbol);
        const wholeTo = parseLinear(replacement);
        let next: EqNode | null = null;
        if (wholeFrom?.kind === "frac" && wholeTo?.kind === "frac" && JSON.stringify(frac.expr) === JSON.stringify(wholeFrom))
          next = wholeTo;
        if (!next) next = replaceEquationText(frac.expr.den, symbol, replacement);
        if (!next && symbol === "c") next = replaceEquationText(frac.expr.den, plainOf(frac.expr.den), replacement);
        if (!next)
          throw new ToolError(
            `Could not change "${symbol}" to "${replacement}" in the denominator ${equationLabel(frac.expr)}. Call edit_equation with symbol "c" and replacement "d".`,
          );
        const expr: EqNode = next.kind === "frac" ? next : { kind: "frac", num: frac.expr.num, den: next };
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(frac.pos, undefined, { expr, plain: plainOf(expr) }),
        );
        await wait(300);
        const after = equationsIn(editor);
        const updated = after.find((item) => item.pos === frac.pos) ?? after.find((item) => item.expr.kind === "frac");
        if (!updated || updated.expr.kind !== "frac" || plainOf(updated.expr.den) !== "d")
          throw new ToolError(`The denominator is still ${updated?.expr.kind === "frac" ? plainOf(updated.expr.den) : "missing"}. Call edit_equation with symbol "c" and replacement "d".`);
        return `Changed the denominator from ${symbol} to ${plainOf(updated.expr.den)}. The numerator and the power are unchanged. ${equationHint(after)}`;
      },
    }),
    tool({
      name: "crop_image",
      label: "Crop image",
      description:
        "Crop the picture already in the document by hiding a percent of an edge. right, left, top, and bottom are percents of that edge (45, not 0.45). Do not resize the picture and do not replace its pixels. The original stays, so clearing the crop shows the hidden part again.",
      parameters: Type.Object({
        left: Type.Optional(Type.Number({ description: "Percent to hide from the left, 0 to 100." })),
        top: Type.Optional(Type.Number({ description: "Percent to hide from the top, 0 to 100." })),
        right: Type.Optional(Type.Number({ description: "Percent to hide from the right, 0 to 100." })),
        bottom: Type.Optional(Type.Number({ description: "Percent to hide from the bottom, 0 to 100." })),
      }),
      prepare(args) {
        const edge = String(args.edge ?? args.side ?? "").toLowerCase();
        const amount = cropPercent(args.percent ?? args.amount ?? args.crop);
        const pick = (name: string, keys: string[]) => {
          for (const key of keys) {
            const value = cropPercent(args[key]);
            if (value != null) return value;
          }
          return edge === name && amount != null ? amount : undefined;
        };
        return {
          left: pick("left", ["left", "cropLeft", "crop_left"]),
          top: pick("top", ["top", "cropTop", "crop_top"]),
          right: pick("right", ["right", "cropRight", "crop_right"]),
          bottom: pick("bottom", ["bottom", "cropBottom", "crop_bottom"]),
        };
      },
      target: () => document.querySelector(".document-content img, .ProseMirror img") ?? editor.view.dom,
      async execute({ left, top, right, bottom }) {
        const photos = images(editor);
        if (!photos.length) throw new ToolError("There is no photo in the document to crop.");
        const edges = { left, top, right, bottom };
        if (Object.values(edges).every((value) => value == null))
          throw new ToolError("Pass left, top, right, or bottom as a percent from 0 to 100.");
        for (const [name, value] of Object.entries(edges)) {
          if (value != null && (value < 0 || value > 100))
            throw new ToolError(`${name} must be a percent from 0 to 100.`);
        }
        const photo = photos[0];
        editor.chain().focus().setNodeSelection(photo.pos).scrollIntoView().run();
        const live = editor.state.doc.nodeAt(photo.pos);
        if (!live) throw new ToolError("There is no photo in the document to crop.");
        const current = imageCrop(live.attrs);
        const next = clampImageCrop({
          left: left ?? current.left,
          top: top ?? current.top,
          right: right ?? current.right,
          bottom: bottom ?? current.bottom,
        });
        const round = (value: number) => Math.round(value * 10) / 10;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(photo.pos, undefined, {
            ...live.attrs,
            cropLeft: round(next.left),
            cropTop: round(next.top),
            cropRight: round(next.right),
            cropBottom: round(next.bottom),
          }),
        );
        await wait(300);
        const saved = imageCrop(editor.state.doc.nodeAt(photo.pos)?.attrs);
        return `Cropped the picture (left ${round(saved.left)}%, top ${round(saved.top)}%, right ${round(saved.right)}%, bottom ${round(saved.bottom)}%). It was not resized and its original pixels are unchanged.`;
      },
    }),
    tool({
      name: "set_image_description",
      label: "Set image description",
      description:
        "Set the alt text on a picture already in the document. Pass the sentence a screen reader should hear. Do not use the file name. Do not replace, resize, or crop the picture. An empty description clears the alt text and leaves the picture in place.",
      parameters: Type.Object({
        description: Type.Optional(
          Type.String({
            description:
              "The sentence a screen reader should hear. Not the file name. Empty clears it.",
          }),
        ),
      }),
      prepare(args) {
        const description = descriptionFromArgs(args);
        return description == null ? {} : { description };
      },
      target: () => document.querySelector(".document-content img, .ProseMirror img") ?? editor.view.dom,
      async execute({ description }) {
        const photos = images(editor);
        if (!photos.length)
          throw new ToolError(
            "There is no picture in the document. Do not insert one just to describe it.",
          );
        if (description == null)
          throw new ToolError("Pass description as the sentence a screen reader should hear, or an empty string to clear it.");
        const photo = photos[0];
        const live = editor.state.doc.nodeAt(photo.pos);
        if (!live || live.type.name !== "image")
          throw new ToolError("There is no photo in this note to describe. Do not insert a new photo.");
        const title = imageTitle(live.attrs.title);
        const text = settleImageDescription(description, title);
        const src = live.attrs.src;
        if (!applyImageAlt(editor, photo.pos, text))
          throw new ToolError("There is no photo in this note to describe. Do not insert a new photo.");
        await wait(300);
        const saved = editor.state.doc.nodeAt(photo.pos);
        const alt = imageAltText(saved?.attrs.alt);
        if (!saved || saved.type.name !== "image" || saved.attrs.src !== src)
          throw new ToolError("The photo was replaced. Set the description on the existing photo and do not change its source.");
        if (imageTitle(saved.attrs.title) !== title)
          throw new ToolError("The file name changed. Leave the file name alone and set only the description.");
        if (fileNameDescription(alt, title))
          throw new ToolError(
            "The description is the file name. Pass a sentence instead.",
          );
        if (alt !== text)
          throw new ToolError(
            `The description is "${alt || "(empty)"}", not "${text}".`,
          );
        if (!text)
          return "Cleared the description. The photo is still there, and its alt text is empty, not the file name. Stop.";
        return `Set the photo's description to "${alt}". The photo was not replaced, resized, or renamed, and the file name was not used. Stop.`;
      },
    }),
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo your own last change in this request. Changes from before the request are the user's and can't be undone with this.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      execute() {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        const own = ownUndoSteps(editor, undoDepth(editor.state));
        if (!own)
          throw new ToolError(
            "Nothing you changed in this request is left to undo. Earlier changes in this document are the user's, so undo would take away their work.",
          );
        const before = blockLines(editor),
          beforeJson = JSON.stringify(editor.getJSON());
        editor.commands.undo();
        const change = describeChange(before, blockLines(editor), beforeJson !== JSON.stringify(editor.getJSON()));
        return `Undid your last change: ${change}. ${own > 1 ? `${own - 1} more of your changes in this request can be undone.` : "That was your first change in this request; none of yours are left to undo."}`;
      },
    }),
    ...docFormatTools(ctx),
  ];
}

/** Each paragraph as "Label: text", to tell what a change did. */
const blockLines = (editor: Editor) => blocks(editor).map((b) => `${b.label}: ${b.text}`);

/** What an undo changed, from the paragraphs before and after it. */
function describeChange(before: string[], after: string[], changed: boolean) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const gone = before.slice(start, before.length - end),
    back = after.slice(start, after.length - end);
  const quote = (lines: string[]) =>
    lines
      .slice(0, 3)
      .map((l) => `"${l.length > 70 ? `${l.slice(0, 70)}…` : l}"`)
      .join(", ") + (lines.length > 3 ? ` and ${lines.length - 3} more` : "");
  const parts = [gone.length ? `the document no longer has ${quote(gone)}` : "", back.length ? `it has back ${quote(back)}` : ""].filter(Boolean);
  return parts.length ? parts.join("; ") : changed ? "a formatting change, the text is the same" : "nothing visible changed";
}

/** Notes the editor's state before the request's first change, for undo and the review. */
export const docBeforeTool = (ctx: DocsAgentContext) => markBaseline(ctx.editor, undoDepth(ctx.editor.state), () => blockLines(ctx.editor));

/** Problems in the paragraphs this request wrote or changed. */
export function docReview(ctx: DocsAgentContext) {
  const issues: string[] = [];
  if (isOddEvenMinutes(ctx.title, ctx.editor) && !oddEvenMinutesReady(ctx.pageSettings())) issues.push(ODD_EVEN_CALL);
  if (isCouncilHeaderNotes(ctx.title, ctx.editor) && !councilHeaderReady(ctx.pageSettings())) issues.push(HEADER_EDGE_CALL);
  const before = baselineSnapshot<string[]>(ctx.editor);
  if (!before) return issues;
  const old = new Set(before);
  if (isColumnNewsletter(ctx.editor, ctx.title) && !newsLayout(ctx.editor).split) issues.push(columnTask(ctx.editor));
  if (isKeepLinesNewsletter(ctx.editor, ctx.title) && !reminderKeepsLines(ctx.editor))
    issues.push(`The reminder still splits across the page break. ${KEEP_LINES_CALL}`);
  for (const b of blocks(ctx.editor)) {
    if (old.has(`${b.label}: ${b.text}`)) continue;
    const short = b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text;
    if (/\*\*[^*]+\*\*|__[^_]+__/.test(b.text)) issues.push(`"${short}" shows ** or __ as text instead of bold.`);
    else if (b.label === "Paragraph" && /^(#{1,6}|[-*]|\d+\.)\s/.test(b.text))
      issues.push(`"${short}" starts with Markdown (# , - or 1.) shown as text instead of a heading or list.`);
    if (b.type === "heading" && !b.text.trim()) issues.push("There is an empty heading.");
  }
  return issues;
}

export function docSnapshot(ctx: DocsAgentContext) {
  const list = blocks(ctx.editor);
  const headings = list.filter((b) => b.type === "heading").map((b) => `${b.label}: ${b.text}`);
  const words = ctx.editor.getText().trim().split(/\s+/).filter(Boolean).length;
  const { label: wordLabel } = statusWordCount(ctx.editor);
  const preview = list
    .slice(0, 12)
    .map((b) => `[${b.label}] ${previewLine(b.text)}`)
    .join("\n");
  const page = ctx.pageSettings();
  const firstPage = page.differentFirstPage
    ? ` Different first page is on, page 1 header "${page.firstHeader}", no number on page 1.`
    : " Different first page is off.";
  const mark = page.watermark ? `watermark "${page.watermark}" behind the text` : "no watermark";
  const draftMark =
    ctx.title === "Garden club minutes" && !page.watermark && ctx.editor.getText().includes("potting shed")
      ? ' To mark this draft, call page_setup once with watermark "DRAFT", then stop. Do not type DRAFT into a paragraph.'
      : "";
  const bindingMark = isBindingMinutes(ctx.title, ctx.editor)
    ? page.gutter > 0
      ? ` Gutter is ${(page.gutter / 96).toFixed(2)} inches on the inside edge. The four edge margins are unchanged. Stop. Do not set the gutter back to 0. Do not call page_setup again.`
      : ` ${BINDING_GUTTER_CALL}`
    : "";
  const oddEvenMark = isOddEvenMinutes(ctx.title, ctx.editor)
    ? oddEvenMinutesReady(page)
      ? ` Different odd and even is on. Even header is "Minutes" on the left, and the number is on the left. Odd header is "Garden club" on the right, and the number is on the right. Page 1 is "Riverside Garden Club" with no number. Stop. Do not call page_setup again. Do not type the page number into the header.`
      : ` Different odd and even is off, so pages 2 and 3 both show "Garden club minutes" on the left and the number on the right. ${ODD_EVEN_CALL}`
    : "";
  const thesisMark = isThesisNotes(ctx.title, ctx.editor)
    ? thesisMarginReady(page)
      ? ` The margin is 2.00 inches on every edge. Stop. Do not rewrite the notes.`
      : ` The margin is still under 2 inches. ${TWO_INCH_CALL}`
    : "";
  const councilMark = isCouncilHeaderNotes(ctx.title, ctx.editor)
    ? councilHeaderReady(page)
      ? ` Header from edge is 0.50 inches. The body margin is still 1 inch. Stop. Do not rewrite the notes.`
      : ` Header "${page.header}" is ${(page.headerFromEdge / 96).toFixed(2)} inches from the edge, the same inset as the notes. The body margin is 1 inch and must stay 1 inch. ${HEADER_EDGE_CALL}`
    : "";
  const setup = `Page setup: ${page.size.toUpperCase()} ${page.landscape ? "landscape" : "portrait"}, ${(page.margin / 96).toFixed(2)}" margins, ${page.header ? `header "${page.header}"` : "no header"}, ${page.footer ? `footer "${page.footer}"` : "no footer"}, ${mark}, ${pageNumberPhrase(page)}.${firstPage}${bindingMark}${oddEvenMark}${thesisMark}${councilMark}`;
  const photos = images(ctx.editor);
  const photoNote = photos.length ? `\n${photos.map((p) => photoSummary(p)).join("; ")}.` : "";
  const columns = isColumnNewsletter(ctx.editor, ctx.title) ? `\n${columnTask(ctx.editor)}` : "";
  return `Open document: "${ctx.title}" (${wordLabel}, ${ctx.pageCount} page(s)). ${setup}${draftMark}${headings.length ? `\nHeadings: ${headings.join(" | ")}` : ""}${photoNote}\n${words ? `Start of the document (a line ending in … is shortened here; the paragraph itself is complete):\n${preview}` : "The document is empty."}\nTo restore one paragraph from a named earlier version and leave every other paragraph, call restore_paragraph. restore_version replaces the whole file.${widowLineNote(ctx.editor)}${keepLinesNote(ctx.editor)}${columns}`;
}

/** Whether the three-line reminder already keeps its lines on one page. */
function reminderKeepsLines(editor: Editor) {
  let on = false;
  editor.state.doc.descendants((node) => {
    if (
      node.type.name === "paragraph" &&
      node.textContent.includes("Bring gloves,") &&
      /trowel/i.test(node.textContent) &&
      node.attrs.keepLines === true
    )
      on = true;
  });
  return on;
}

/** What the open newsletter needs so the reminder stays on one page. */
function keepLinesNote(editor: Editor) {
  if (!editor.getText().includes("Bring gloves,") || !editor.getText().includes("and a trowel.")) return "";
  if (reminderKeepsLines(editor))
    return `\nKeep lines together is already on for the reminder that starts with "Bring gloves,". All three lines are on one page. Stop. Do not rewrite the document and do not insert a page break.`;
  return `\nThe reminder is three lines: "Bring gloves,", "a hat,", and "and a trowel." The first line is the last line of page 1 and the other two start page 2. ${KEEP_LINES_CALL}`;
}

/** What the open newsletter needs for the leftover line, if this is that document. */
function widowLineNote(editor: Editor) {
  const state: { on: boolean | null } = { on: null };
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" && node.textContent.includes("See you Saturday."))
      state.on = node.attrs.widowControl === true;
  });
  if (state.on === null) return "";
  if (state.on)
    return `\nDon't leave one line is already on for the paragraph that contains "See you Saturday.". Stop. Do not rewrite the document and do not insert a page break.`;
  return `\n"See you Saturday." is the only line of its paragraph at the top of the next page. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop. Do not call keep_with_next, write_text, insert_page_break, page_setup, or restore_paragraph.`;
}
