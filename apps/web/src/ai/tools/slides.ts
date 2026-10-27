import { Type } from "@earendil-works/pi-ai";
import type { Slide, SlideElement, SlideFile, TextRun } from "@suiteleaf/core";
import {
  applyBackground,
  applyLayout,
  backgroundColors,
  fillColors,
  newSlide,
  reorder,
  type Layout,
} from "../../editors/slide-layouts";
import { deleteSlides, duplicateSlides, reorderGroup } from "../../editors/slide-editing";
import {
  DECK_THEMES,
  THEME_FONTS,
  applyDeckTheme,
  customizeTheme,
  handStyle,
  normalizeHex,
  setTransitions,
  type TransitionType,
} from "../../editors/slide-theme";
import {
  THEME_LIBRARY_KEY,
  applyLibraryTheme,
  readThemeLibrary,
  saveNamedTheme,
} from "../../editors/slide-theme-library";
import { addSlideComment, elementLabel, replyToSlideComment } from "../../editors/slide-comments";
import { FADE_ON_CLICK, applyFadeOnClick } from "../../editors/slide-fade-in";
import { formatRange, hasTextRuns, plainText, runsOf } from "../../editors/slide-runs";
import {
  addToPersonalDictionary,
  readPersonalDictionary,
  spellingSuggestions,
  writePersonalDictionary,
} from "../../editors/doc-spelling";
import {
  applySuggestionCase,
  collectSlideIssues,
  readIgnoredWords,
  replaceSlideWord,
  sameMisspelling,
  type SlideIssue,
} from "../../editors/grid-spelling";
import { requested } from "../guard";
import { ToolError, currentSnapshot, currentSuiteTools, tool, type SuiteTool } from "../host";
import { deckToMarp } from "../../editors/slide-marp";
import { deckFromMarkdown } from "../../editors/slide-marp-sync";
import { requestFile } from "../file-request";
import { REMOVE_INTENT } from "./files";

type Deck = SlideFile["content"];

/** What the Slides editor lends the agent. */
export interface SlidesAgentContext {
  title: string;
  deck: () => Deck;
  commit: (deck: Deck) => void;
  activeSlideId: string;
  select: (slideId: string, elementId?: string | null) => void;
  presenting: boolean;
  present: (fromIndex: number, withNotes: boolean) => void;
  goToShowSlide: (index: number) => void;
  showIndex: number;
  endShow: () => void;
  readImage: (file: File) => Promise<string>;
  exportAs: (format: "pptx" | "html" | "txt") => Promise<void>;
  /** The object selected on the current slide, if any. */
  selectedElementId: string | null;
  /** Copy objects onto the editor clipboard (the same one Edit › Copy uses). */
  copyElements: (slideId: string, elementIds: string[]) => boolean;
  /** Paste the copied objects onto a slide at their original position. */
  pasteElements: (slideId: string) => { id: string; type: string; x: number; y: number; shapeType?: string }[];
}

const LAYOUTS: Record<string, Layout> = {
  title: "title",
  "title slide": "title",
  "title-body": "title-body",
  "title and body": "title-body",
  "two-column": "two-column",
  "two columns": "two-column",
  section: "section",
  "section header": "section",
  blank: "blank",
};
const layoutParam = Type.String({ enum: ["title", "title-body", "two-column", "section", "blank"] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const textOf = (el: SlideElement) => (el.type === "text" ? (el.content ?? "") : "");
const titleOf = (slide: Slide) => textOf(slide.elements.find((e) => e.type === "text") ?? slide.elements[0] ?? ({} as SlideElement)) || "(untitled)";

/** What each text box of a layout is called, matching the text tools' arguments. */
const BOX_NAMES: Record<string, string[]> = {
  title: ["title", "subtitle"],
  "title-body": ["title", "body"],
  "two-column": ["title", "left column (column1)", "right column (column2)"],
  section: ["title"],
};
/** The text arguments each layout has a box for. */
const LAYOUT_FIELDS: Record<string, string> = {
  title: "title and subtitle",
  "title-body": "title and body",
  "two-column": "title, column1 (left column) and column2 (right column)",
  section: "only a title",
  blank: "no text boxes",
};
const boxName = (slide: Slide, i: number) => BOX_NAMES[slide.layout ?? ""]?.[i] ?? (i === 0 ? "title" : `box ${i + 1}`);

/** Where an object sits on the 960×540 slide, in the words positions use. */
function whereOn(el: SlideElement) {
  const cx = el.x + el.width / 2,
    cy = el.y + el.height / 2;
  const v = cy < 180 ? "top" : cy > 360 ? "bottom" : "",
    h = cx < 320 ? "left" : cx > 640 ? "right" : "";
  return v && h ? `${v}-${h}` : v || h || "center";
}

function styleNote(el: SlideElement) {
  const bits = [
    el.italic ? "italic" : "",
    el.fontFamily && el.fontFamily !== "Arial" ? el.fontFamily : "",
    el.themeOverride ? "overrides theme" : "",
  ].filter(Boolean);
  const words = (el.runs ?? [])
    .map((run) => {
      const mark = [run.bold ? "bold" : "", run.italic ? "italic" : "", run.color ? run.color : ""].filter(Boolean);
      const label = run.text.trim();
      return mark.length && label ? `"${label}" ${mark.join(" ")}` : "";
    })
    .filter(Boolean);
  if (words.length) {
    bits.push(`words ${words.join(", ")}`);
    if (!el.themeOverride) bits.push("does not override the theme");
  }
  return bits.length ? ` [${bits.join(", ")}]` : "";
}

function foldText(value: string) {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/center/g, "centre")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "");
}

/** One word the model named, ignoring a boolean, a colour, or a whole sentence. */
function singleWord(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^(?:only|the word|word)\s+/i, "")
    .trim();
  if (!text || /\s/.test(text)) return undefined;
  if (/^(true|false|yes|no|null|accent|green|bold|italic)$/i.test(text)) return undefined;
  if (/^#?[0-9a-fA-F]{6}$/.test(text)) return undefined;
  return text.replace(/center$/i, "centre");
}

const flagOn = (value: unknown) => value === true || (typeof value === "string" && /^(true|yes)$/i.test(value.trim()));

function wordRanges(text: string, word: string): Array<[number, number]> {
  const wanted = word.toLowerCase().replace(/center/g, "centre");
  if (!wanted) return [];
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g)) {
    const token = match[0].toLowerCase().replace(/center/g, "centre");
    if (token === wanted && match.index !== undefined) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

type WordPatch = { word: string; bold?: boolean; italic?: boolean; color?: string };

/** Style words inside a box. Other words keep the theme, and the box is not a theme override. */
function paintWordStyles(el: SlideElement, patches: WordPatch[]): { element: SlideElement; summary: string } {
  let runs: TextRun[] = el.runs?.length ? runsOf(el) : [{ text: el.content ?? "" }];
  const missing: string[] = [];
  const notes: string[] = [];
  for (const patch of patches) {
    const ranges = wordRanges(plainText(runs), patch.word);
    if (!ranges.length) {
      missing.push(patch.word);
      continue;
    }
    const style: Partial<Pick<TextRun, "bold" | "italic" | "color">> = {};
    const bits: string[] = [];
    if (patch.bold) {
      style.bold = true;
      bits.push("bold");
    }
    if (patch.italic) {
      style.italic = true;
      bits.push("italic");
    }
    if (patch.color) {
      style.color = patch.color;
      bits.push(patch.color);
    }
    if (!bits.length) continue;
    for (const [start, end] of ranges.reverse()) runs = formatRange(runs, start, end, style);
    notes.push(`only "${patch.word}" is ${bits.join(" and ")}`);
  }
  if (missing.length)
    throw new ToolError(
      `That text box does not contain ${missing.map((word) => `"${word}"`).join(", ")}. It says "${el.content ?? ""}". Pass one word from that box to format_words.`,
    );
  if (!notes.length) throw new ToolError('Name a word for bold, italic, or accent. Example: bold "fair", accent "community", italic "centre".');
  const element: SlideElement = {
    ...el,
    content: plainText(runs),
    runs: hasTextRuns({ runs }) ? runs : undefined,
    bold: false,
    italic: false,
    underline: false,
  };
  delete element.themeOverride;
  return { element, summary: notes.join("; ") };
}

function findTextBox(boxes: SlideElement[], text: string | undefined, words: string[]) {
  const wanted = text ? foldText(text) : "";
  const holds = (el: SlideElement, word: string) => wordRanges(el.content ?? "", word).length > 0;
  const hasAll = (el: SlideElement) => words.every((word) => holds(el, word));
  if (wanted) {
    const exact = boxes.find((el) => foldText(el.content ?? "") === wanted);
    if (exact) return exact;
    const contains = boxes.find((el) => foldText(el.content ?? "").includes(wanted) && hasAll(el));
    if (contains) return contains;
    const loose = boxes.find((el) => foldText(el.content ?? "").includes(wanted));
    if (loose) return loose;
  }
  return boxes.find(hasAll);
}

/** Arguments for format_words: each style is the one word, even when the model sends true or a list. */
function wordStyleArgs(args: Record<string, unknown>) {
  const picked: { bold?: string; italic?: string; accent?: string } = {};
  const bold = singleWord(args.bold ?? args.bold_word ?? args.boldWord);
  const italic = singleWord(args.italic ?? args.italic_word ?? args.italicWord);
  const accent = singleWord(
    args.accent ?? args.accent_word ?? args.accentWord ?? args.color_word ?? args.colour_word ?? args.color ?? args.colour,
  );
  if (bold) picked.bold = bold;
  if (italic) picked.italic = italic;
  if (accent) picked.accent = accent;
  const word = singleWord(args.word);
  if (word) {
    if (flagOn(args.bold) && !picked.bold) picked.bold = word;
    if (flagOn(args.italic) && !picked.italic) picked.italic = word;
    const colorRaw = args.color ?? args.colour ?? args.accent;
    if ((flagOn(colorRaw) || (typeof colorRaw === "string" && /accent|green|#/i.test(colorRaw))) && !picked.accent) picked.accent = word;
  }
  const list = args.words ?? args.styles ?? args.changes ?? args.formatting;
  const takeList = (value: unknown) => {
    if (typeof value === "string") {
      for (const part of value.split(/[,;]|\band\b/i)) {
        const target = part
          .trim()
          .split(/\s+/)
          .map((piece) => singleWord(piece))
          .find(Boolean);
        if (!target) continue;
        const blob = part.toLowerCase();
        if (/\bbold\b/.test(blob)) picked.bold = target;
        if (/\bitalic\b/.test(blob)) picked.italic = target;
        if (/\baccent\b|\bgreen\b|\bcolou?r\b/.test(blob)) picked.accent = target;
      }
      return;
    }
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === "string") {
        takeList(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const named = singleWord(rec.word ?? rec.text);
      if (!named) continue;
      if (flagOn(rec.bold) || rec.style === "bold") picked.bold = named;
      if (flagOn(rec.italic) || rec.style === "italic") picked.italic = named;
      if (flagOn(rec.accent) || rec.color !== undefined || rec.colour !== undefined || rec.style === "accent" || rec.style === "color")
        picked.accent = named;
    }
  };
  takeList(list);
  const textRaw = args.text ?? args.box ?? args.content;
  let text = typeof textRaw === "string" ? textRaw.trim().replace(/^["']+|["']+$/g, "") : undefined;
  if (text && !picked.bold && !picked.italic && !picked.accent) takeList(text);
  if (text && singleWord(text) && [picked.bold, picked.italic, picked.accent].includes(singleWord(text))) text = undefined;
  const next: Record<string, unknown> = {};
  if (args.slide !== undefined && args.slide !== "") next.slide = String(args.slide);
  if (text) next.text = text;
  if (picked.bold) next.bold = picked.bold;
  if (picked.italic) next.italic = picked.italic;
  if (picked.accent) next.accent = picked.accent;
  return next;
}

function commentSummary(slide: Slide) {
  const threads = slide.comments ?? [];
  if (!threads.length) return "";
  const bits = threads.map((thread) => {
    const el = slide.elements.find((item) => item.id === thread.elementId);
    const lines = thread.messages.map((message) => `${message.authorName}: "${message.text}"`).join("; ");
    return `${thread.resolved ? "resolved" : "open"} thread ${thread.id} on ${elementLabel(el)} (${lines})`;
  });
  return `; comments: ${bits.join(" | ")}`;
}

function animationNote(el: SlideElement) {
  return el.animation === FADE_ON_CLICK ? " [fades in on the next click]" : "";
}

function describeSlide(slide: Slide, index: number) {
  const texts = slide.elements.filter((e) => e.type === "text");
  const parts = texts.map((e, i) => `${boxName(slide, i)}: ${textOf(e).replace(/\n/g, " / ") || "(empty)"}${styleNote(e)}${animationNote(e)}`);
  const others = slide.elements
    .filter((e) => e.type !== "text")
    .map((e) =>
      e.type === "shape"
        ? `${e.shapeType} shape (${e.fill ?? "no fill"}, ${e.width}×${e.height}, ${whereOn(e)})${animationNote(e)}`
        : e.type === "image"
          ? `image${e.alt ? ` "${e.alt}"` : ""} id ${e.id}${animationNote(e)}`
          : e.type === "audio" || e.type === "video"
            ? `${e.type}${e.alt ? ` "${e.alt}"` : ""} id ${e.id}${animationNote(e)}`
            : `${e.type}${animationNote(e)}`,
    );
  const transition = slide.transition ? `; transition ${slide.transition.type}` : "";
  return `Slide ${index + 1} [${slide.layout ?? "custom"}${slide.background?.color ? `, background ${slide.background.color}` : ""}] ${parts.join("; ")}${others.length ? `; also ${others.join(", ")}` : ""}${slide.notes ? `; notes: ${slide.notes.slice(0, 120)}` : ""}${commentSummary(slide)}${transition}`;
}

function plainArg(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^["']+|["']+$/g, "").trim();
    if (text) return text;
  }
  return undefined;
}

/** One comment per call. A second line is left for reply_slide_comment. */
function commentPrepare(args: Record<string, unknown>, reply: boolean) {
  const next = stringArgs(args);
  const text = plainArg(next.text, next.comment, next.body, next.message, next.note, next.content);
  const signed = plainArg(next.signed_as, next.signedAs, next.author, next.author_name, next.authorName, next.name, next.by);
  const object = plainArg(next.object, next.element, next.target, next.on, next.chart);
  const thread = plainArg(next.thread, next.thread_id, next.threadId);
  const out: Record<string, unknown> = {};
  if (text) out.text = text;
  if (signed) out.signed_as = signed;
  if (object) out.object = object;
  if (next.slide !== undefined && next.slide !== "") out.slide = String(next.slide);
  if (reply && thread) out.thread = thread;
  return out;
}

function stripSignedName(text: string, author: string) {
  const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutTail = text.replace(new RegExp(`[\\s,]*(?:[-–—~]|\\n)\\s*${escaped}[.!]?\\s*$`, "i"), "").trim();
  const withoutHead = (withoutTail || text).replace(new RegExp(`^${escaped}\\s*[:\\-]\\s*`, "i"), "").trim();
  return withoutHead || text.trim();
}

function commentBody(text: string, signedAs: string | undefined): { text: string; author: string; remainder: string } {
  let author = signedAs?.trim() ?? "";
  let body = text.trim();
  if (!author) {
    const tail = /(?:[-–—~]|,\s*|\n)\s*([A-Z][A-Za-z]{1,40})\s*$/.exec(body);
    if (tail) author = tail[1];
  }
  if (author) body = stripSignedName(body, author);
  const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return { text: lines[0] ?? "", author, remainder: lines.slice(1).join(" ") };
}

/** The chart image, not the text box titled Chart. */
function findCommentElement(slide: Slide, object: string | undefined, selectedId: string | null): SlideElement {
  const elements = slide.elements;
  const hint = (object ?? "").trim().toLowerCase().replace(/^(?:the|a|an)\s+/, "").replace(/\s+object$/, "");
  const image =
    elements.find((el) => el.type === "image") ??
    elements.find((el) => el.type !== "text" && /chart/i.test(`${el.id} ${el.alt ?? ""}`));
  if (hint) {
    const byId = elements.find((el) => el.id.toLowerCase() === hint);
    if (byId) return byId;
    const byAlt = elements.find((el) => (el.alt ?? "").toLowerCase().includes(hint));
    if (byAlt) return byAlt;
    if (/\b(chart|image|picture|photo|graph)\b/.test(hint) && image) return image;
    const byText = elements.find((el) => el.type === "text" && textOf(el).toLowerCase() === hint);
    if (byText) return byText;
  }
  if (selectedId) {
    const selected = elements.find((el) => el.id === selectedId);
    if (selected) return selected;
  }
  if (image) return image;
  const listed = elements
    .map((el) =>
      el.alt ? `${el.type} "${el.alt}" (${el.id})` : el.type === "text" ? `"${textOf(el).slice(0, 40)}" (${el.id})` : `${el.type} (${el.id})`,
    )
    .join(", ");
  throw new ToolError(`Say which object the comment is on${listed ? ` (${listed})` : ""}.`);
}

/** A name that only appears inside the reply is not the author. */
function replyAuthor(signed: string, text: string, threadAuthor: string) {
  if (!signed) return threadAuthor;
  if (!threadAuthor || signed.toLowerCase() === threadAuthor.toLowerCase()) return signed;
  const mentioned = new RegExp(`\\b${signed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  return mentioned ? threadAuthor : signed;
}

function themeLine(deck: Deck) {
  const theme = deck.theme;
  return theme
    ? ` Theme ${theme.name} (background ${theme.background}, headings ${theme.headingFont}, body ${theme.bodyFont}, accent ${theme.accent}).`
    : "";
}

/** Find a slide by number (1-based) or by words in its title. */
function findSlide(deck: Deck, which: string | number | undefined, fallback: string) {
  if (which === undefined || which === "" || which === "current") {
    const id = deck.slides[fallback] ? fallback : deck.slideOrder[0];
    return { id, index: deck.slideOrder.indexOf(id) };
  }
  const n = Number(which);
  if (Number.isInteger(n)) {
    if (n < 1 || n > deck.slideOrder.length) throw new ToolError(`There are ${deck.slideOrder.length} slides; slide ${n} does not exist.`);
    return { id: deck.slideOrder[n - 1], index: n - 1 };
  }
  const wanted = String(which).toLowerCase();
  const index = deck.slideOrder.findIndex((id) =>
    deck.slides[id].elements.some((e) => textOf(e).toLowerCase().includes(wanted)),
  );
  if (index < 0) throw new ToolError(`No slide mentions "${which}". Use read_presentation to see the slides.`);
  return { id: deck.slideOrder[index], index };
}

const orderText = (deck: Deck) => deck.slideOrder.map((id, i) => `${i + 1}. ${titleOf(deck.slides[id])}`).join("; ");

/** A slide argument may be a number or a title. Numeric strings stay numbers so "6" is slide 6. */
function asWhich(value: string | number | undefined): string | number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const t = value.trim().replace(/^["']|["']$/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  return t.replace(/^slide\s+/i, "");
}

function splitSlideList(item: unknown): string[] {
  return String(item)
    .split(/\s*(?:,|&| and )\s*/i)
    .map((part) => part.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

/** Numbers the model sends for a slide title field become strings before the schema check. */
function stringArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (typeof next.slide === "number") next.slide = String(next.slide);
  if (typeof next.before === "number") next.before = String(next.before);
  if (typeof next.after === "number") next.after = String(next.after);
  if (Array.isArray(next.slides)) next.slides = next.slides.flatMap(splitSlideList);
  else if (typeof next.slides === "string" || typeof next.slides === "number") next.slides = splitSlideList(next.slides);
  if (typeof next.bold === "string") next.bold = /^(true|yes)$/i.test(next.bold);
  if (typeof next.italic === "string") next.italic = /^(true|yes|italic)$/i.test(next.italic);
  if (typeof next.align === "string") {
    const align = next.align.toLowerCase();
    next.align = align.includes("center") || align === "middle" ? "center" : align.includes("right") ? "right" : align.includes("left") ? "left" : next.align;
  }
  return next;
}

/** A font the model named, and italic when the same words asked for it. */
function canonicalFont(value: string): { font?: string; italic?: boolean } {
  const lower = value.toLowerCase();
  const italic = /\bitalic\b/.test(lower) ? true : undefined;
  const cleaned = lower
    .replace(/\b(italic|bold|regular|normal|oblique)\b/g, " ")
    .replace(/[,;].*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { italic };
  const known = THEME_FONTS.find(
    (font) => cleaned === font.toLowerCase() || cleaned.includes(font.toLowerCase()) || font.toLowerCase().includes(cleaned),
  );
  if (known) return { font: known, italic };
  if (cleaned.length >= 2 && cleaned.length < 40) return { font: value.trim(), italic };
  throw new ToolError(`"${value}" is not a font. Use Georgia, Montserrat, Source Sans, Arial, or Trebuchet MS.`);
}

function matchTheme(name: string) {
  const n = name.toLowerCase().replace(/^the\s+/, "").replace(/\s+theme$/i, "").trim();
  if (n.length < 3) return undefined;
  const exact = DECK_THEMES.find((theme) => theme.id === n || theme.name.toLowerCase() === n);
  if (exact) return exact;
  return DECK_THEMES.find(
    (theme) =>
      n.includes(theme.id) ||
      n.includes(theme.name.toLowerCase()) ||
      theme.id.includes(n) ||
      theme.name.toLowerCase().includes(n),
  );
}

function accentHex(value: string) {
  const found = value.match(/#?[0-9a-fA-F]{6}\b/);
  const hex = found ? normalizeHex(found[0]) : null;
  if (!hex) throw new ToolError(`"${value}" is not a colour code. Use #rrggbb, such as #2E7D32.`);
  return hex;
}

function themeArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (next.theme === undefined && typeof next.name === "string") next.theme = next.name;
  if (next.accent === undefined && typeof next.color === "string") next.accent = next.color;
  if (typeof next.theme === "string")
    next.theme = next.theme.replace(/^the\s+/i, "").replace(/\s+theme$/i, "").trim();
  delete next.name;
  delete next.color;
  return next;
}

/** Library tools take a name; models often send it as theme or title. */
function savedNameArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (typeof next.name !== "string") {
    for (const key of ["theme", "title", "theme_name", "themeName"]) {
      if (typeof next[key] === "string") {
        next.name = next[key];
        break;
      }
    }
  }
  if (typeof next.name === "string")
    next.name = next.name
      .replace(/#?[0-9a-fA-F]{6}\b/g, " ")
      .replace(/^the\s+/i, "")
      .replace(/\s+theme$/i, "")
      .replace(/[.!?]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return { name: next.name };
}

function findSavedTheme(raw: string) {
  const name = raw.trim().toLowerCase();
  const library = readThemeLibrary();
  if (name.length < 3) return { theme: undefined, library };
  const theme =
    library.find((item) => item.name.toLowerCase() === name) ??
    library.find((item) => name.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(name));
  return { theme, library };
}

/** A presentation title from a model argument. */
function fileTitle(raw: string) {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(the\s+)?(presentation|deck|file)\s+/i, "")
    .replace(/\.slslides$/i, "")
    .replace(/[.!?]+$/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

/** save_theme can also open another presentation and copy the saved look onto it. */
function saveThemeArgs(args: Record<string, unknown>) {
  const named = savedNameArgs(args);
  let applyTo = "";
  for (const key of ["apply_to", "applyTo", "file", "deck", "presentation", "to"]) {
    if (typeof args[key] === "string" && args[key].trim()) {
      applyTo = fileTitle(args[key]);
      break;
    }
  }
  if (!applyTo && typeof named.name === "string") {
    const split = /^(.*?)\s+to\s+(?:the\s+)?(?:presentation\s+|deck\s+|file\s+)?(.+)$/i.exec(named.name);
    if (split && split[1].trim().length >= 3 && fileTitle(split[2]).length >= 3) {
      named.name = split[1].trim();
      applyTo = fileTitle(split[2]);
    }
  }
  return applyTo ? { name: named.name, apply_to: applyTo } : { name: named.name };
}

const toolText = (out: string | { text: string }) => (typeof out === "string" ? out : out.text);

const themeButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Theme");

/** "4 to 6" and "4-6" become the slide numbers in between. */
function expandSlideSpec(spec: string): string[] {
  const expanded = spec.replace(/(\d+)\s*(?:-|–|—|to|through)\s*(\d+)/gi, (_, a, b) => {
    const from = Number(a);
    const to = Number(b);
    const step = from <= to ? 1 : -1;
    const nums: string[] = [];
    for (let n = from; n !== to + step; n += step) nums.push(String(n));
    return nums.join(", ");
  });
  return splitSlideList(expanded.replace(/\bslides?\b/gi, " "));
}

function isAllSlides(spec: string) {
  const t = spec
    .replace(/\bslides?\b/gi, " ")
    .replace(/[^a-z]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t === "" || t === "all" || t === "every" || t === "each" || t === "the deck" || t === "whole deck";
}

function transitionArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (next.type === undefined && typeof next.transition === "string") next.type = next.transition;
  if (Array.isArray(next.slides)) next.slides = next.slides.map(String).join(", ");
  if (typeof next.slides === "number") next.slides = String(next.slides);
  if (Array.isArray(next.except)) next.except = next.except.map(String).join(", ");
  if (typeof next.except === "number") next.except = String(next.except);
  if (typeof next.duration === "string") {
    const n = Number(next.duration.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) next.duration = n > 10 && n <= 10000 ? n / 1000 : n;
  }
  if (typeof next.slides === "string" && next.except === undefined) {
    const except = /^(.*?)\s+except\s+(.+)$/i.exec(next.slides.trim());
    if (except) {
      next.slides = except[1].trim() || "all";
      next.except = except[2].trim();
    }
  }
  if (typeof next.type === "string") {
    const v = next.type.toLowerCase();
    if (v.includes("fade")) next.type = "fade";
    else if (v.includes("push")) next.type = "push";
    else if (v.includes("none") || v.includes("cut") || v === "off") next.type = "none";
    else if (/\bslide\b/.test(v)) next.type = "slide";
  }
  delete next.transition;
  return next;
}

function transitionSummary(deck: Deck) {
  const lines = deck.slideOrder.map((id, i) => `${i + 1} ${deck.slides[id].transition?.type ?? "none"}`);
  return `Transitions: ${lines.join(", ")}.`;
}

const SHAPE_TYPES: Record<string, NonNullable<SlideElement["shapeType"]>> = {
  rectangle: "rect",
  rect: "rect",
  "rounded rectangle": "roundRect",
  roundrect: "roundRect",
  circle: "ellipse",
  ellipse: "ellipse",
};

function resolveIds(deck: Deck, which: (string | number)[], fallback: string) {
  const ids: string[] = [];
  for (const item of which) {
    const { id } = findSlide(deck, asWhich(item), fallback);
    if (!ids.includes(id)) ids.push(id);
  }
  if (!ids.length) throw new ToolError("Say which slides, by number or title.");
  return ids;
}

/** A slide show button, after bringing the hidden controls back the way moving the mouse does. */
async function showButton(label: string) {
  window.dispatchEvent(new Event("mousemove"));
  await wait(150);
  return [...document.querySelectorAll(".presenter-overlay button")].find((b) => b.textContent?.includes(label));
}

const thumbnail = (index: number) => document.querySelectorAll(".thumbnail-row")[index];
const canvas = () => document.querySelector(".slide-canvas");

/** Where a named position puts a box of this size on the 960×540 slide. */
function place(position: string | undefined, w: number, h: number, deck: Deck) {
  const W = deck.width || 960,
    H = deck.height || 540,
    m = 40;
  const x = { left: m, center: (W - w) / 2, right: W - w - m };
  const y = { top: m, middle: (H - h) / 2, bottom: H - h - m };
  const [v, hz] = (() => {
    const p = (position ?? "center").toLowerCase();
    if (p === "center" || p === "middle") return ["middle", "center"];
    const vert = p.includes("top") ? "top" : p.includes("bottom") ? "bottom" : "middle";
    const horiz = p.includes("left") ? "left" : p.includes("right") ? "right" : "center";
    return [vert, horiz];
  })();
  return { x: Math.round(x[hz as keyof typeof x]), y: Math.round(y[v as keyof typeof y]) };
}

/** Typed bullets ("- ", "* ") become "• "; in a bulleted box every line gets one, as a person types them. */
function bulleted(text: string, bullets: boolean) {
  return text
    .split("\n")
    .map((line) => {
      const marked = /^\s*[-*•▪◦]\s+(.*)$/.exec(line);
      if (marked) return `• ${marked[1]}`;
      return bullets && line.trim() ? `• ${line.trim()}` : line;
    })
    .join("\n");
}

/** Fill a slide's text boxes in order: title, then body (or subtitle, columns). */
function fillText(slide: Slide, texts: (string | undefined)[]): Slide {
  const boxes = slide.elements.filter((e) => e.type === "text");
  const elements = slide.elements.map((e) => {
    const i = boxes.indexOf(e);
    return i >= 0 && texts[i] !== undefined ? { ...e, content: i === 0 ? texts[i] : bulleted(texts[i]!, !!e.bullet) } : e;
  });
  return { ...slide, elements };
}

interface SlideText {
  title?: string;
  body?: string;
  subtitle?: string;
  column1?: string;
  column2?: string;
}

/** Put text into a slide's boxes, and say what had no box and which boxes are still empty. */
function fillSlide(slide: Slide, { title, body: text, subtitle, column1, column2 }: SlideText) {
  const body = text ?? column1;
  const title1 = slide.layout === "title";
  const next = fillText(slide, [title, title1 ? (subtitle ?? body) : body, column2]);
  const count = next.elements.filter((e) => e.type === "text").length;
  const unused = [
    subtitle !== undefined && !title1 && "subtitle",
    body !== undefined && (count < 2 || (title1 && subtitle !== undefined)) && "body",
    column2 !== undefined && count < 3 && "column2",
    title !== undefined && count < 1 && "title",
  ].filter(Boolean);
  const empty = next.elements
    .filter((e) => e.type === "text")
    .map((e, i) => (e.placeholder !== undefined && !e.content?.trim() ? boxName(next, i) : ""))
    .filter(Boolean);
  const notes = [
    unused.length
      ? `Not used: ${unused.join(", ")}, because a ${next.layout ?? "custom"} slide has ${LAYOUT_FIELDS[next.layout ?? ""] ?? "other boxes"}.`
      : "",
    empty.length ? `Still empty: ${empty.join(", ")}.` : "",
  ];
  return { slide: next, notes: notes.filter(Boolean).join(" ") };
}

/** A #rrggbb color, or a color named in one of the editor's menus ("sage green", "yellow"). */
function pickColor(value: string, palette: { label: string; val: string }[], menu: string) {
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
    const named = palette.find((c) => c.val === v.toLowerCase());
    return { color: v, name: named ? `${named.label.toLowerCase()} (${v})` : v };
  }
  const words = v.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  const label = (c: { label: string }) => c.label.toLowerCase().split(" ");
  const hit =
    palette.find((c) => label(c).join(" ") === words.join(" ")) ??
    palette.find((c) => label(c).every((w) => words.includes(w))) ??
    palette.find((c) => words.length > 0 && words.every((w) => label(c).includes(w)));
  if (!hit)
    throw new ToolError(`"${value}" is not a color here. Use a #rrggbb code or a ${menu} menu color: ${palette.map((c) => c.label).join(", ")}.`);
  return { color: hit.val, name: hit.val.startsWith("#") ? `${hit.label.toLowerCase()} (${hit.val})` : hit.label.toLowerCase() };
}

function spellingArg(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^["']+|["']+$/g, "");
    if (text) return text;
  }
  return "";
}

function spellingWord(input: string, issues: readonly { word: string }[]) {
  const trimmed = input.trim().replace(/^["']+|["']+$/g, "");
  if (!trimmed) return "";
  const exact = issues.find((issue) => sameMisspelling(issue.word, trimmed));
  if (exact) return exact.word;
  const inside = issues
    .filter((issue) => trimmed.toLowerCase().includes(issue.word.toLowerCase()))
    .sort((a, b) => b.word.length - a.word.length);
  return inside[0]?.word ?? trimmed;
}

function slideSpellingIssues(deck: Deck): SlideIssue[] {
  return collectSlideIssues(deck, readPersonalDictionary(), deck.id ? readIgnoredWords(deck.id) : []);
}

/** The same one-prompt sheet-and-deck spelling task, once the presentation is open. */
function sheetAndDeckSpellingRequest() {
  if (requested(/fix_spelling_all|ignore_spelling/i)) return false;
  return requested(/fix_spelling/i) && requested(/Danquah/i) && requested(/\bUpdate\b/);
}

function refuseSlideSpellingRetype() {
  if (!sheetAndDeckSpellingRequest()) return;
  throw new ToolError(
    'Do not use set_slide_text. Call fix_spelling with word "recieve". Only that word changes, so the box reads "receive the keys".',
  );
}

/** Problems left when the user asked to spell the open deck in the same prompt as the sheet. */
export function slideSpellingReview(ctx: SlidesAgentContext): string[] {
  if (!sheetAndDeckSpellingRequest()) return [];
  const issues = slideSpellingIssues(ctx.deck());
  const typos = issues.filter((issue) => spellingSuggestions(issue.word).length > 0);
  const notes: string[] = [];
  if (typos.length)
    notes.push(
      `${describeSlideSpelling(typos)} Call fix_spelling with word "${typos[0].word}". Only that word changes. Do not use set_slide_text.`,
    );
  const dictionary = readPersonalDictionary();
  if (!dictionary.added.some((word) => word.toLowerCase() === "danquah"))
    notes.push('Call add_to_dictionary with word "Danquah". Do not change the text.');
  return notes;
}

function describeSlideSpelling(issues: readonly SlideIssue[]) {
  if (!issues.length) return "No spelling mistakes found.";
  return issues
    .map((issue) => {
      const suggestions = spellingSuggestions(issue.word);
      const fixed = suggestions.length
        ? issue.text.slice(0, issue.from) + applySuggestionCase(issue.word, suggestions[0]) + issue.text.slice(issue.to)
        : "";
      return suggestions.length
        ? `${issue.label} "${issue.word}" → ${suggestions[0]} (the box reads "${issue.text}"). Call fix_spelling with word "${issue.word}". Only that word changes, so the box reads "${fixed}".`
        : `${issue.label} "${issue.word}" (the box reads "${issue.text}"): no suggestions — a name. Call add_to_dictionary with word "${issue.word}". Do not replace it.`;
    })
    .join("\n");
}

const CHART_AXIS = new Set(["jul", "aug", "sep", "oct"]);

/** One entrance: fade in on the next click. A bare "fade" here is that entrance, not a slide transition. */
function wantsFadeOnClick(value: string | undefined): boolean {
  if (!value?.trim()) return true;
  const text = value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(after previous|with previous|on load|none|off|remove)\b/.test(text)) return false;
  if (/^(slide|push)$/.test(text)) return false;
  return /fade|on click|entrance|appear/.test(text);
}

function animatePrepare(args: Record<string, unknown>) {
  const next = stringArgs(args);
  const object = plainArg(next.object, next.element, next.target, next.text, next.name, next.callout, next.on, next.box);
  const animation = [plainArg(next.animation, next.effect, next.entrance, next.type), plainArg(next.trigger, next.when, next.start)]
    .filter(Boolean)
    .join(" ");
  const out: Record<string, unknown> = {};
  if (object) out.object = object;
  if (animation) out.animation = animation;
  if (next.slide !== undefined && next.slide !== "") out.slide = String(next.slide);
  return out;
}

/**
 * The one object to fade in. "September" and "September callout" are the callout.
 * Chart bars and the Sep axis label are refused so they stay without an entrance.
 */
function findFadeTarget(slide: Slide, object: string | undefined): SlideElement {
  const hint = (object ?? "")
    .trim()
    .toLowerCase()
    .replace(/^["']+|["']+$/g, "")
    .replace(/^(?:the|a|an|only)\s+/, "")
    .replace(/\s+object$/, "")
    .trim();
  const callout = slide.elements.find((el) => el.type === "text" && textOf(el).trim().toLowerCase() === "september");
  if (!hint || /\b(september|callout)\b/.test(hint)) {
    if (callout) return callout;
  }
  if (CHART_AXIS.has(hint) || /\b(chart|graph|bars?)\b/.test(hint)) {
    throw new ToolError(
      'That is the chart. Call animate_object with object "September" and animation "fade-on-click". Do not animate the chart, and do not change the slide transition.',
    );
  }
  const exact = slide.elements.find((el) => el.type === "text" && textOf(el).trim().toLowerCase() === hint);
  if (exact) return exact;
  const byId = slide.elements.find((el) => el.id.toLowerCase() === hint);
  if (byId) return byId;
  const listed = slide.elements
    .filter((el) => el.type === "text" && textOf(el).trim())
    .map((el) => `"${textOf(el).replace(/\n/g, " ").slice(0, 40)}"`)
    .join(", ");
  throw new ToolError(
    `No object matches "${object ?? ""}". Text on this slide: ${listed || "none"}. For the September callout, pass object "September" and animation "fade-on-click".`,
  );
}

export function slideTools(ctx: SlidesAgentContext): SuiteTool[] {
  const update = (id: string, change: (s: Slide) => Slide) => {
    const deck = ctx.deck();
    const next = { ...deck, slides: { ...deck.slides, [id]: change(deck.slides[id]) } };
    ctx.commit(next);
    return next;
  };
  /** A slide-level toolbar button (shown when nothing on the slide is selected), after showing that slide. */
  const slideButton = async (slide: number | undefined, label: string) => {
    try {
      ctx.select(findSlide(ctx.deck(), slide, ctx.activeSlideId).id, null);
    } catch {
      // The tool reports the bad slide number.
    }
    await wait(120);
    return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  };
  return [
    tool({
      name: "read_presentation",
      label: "Read slides",
      description: "List every slide: its number, layout, text in each box, other objects, background and speaker notes.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Slide thumbnails"]'),
      execute() {
        const deck = ctx.deck();
        return `"${ctx.title}", ${deck.slideOrder.length} slide(s)${themeLine(deck)}:\n${deck.slideOrder.map((id, i) => describeSlide(deck.slides[id], i)).join("\n")}`;
      },
    }),
    tool({
      name: "read_marp",
      label: "Read markdown",
      description:
        "Read a MARP presentation as markdown. A slide is one column, or two columns written as a pair of <div> blocks. Only a presentation created as MARP has this.",
      parameters: Type.Object({}),
      target: () =>
        document.querySelector(".marp-textarea") ??
        document.querySelector('[aria-label="Slide thumbnails"]'),
      execute() {
        const deck = ctx.deck();
        if (!deck.marp) throw new ToolError("This presentation is not a MARP deck. MARP is chosen when the presentation is created, or when a markdown file is imported.");
        return deck.marpSource ?? deckToMarp(deck);
      },
    }),
    tool({
      name: "replace_marp",
      label: "Replace markdown",
      description:
        "Replace a MARP presentation from markdown. Separate slides with ---. One column is a heading and the text under it. Two columns are two <div> blocks. A trailing HTML comment is speaker notes. The theme is a built-in name (paper, meadow, ink, sand) or a theme: block of colors and fonts. A document that cannot be read is left unchanged. This only works on a presentation created as MARP.",
      parameters: Type.Object({
        markdown: Type.String({ description: "The full MARP document." }),
      }),
      target: () => document.querySelector(".marp-textarea") ?? canvas(),
      execute({ markdown }) {
        if (!ctx.deck().marp)
          throw new ToolError("This presentation is not a MARP deck. MARP is chosen when the presentation is created, or when a markdown file is imported.");
        const result = deckFromMarkdown(ctx.deck(), markdown);
        if (result.problem) throw new ToolError(result.problem);
        ctx.commit(result.deck);
        if (!result.deck.slides[ctx.activeSlideId])
          ctx.select(result.deck.slideOrder[0], null);
        const count = result.deck.slideOrder.length;
        const extra = result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
        return `Updated ${count} slide${count === 1 ? "" : "s"} from markdown.${extra}`;
      },
    }),
    tool({
      name: "add_slide",
      label: "New slide",
      description:
        "Add a slide after slide `after` (default: the current slide) with a layout: title (title + subtitle), title-body (title + bulleted body), two-column (title + two lists side by side), section (section header: a dark slide with only a title), blank. Fill its text: title; subtitle on a title slide; body (one bullet per line); on a two-column slide, column1 is the left column and column2 the right column.",
      parameters: Type.Object({
        layout: layoutParam,
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        column1: Type.Optional(Type.String({ description: "Left column of a two-column slide." })),
        column2: Type.Optional(Type.String({ description: "Right column of a two-column slide." })),
        after: Type.Optional(Type.Number({ description: "Slide number to add after." })),
      }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New slide")),
      async execute({ layout, title, body, subtitle, column1, column2, after }) {
        const deck = ctx.deck();
        const l = LAYOUTS[layout] ?? "title-body";
        const { slide, notes } = fillSlide(newSlide(l), { title, body, subtitle, column1, column2 });
        const at = after !== undefined ? Math.max(0, Math.min(deck.slideOrder.length, after)) : deck.slideOrder.indexOf(ctx.activeSlideId) + 1;
        const order = [...deck.slideOrder];
        order.splice(at, 0, slide.id);
        ctx.commit({ ...deck, slideOrder: order, slides: { ...deck.slides, [slide.id]: slide } });
        ctx.select(slide.id, null);
        await wait(300);
        return `Added ${describeSlide(slide, at)}. ${notes ? `${notes} ` : ""}The presentation has ${order.length} slides.`;
      },
    }),
    tool({
      name: "set_slide_text",
      label: "Edit slide text",
      description:
        "Replace the text on a slide: title, subtitle (title slides), body (one bullet per line), and on a two-column slide column1 for the left column and column2 for the right column. Leave out what should not change.",
      parameters: Type.Object({
        slide: Type.Optional(Type.Number({ description: "Slide number; default the current slide." })),
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        column1: Type.Optional(Type.String({ description: "Left column of a two-column slide." })),
        column2: Type.Optional(Type.String({ description: "Right column of a two-column slide." })),
      }),
      target: ({ title, body, subtitle, column1, column2 }) => {
        const boxes = canvas()?.querySelectorAll(".slide-element textarea") ?? [];
        const first = title !== undefined ? 0 : [body ?? subtitle ?? column1, column2].findIndex((t) => t !== undefined) + 1;
        return boxes[first] ?? boxes[0] ?? canvas();
      },
      async execute({ slide, title, body, subtitle, column1, column2 }) {
        refuseSlideSpellingRetype();
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        let notes = "";
        const deck = update(id, (s) => {
          const boxes = s.elements.filter((e) => e.type === "text");
          const filled = fillSlide(boxes.length ? s : { ...s, layout: "title-body", elements: [...s.elements, ...newSlide("title-body").elements] }, {
            title,
            body,
            subtitle,
            column1,
            column2,
          });
          notes = filled.notes;
          return filled.slide;
        });
        return `Slide ${index + 1} now reads: ${describeSlide(deck.slides[id], index)}${notes ? `\n${notes}` : ""}`;
      },
    }),
    tool({
      name: "set_layout",
      label: "Layout",
      description: "Change a slide's layout; its text moves into the new layout's boxes.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), layout: layoutParam }),
      target: ({ slide }) => slideButton(slide, "Layout"),
      async execute({ slide, layout }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        const deck = update(id, (s) => applyLayout(s, LAYOUTS[layout] ?? "title-body"));
        return `Slide ${index + 1}: ${describeSlide(deck.slides[id], index)}`;
      },
    }),
    tool({
      name: "add_shape",
      label: "Add shape",
      description:
        `Add a shape (rectangle, rounded rectangle, circle/ellipse) to a slide. position: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right. Optional fill: a color name such as yellow, blue, red or light green, or #rrggbb. Optional size in pixels (the slide is 960×540); a circle is always round.`,
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        shape: Type.String({ enum: ["rectangle", "rounded rectangle", "circle", "ellipse"] }),
        position: Type.Optional(Type.String()),
        fill: Type.Optional(Type.String()),
        width: Type.Optional(Type.Number()),
        height: Type.Optional(Type.Number()),
      }),
      prepare: stringArgs,
      target: ({ shape }) =>
        document.querySelector(`[aria-label="${shape === "circle" || shape === "ellipse" ? "Circle" : "Rectangle"}"]`),
      async execute({ slide, shape, position, fill, width, height }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const paint = pickColor(fill ?? "#e2e8f0", fillColors, "Fill");
        ctx.select(id, null);
        const round = shape === "circle" || shape === "ellipse";
        const w = Math.round(width ?? (shape === "circle" ? height : undefined) ?? (round ? 160 : 220)),
          h = shape === "circle" ? w : Math.round(height ?? (round ? 160 : 140));
        const { x, y } = place(position, w, h, ctx.deck());
        const el: SlideElement = {
          id: crypto.randomUUID(),
          type: "shape",
          x,
          y,
          width: w,
          height: h,
          shapeType: round ? "ellipse" : shape === "rectangle" ? "rect" : "roundRect",
          fill: paint.color,
          stroke: "#94a3b8",
          strokeWidth: 2,
        };
        const deck = update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a ${paint.name} ${shape}, ${w}×${h}, at the ${whereOn(el)} of slide ${index + 1} "${titleOf(deck.slides[id])}".${paint.color === "transparent" ? " It has no fill, so only its outline shows." : ""} It is selected; copy_element can copy it.`;
      },
    }),
    tool({
      name: "add_text_box",
      label: "Text box",
      description:
        "Add a new text box (it does not replace the slide's title) with text, at a position (top-left … bottom-right, center). bold makes the words bold. align is left, center, or right (center means the text is center-aligned).",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        text: Type.String(),
        position: Type.Optional(Type.String()),
        size: Type.Optional(Type.Number({ description: "Font size in points." })),
        bold: Type.Optional(Type.Boolean()),
        align: Type.Optional(Type.String({ description: "left, center, or right." })),
      }),
      prepare: stringArgs,
      target: () => document.querySelector('[aria-label="Text box"]') ?? canvas(),
      execute({ slide, text, position, size, bold, align }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const alignment = align === "center" || align === "right" || align === "left" ? align : "left";
        const { x, y } = place(position, 400, 80, ctx.deck());
        const el: SlideElement = {
          id: crypto.randomUUID(),
          type: "text",
          x,
          y,
          width: 400,
          height: 80,
          content: text,
          fontSize: size ?? 22,
          fontFamily: "Arial",
          color: "#1e293b",
          bold: bold || undefined,
          align: alignment,
        };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        const style = [bold ? "bold" : "", alignment === "center" ? "centered" : alignment === "right" ? "right-aligned" : ""].filter(Boolean).join(" and ");
        return `Added a text box "${text}" to slide ${index + 1} "${titleOf(ctx.deck().slides[id])}"${style ? `, ${style}` : ""}.`;
      },
    }),
    tool({
      name: "format_text_box",
      label: "Format text box",
      description:
        "Change every word in a text box that is already on a slide. `text` is the box's text, so the title is left alone when you name a different box. font is a typeface (Georgia, Montserrat, Source Sans, Arial, Trebuchet MS) and marks that box as overriding the theme, so a later theme change leaves its font alone. italic makes every word italic. bold and align (left, center, or right) change every word. This does not add a box. To style one word inside the box (only that word bold, italic, or the accent colour) and leave the other words in the theme style, use format_words. format_words does not mark the box as overriding the theme.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        text: Type.Optional(Type.String({ description: "Words in the box to format." })),
        font: Type.Optional(Type.String({ description: "Typeface, such as Georgia. Marks the box as overriding the theme." })),
        italic: Type.Optional(Type.Boolean({ description: "True makes the words italic." })),
        bold: Type.Optional(Type.Boolean()),
        align: Type.Optional(Type.String({ description: "left, center, or right." })),
      }),
      prepare(args) {
        const next = stringArgs(args);
        if (next.font === undefined) {
          const alias = next.fontFamily ?? next.font_family ?? next.typeface;
          if (typeof alias === "string") next.font = alias;
        }
        if (typeof next.font === "string" && /\bitalic\b/i.test(next.font) && next.italic === undefined) next.italic = true;
        if (next.text === undefined && typeof next.content === "string") next.text = next.content;
        delete next.fontFamily;
        delete next.font_family;
        delete next.typeface;
        delete next.content;
        return next;
      },
      target: () => canvas(),
      execute({ slide, text, font, italic, bold, align }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const alignment = align === "center" || align === "right" || align === "left" ? align : undefined;
        const fontChoice = font !== undefined ? canonicalFont(String(font)) : undefined;
        const italicOn = italic ?? fontChoice?.italic;
        if (bold === undefined && alignment === undefined && !fontChoice?.font && italicOn === undefined)
          throw new ToolError("Say what to change: font (Georgia, Montserrat, Source Sans, Arial, or Trebuchet MS), italic, bold, or align left, center, or right. To style one word, use format_words.");
        let label = "";
        let boxId = "";
        let wordStyled = "";
        update(id, (s) => {
          const boxes = s.elements.filter((e) => e.type === "text");
          const fold = (value: string) =>
            value
              .toLowerCase()
              .replace(/[‘’ʼ]/g, "'")
              .replace(/[“”]/g, '"')
              .replace(/center/g, "centre")
              .replace(/\s+/g, " ")
              .trim()
              .replace(/^["']+|["']+$/g, "");
          const wanted = text ? fold(text) : "";
          const found = wanted ? boxes.find((e) => fold(e.content ?? "").includes(wanted)) : undefined;
          const box = found ?? (text ? undefined : (boxes.find((e) => e.id === ctx.selectedElementId) ?? boxes.at(-1)));
          if (!box) throw new ToolError(text ? `No text box on slide ${index + 1} contains "${text}".` : "No text box is selected.");
          label = box.content ?? "";
          boxId = box.id;
          const single = text?.trim().replace(/^["']+|["']+$/g, "") ?? "";
          const oneWord = !!single && !/\s/.test(single);
          if (oneWord && fold(box.content ?? "") !== fold(single) && !fontChoice?.font && !alignment && (bold === true || italicOn === true)) {
            const patches: WordPatch[] = [];
            if (bold === true) patches.push({ word: single, bold: true });
            if (italicOn === true) patches.push({ word: single, italic: true });
            const painted = paintWordStyles(box, patches);
            label = painted.element.content ?? "";
            wordStyled = painted.summary;
            return { ...s, elements: s.elements.map((e) => (e.id === box.id ? painted.element : e)) };
          }
          const patch: Partial<SlideElement> = {};
          if (bold !== undefined) patch.bold = bold;
          if (alignment) patch.align = alignment;
          if (fontChoice?.font) Object.assign(patch, handStyle({ fontFamily: fontChoice.font }));
          if (italicOn !== undefined) patch.italic = italicOn;
          if (fontChoice?.font || italicOn !== undefined) patch.runs = undefined;
          return { ...s, elements: s.elements.map((e) => (e.id === box.id ? { ...e, ...patch } : e)) };
        });
        ctx.select(id, boxId);
        if (wordStyled)
          return `In "${label}" on slide ${index + 1}, ${wordStyled}. The other words stay in the theme style. This text box does not override the theme.`;
        const style = [
          italicOn === true ? "italic" : italicOn === false ? "not italic" : "",
          fontChoice?.font ?? "",
          bold === true ? "bold" : bold === false ? "not bold" : "",
          alignment === "center" ? "centered" : alignment ?? "",
        ].filter(Boolean).join(" ");
        const override = fontChoice?.font ? " It overrides the theme, so a later theme change leaves this box alone." : "";
        const everyWord =
          (bold === true || italicOn === true) && label.trim().split(/\s+/).length > 1 && !fontChoice?.font
            ? " That changed every word in the box. To change one word only, call format_words with bold, italic, or accent set to that word. The other words stay in the theme style, and the box is not marked as overriding the theme."
            : "";
        return `The text box "${label}" on slide ${index + 1} is now ${style}.${override}${everyWord}`;
      },
    }),
    tool({
      name: "format_words",
      label: "Format words",
      description:
        "Style one or more words inside a text box. The other words stay in the theme style, and the box is not marked as overriding the theme. Call it once. text is the box, such as Spring fair for the community centre. bold is the single word to make bold, such as fair. italic is the single word to make italic, such as centre. accent is the single word to colour with the theme accent (the accent green), such as community. Do not pass true: pass the word. Do not use format_text_box for one word, because that styles every word in the box.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        text: Type.Optional(Type.String({ description: "The text box that contains the words, copied from the slide." })),
        bold: Type.Optional(Type.String({ description: "The one word to make bold. Other words stay as they are." })),
        italic: Type.Optional(Type.String({ description: "The one word to make italic. Other words stay as they are." })),
        accent: Type.Optional(Type.String({ description: "The one word to colour with the theme accent. On Meadow that is the accent green." })),
      }),
      prepare: wordStyleArgs,
      target: () => canvas(),
      execute({ slide, text, bold, italic, accent }) {
        const deck = ctx.deck();
        const { id, index } = findSlide(deck, asWhich(slide), ctx.activeSlideId);
        const patches: WordPatch[] = [];
        if (bold) patches.push({ word: bold, bold: true });
        if (italic) patches.push({ word: italic, italic: true });
        if (accent) {
          const color = deck.theme?.accent;
          if (!color) throw new ToolError("This deck has no theme accent, so there is no accent green to use.");
          patches.push({ word: accent, color: normalizeHex(color) ?? color });
        }
        if (!patches.length)
          throw new ToolError('Pass the word itself. bold is the word to make bold, italic the word to italicise, and accent the word to colour with the theme accent.');
        let label = "";
        let boxId = "";
        let summary = "";
        update(id, (s) => {
          const boxes = s.elements.filter((e) => e.type === "text");
          const box = findTextBox(boxes, text, patches.map((patch) => patch.word));
          if (!box)
            throw new ToolError(
              text
                ? `No text box on slide ${index + 1} contains "${text}".`
                : `No text box on slide ${index + 1} contains ${patches.map((patch) => `"${patch.word}"`).join(", ")}.`,
            );
          const painted = paintWordStyles(box, patches);
          label = painted.element.content ?? "";
          boxId = box.id;
          summary = painted.summary;
          return { ...s, elements: s.elements.map((e) => (e.id === box.id ? painted.element : e)) };
        });
        ctx.select(id, boxId);
        return `In "${label}" on slide ${index + 1}, ${summary}. The other words stay in the theme style. This text box does not override the theme.`;
      },
    }),
    tool({
      name: "insert_image",
      label: "Insert image",
      description: "Ask the user to choose a picture and put it on a slide at a position.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), position: Type.Optional(Type.String()) }),
      target: () => document.querySelector('[aria-label="Insert image"]'),
      async execute({ slide, position }) {
        const file = await requestFile("Choose a picture for the slide", "image/png,image/jpeg,image/gif,image/webp");
        if (!file) return "The user did not choose a picture.";
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        const src = await ctx.readImage(file);
        const { x, y } = place(position, 360, 240, ctx.deck());
        const el: SlideElement = { id: crypto.randomUUID(), type: "image", x, y, width: 360, height: 240, src, alt: file.name };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Put "${file.name}" on slide ${index + 1}.`;
      },
    }),
    tool({
      name: "insert_table",
      label: "Insert table",
      description: "Put a table on a slide. `cells` is a list of rows, each a list of cell texts; the first row is the header.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), cells: Type.Array(Type.Array(Type.String())) }),
      target: () => canvas(),
      execute({ slide, cells }) {
        if (!cells.length) throw new ToolError("Give at least one row.");
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        const width = 800,
          height = Math.min(360, 40 * cells.length);
        const { x, y } = place("bottom", width, height, ctx.deck());
        const el: SlideElement = { id: crypto.randomUUID(), type: "table", x, y: Math.max(140, y), width, height, rows: cells };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a ${cells.length}-row table to slide ${index + 1}.`;
      },
    }),
    tool({
      name: "set_background",
      label: "Background",
      description: `Set the background color of one slide (the current one, or \`slide\`), or of every slide with all_slides=true (section headers keep theirs). color: a name such as sage green, warm sand or deep navy, or #rrggbb. To restyle the whole deck (background, fonts, and accent together), use apply_theme instead.`,
      parameters: Type.Object({ color: Type.String(), slide: Type.Optional(Type.Number()), all_slides: Type.Optional(Type.Boolean()) }),
      target: ({ slide, all_slides }) => slideButton(all_slides ? undefined : slide, "Background"),
      execute({ color, slide, all_slides }) {
        const deck = ctx.deck();
        const paint = pickColor(color, backgroundColors, "Background");
        if (all_slides) {
          ctx.commit({ ...deck, slides: applyBackground(deck.slides, paint.color, true) });
          return `Every slide now has a ${paint.name} background.`;
        }
        const { id, index } = findSlide(deck, slide, ctx.activeSlideId);
        update(id, (s) => applyBackground({ [id]: s }, paint.color)[id]);
        ctx.select(id, null);
        return `Slide ${index + 1} "${titleOf(deck.slides[id])}" now has a ${paint.name} background; the other slides keep theirs.`;
      },
    }),
    tool({
      name: "apply_theme",
      label: "Apply theme",
      description:
        "Apply one built-in look to every slide: background, heading font, body font, text colours, and the accent colour on shapes. Themes: Meadow (deep green, white Montserrat headings, Source Sans body), Paper, Ink, Warm Sand. Free text boxes follow the theme, except a box already marked as overriding it. accent sets the theme accent to a #rrggbb colour such as #2E7D32 and updates every shape. Call this again with only accent to change the colour after a theme is already on. A theme stored with save_theme is applied with apply_saved_theme, not this tool. This does not change the theme library or any other deck.",
      parameters: Type.Object({
        theme: Type.Optional(Type.String({ description: "Meadow, Paper, Ink, or Warm Sand." })),
        accent: Type.Optional(Type.String({ description: "Accent colour as #rrggbb, such as #2E7D32." })),
      }),
      prepare: themeArgs,
      target: () => themeButton(),
      execute({ theme, accent }) {
        const deck = ctx.deck();
        let colour = accent;
        let themeName = theme;
        if (themeName) {
          const hex = themeName.match(/#?[0-9a-fA-F]{6}\b/);
          if (!colour && hex) colour = hex[0];
          themeName = themeName.replace(/#?[0-9a-fA-F]{6}\b/g, " ").replace(/\s+/g, " ").trim();
        }
        let next = deck;
        if (themeName) {
          const found = matchTheme(themeName);
          if (found) {
            // Reapplying the theme already on the deck keeps a custom accent or font.
            const theme = deck.theme?.id === found.id ? { ...deck.theme } : { ...found };
            next = applyDeckTheme(deck, theme);
          } else {
            const { theme: saved, library } = findSavedTheme(themeName);
            if (!saved) {
              const names = library.map((item) => `"${item.name}"`).join(", ");
              throw new ToolError(
                `No built-in theme named "${theme}". Choose Meadow, Paper, Ink, or Warm Sand.${names ? ` Saved themes: ${names}. Copy one with apply_saved_theme, or save_theme with apply_to set to the other presentation.` : " A theme saved with save_theme is applied with apply_saved_theme, not apply_theme."}`,
              );
            }
            const before = localStorage.getItem(THEME_LIBRARY_KEY);
            next = applyLibraryTheme(deck, saved);
            if (localStorage.getItem(THEME_LIBRARY_KEY) !== before) {
              if (before === null) localStorage.removeItem(THEME_LIBRARY_KEY);
              else localStorage.setItem(THEME_LIBRARY_KEY, before);
            }
          }
        } else if (!deck.theme) {
          throw new ToolError(
            "Name a built-in theme first: Meadow, Paper, Ink, or Warm Sand. Or call apply_saved_theme with a name from save_theme. To change only the accent, pass accent and no theme name.",
          );
        }
        if (colour) next = customizeTheme(next, { accent: accentHex(colour) });
        if (!next.theme) throw new ToolError("Name a theme first: Meadow, Paper, Ink, or Warm Sand.");
        ctx.commit(next);
        ctx.select(next.slideOrder[0], null);
        const kept = next.slideOrder.flatMap((id, i) =>
          next.slides[id].elements
            .filter((el) => el.themeOverride && el.type === "text")
            .map((el) => `slide ${i + 1} "${(el.content ?? "").slice(0, 80)}" stays ${el.fontFamily ?? "as set"}${el.italic ? ", italic" : ""}`),
        );
        return `Applied ${next.theme.name} to "${ctx.title}", all ${next.slideOrder.length} slides. Background ${next.theme.background}, headings ${next.theme.headingFont}, body ${next.theme.bodyFont}, accent ${next.theme.accent}.${kept.length ? ` Left alone because they override the theme: ${kept.join("; ")}.` : " No text box overrides the theme."} The theme library and other decks were not changed.`;
      },
    }),
    tool({
      name: "save_theme",
      label: "Save theme",
      description:
        "Save the open deck's current theme to this computer's theme library under name, including its background, heading font, body font, and accent. Pass apply_to with another presentation's title to open that presentation and copy the saved theme onto every slide in the same call. The library stores a copy. Later edits to either deck do not change that saved theme. Refuses when this deck has no theme. Without apply_to, the open deck is unchanged. Do not use apply_theme for a theme saved this way.",
      parameters: Type.Object({
        name: Type.String({ description: "Library name, such as Centre green." }),
        apply_to: Type.Optional(
          Type.String({ description: "Title of the other presentation that should use this saved theme, such as Spring classes." }),
        ),
      }),
      prepare: saveThemeArgs,
      target: () => themeButton(),
      async execute({ name, apply_to }) {
        const current = ctx.deck().theme;
        if (!current)
          throw new ToolError("This deck has no theme to save. Apply Meadow, Paper, Ink, or Warm Sand first.");
        const result = saveNamedTheme(current, name);
        if (!result.ok) throw new ToolError(result.error);
        const saved = result.saved;
        const savedLine = `Saved "${saved.name}" to the theme library: background ${saved.background}, headings ${saved.headingFont}, body ${saved.bodyFont}, accent ${saved.accent}.`;
        if (!apply_to) {
          return `${savedLine} This deck is unchanged. The library keeps accent ${saved.accent} even if another deck later uses a different accent. To use it on another presentation in one call, call save_theme again with the same name and apply_to set to that presentation's title. Or call back_to_files, then open_file with that title, then apply_saved_theme with name "${saved.name}". Do not call apply_theme.`;
        }
        if (apply_to.toLowerCase() === ctx.title.toLowerCase()) {
          throw new ToolError(
            `${savedLine} apply_to must be the other presentation, not "${ctx.title}". Call back_to_files, then open_file with the other title, then apply_saved_theme with name "${saved.name}".`,
          );
        }
        const back = currentSuiteTools().find((item) => item.name === "back_to_files");
        if (!back) throw new ToolError(`${savedLine} Could not leave this deck to open "${apply_to}".`);
        await back.execute({});
        const wanted = `"${apply_to.toLowerCase()}"`;
        let listed = "";
        let open = currentSuiteTools().find((item) => item.name === "open_file");
        for (let attempt = 0; attempt < 30; attempt++) {
          listed = currentSnapshot();
          open = currentSuiteTools().find((item) => item.name === "open_file");
          if (open && listed.toLowerCase().includes(wanted)) break;
          await wait(200);
        }
        if (!listed.toLowerCase().includes(wanted)) {
          throw new ToolError(
            `${savedLine} "${apply_to}" is not on the file list, so it was not opened.\n${listed}\nCall open_file with the presentation's exact title, then apply_saved_theme with name "${saved.name}".`,
          );
        }
        if (!open) throw new ToolError(`${savedLine} Back on the file list, but the file list is not ready to open "${apply_to}".\n${listed}`);
        const openedText = toolText(await open.execute({ name: apply_to }));
        if (/pick it from their computer/i.test(openedText)) {
          throw new ToolError(
            `${savedLine} "${apply_to}" was not opened from the library.\n${openedText}\nCall open_file with the exact title, then apply_saved_theme with name "${saved.name}".`,
          );
        }
        const apply = currentSuiteTools().find((item) => item.name === "apply_saved_theme");
        if (!apply)
          throw new ToolError(
            `${savedLine} "${apply_to}" did not open as a presentation.\n${openedText}\nWhen that presentation is open, call apply_saved_theme with name "${saved.name}".`,
          );
        const applied = toolText(await apply.execute({ name: saved.name }));
        return `${savedLine} ${applied} The task is finished. Do not call apply_theme, and do not change the accent.`;
      },
    }),
    tool({
      name: "apply_saved_theme",
      label: "Apply saved theme",
      description:
        "Copy a theme saved with save_theme onto the open deck only: background, heading font, body font, text colours, and the accent on shapes. Free text boxes follow it, except a box already marked as overriding the theme. name is the library name, such as Centre green. This copies the library entry onto this deck. It does not change the library entry, any other deck, or the built-in themes. To change only this deck's accent afterwards, call apply_theme with accent and no theme name.",
      parameters: Type.Object({
        name: Type.String({ description: "Library name, such as Centre green." }),
      }),
      prepare: savedNameArgs,
      target: () => themeButton(),
      execute({ name }) {
        const { theme, library } = findSavedTheme(name);
        if (!theme) {
          const names = library.map((item) => `"${item.name}"`).join(", ") || "none";
          throw new ToolError(
            `No saved theme named "${name}". Library: ${names}. save_theme stores the open deck's theme first.`,
          );
        }
        const before = localStorage.getItem(THEME_LIBRARY_KEY);
        const next = applyLibraryTheme(ctx.deck(), theme);
        ctx.commit(next);
        ctx.select(next.slideOrder[0], null);
        if (localStorage.getItem(THEME_LIBRARY_KEY) !== before) {
          if (before === null) localStorage.removeItem(THEME_LIBRARY_KEY);
          else localStorage.setItem(THEME_LIBRARY_KEY, before);
        }
        const kept = next.slideOrder.flatMap((id, i) =>
          next.slides[id].elements
            .filter((el) => el.themeOverride && el.type === "text")
            .map((el) => `slide ${i + 1} "${(el.content ?? "").slice(0, 80)}" stays ${el.fontFamily ?? "as set"}${el.italic ? ", italic" : ""}`),
        );
        return `Copied "${theme.name}" onto "${ctx.title}" only. Background ${theme.background}, headings ${theme.headingFont}, body ${theme.bodyFont}, accent ${theme.accent}. The library entry is unchanged, and other decks were not changed.${kept.length ? ` Left alone because they override the theme: ${kept.join("; ")}.` : " No text box overrides the theme."} If the user asked to change only this deck's accent, call apply_theme with that accent and no theme name. Otherwise stop.`;
      },
    }),
    tool({
      name: "set_transition",
      label: "Transition",
      description:
        "Set how one slide changes into the next. type is fade, none (a cut), slide (from the right), or push. slides defaults to all. except lists slides that get no transition while the others get type, for example type fade and except \"4-6\" or \"4, 5, 6\". Duration defaults to 0.4 seconds. This does not animate an object. To fade one object in on the next click, call animate_object.",
      parameters: Type.Object({
        type: Type.String({ enum: ["none", "fade", "slide", "push"] }),
        slides: Type.Optional(Type.String({ description: "all, one slide number, or several such as 4-6 or 4, 5, 6. Default: all." })),
        except: Type.Optional(Type.String({ description: "Slides that get no transition, such as 4-6." })),
        duration: Type.Optional(Type.Number({ description: "Seconds, default 0.4." })),
      }),
      prepare: transitionArgs,
      target: ({ slides, except }) => {
        try {
          const spec = String(except ?? slides ?? "1");
          const first = expandSlideSpec(spec).find((part) => /^\d+$/.test(part));
          return thumbnail(first ? Number(first) - 1 : 0);
        } catch {
          return thumbnail(0);
        }
      },
      execute({ type, slides, except, duration }) {
        const deck = ctx.deck();
        const kind = type as TransitionType;
        let seconds = duration ?? 0.4;
        if (seconds > 10 && seconds <= 10000) seconds /= 1000;
        seconds = Math.min(10, Math.max(0, seconds));
        const exceptIds = except ? resolveIds(deck, expandSlideSpec(except), ctx.activeSlideId) : [];
        const target = slides ?? "all";
        const ids = isAllSlides(target)
          ? deck.slideOrder.filter((id) => !exceptIds.includes(id))
          : resolveIds(deck, expandSlideSpec(target), ctx.activeSlideId);
        let next = setTransitions(deck, ids, { type: kind, duration: seconds });
        if (exceptIds.length) next = setTransitions(next, exceptIds, { type: "none", duration: seconds });
        ctx.commit(next);
        ctx.select(ids[0] ?? deck.slideOrder[0], null);
        return transitionSummary(next);
      },
    }),
    tool({
      name: "animate_object",
      label: "Fade in on click",
      description:
        'Set an entrance on one object. object is text in that object. animation is "fade-on-click": the object stays visible while editing, and in the slideshow it is hidden until the next click, which does not advance the slide. Other objects are unchanged. The slide transition is not changed.',
      parameters: Type.Object({
        object: Type.String({ description: "Text in the one object to animate." }),
        animation: Type.Optional(Type.String({ description: 'fade-on-click. Fade in on the next click.' })),
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
      }),
      prepare: animatePrepare,
      target: ({ slide, object }) => {
        try {
          const found = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
          const element = findFadeTarget(ctx.deck().slides[found.id], object);
          return document.querySelector(`.slide-canvas [data-element-id="${CSS.escape(element.id)}"]`) ?? canvas();
        } catch {
          return canvas();
        }
      },
      async execute({ object, animation, slide }) {
        if (!wantsFadeOnClick(animation))
          throw new ToolError(
            'animate_object only sets fade in on click. It does not change the slide transition. Call it with object "September" and animation "fade-on-click".',
          );
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const element = findFadeTarget(ctx.deck().slides[id], object);
        const marked = applyFadeOnClick(ctx.deck(), id, element.id);
        if (marked) {
          ctx.commit(marked);
          await wait(300);
        }
        ctx.select(id, element.id);
        const saved = ctx.deck().slides[id];
        const kept = saved.elements.find((el) => el.id === element.id);
        if (!kept) throw new ToolError("The object was removed. It must stay on the slide.");
        if (kept.animation !== FADE_ON_CLICK)
          throw new ToolError(`"${textOf(kept) || kept.id}" is still on the slide, but it does not fade in on click.`);
        const stray = saved.elements.filter((el) => el.id !== kept.id && el.animation);
        const label = textOf(kept) || kept.id;
        const others = stray.length
          ? ` Other objects still have an entrance: ${stray.map((el) => textOf(el) || el.type).join(", ")}.`
          : " No other object on the slide has an entrance animation. The chart was not animated.";
        const transition = saved.transition ? ` The slide transition is still ${saved.transition.type}.` : " The slide transition was not changed.";
        return `"${label}" on slide ${index + 1} fades in on the next click. It is still on the slide. In the slideshow it stays hidden until that click, and the click does not advance the slide.${others}${transition} Stop. Do not call another tool.`;
      },
    }),
    tool({
      name: "move_slide",
      label: "Reorder slides",
      description:
        "Move one slide, by its number or title: to a position (`to`, 1 = first), or `before` / `after` another slide (its title or number). To move two or more slides together and keep their order, use move_slides.",
      parameters: Type.Object({
        slide: Type.String({ description: "Number or title of the slide to move." }),
        to: Type.Optional(Type.Number()),
        before: Type.Optional(Type.String()),
        after: Type.Optional(Type.String()),
      }),
      prepare: stringArgs,
      target: ({ slide }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      async execute({ slide, to, before, after }) {
        const deck = ctx.deck();
        const { id, index } = findSlide(deck, asWhich(slide), ctx.activeSlideId);
        let dest: number;
        if (before !== undefined || after !== undefined) {
          const other = findSlide(deck, (before ?? after)!, ctx.activeSlideId);
          if (other.id === id) throw new ToolError(`Slide ${slide} cannot move ${before !== undefined ? "before" : "after"} itself.`);
          dest = deck.slideOrder.filter((x) => x !== id).indexOf(other.id) + (before !== undefined ? 0 : 1);
        } else if (to !== undefined) dest = Math.max(0, Math.min(deck.slideOrder.length - 1, to - 1));
        else throw new ToolError("Say where the slide goes: `to` a position, or `before` or `after` another slide.");
        const order = reorder(deck.slideOrder, index, dest);
        const name = titleOf(deck.slides[id]);
        const prev = dest > 0 ? `after "${titleOf(deck.slides[order[dest - 1]])}"` : "",
          next = dest < order.length - 1 ? `before "${titleOf(deck.slides[order[dest + 1]])}"` : "";
        const neighbours = prev && next ? `${prev} and ${next}` : prev ? `last, ${prev}` : `first, ${next}`;
        const listing = order.map((x, i) => `${i + 1}. ${titleOf(deck.slides[x])}`).join("; ");
        if (dest === index) return `"${name}" is already slide ${index + 1} (${neighbours}); nothing changed. Order: ${listing}`;
        ctx.commit({ ...deck, slideOrder: order });
        ctx.select(id, null);
        await wait(300);
        return `Moved "${name}" from slide ${index + 1} to slide ${dest + 1}: it now comes ${neighbours}. Order: ${listing}`;
      },
    }),
    tool({
      name: "move_slides",
      label: "Reorder slides",
      description:
        "Move two or more slides together, keeping the order they are in now. `slides` are their numbers or titles. Put the group `after` or `before` another slide (its title or number), or at position `to` (1 = first).",
      parameters: Type.Object({
        slides: Type.Array(Type.String({ description: "Slide number or title." })),
        to: Type.Optional(Type.Number({ description: "Position the group should start at. 1 is first." })),
        before: Type.Optional(Type.String()),
        after: Type.Optional(Type.String()),
      }),
      prepare: stringArgs,
      target: ({ slides }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slides[0]), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      async execute({ slides, to, before, after }) {
        const deck = ctx.deck();
        const ids = resolveIds(deck, slides, ctx.activeSlideId);
        let gap: number;
        if (before !== undefined || after !== undefined) {
          const other = findSlide(deck, asWhich(before ?? after), ctx.activeSlideId);
          if (ids.includes(other.id)) throw new ToolError(`Those slides cannot move ${before !== undefined ? "before" : "after"} themselves.`);
          gap = other.index + (before !== undefined ? 0 : 1);
        } else if (to !== undefined) {
          const rest = deck.slideOrder.filter((id) => !ids.includes(id));
          const dest = Math.max(0, Math.min(rest.length, to - 1));
          gap = dest === 0 ? 0 : deck.slideOrder.indexOf(rest[dest - 1]) + 1;
        } else throw new ToolError("Say where the slides go: `to` a position, or `before` or `after` another slide.");
        const order = reorderGroup(deck.slideOrder, ids, gap);
        const names = deck.slideOrder.filter((id) => ids.includes(id)).map((id) => titleOf(deck.slides[id]));
        const listing = orderText({ ...deck, slideOrder: order });
        if (order === deck.slideOrder) return `${names.join(" and ")} already sit there. Order: ${listing}`;
        ctx.commit({ ...deck, slideOrder: order });
        const moving = order.filter((item) => ids.includes(item));
        ctx.select(moving[0], null);
        await wait(300);
        const at = order.indexOf(moving[0]);
        return `Moved ${names.join(" and ")} together. They now start at slide ${at + 1}, still in that order. Order: ${listing}`;
      },
    }),
    tool({
      name: "duplicate_slide",
      label: "Duplicate slide",
      description:
        "Duplicate a whole slide. The copy appears immediately after the original and keeps its text, shapes and pictures. `slide` is its number or title.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
      }),
      prepare: stringArgs,
      target: ({ slide }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      execute({ slide }) {
        const deck = ctx.deck();
        const { id } = findSlide(deck, asWhich(slide), ctx.activeSlideId);
        const result = duplicateSlides(deck, [id], () => crypto.randomUUID());
        if (!result.newIds.length) throw new ToolError("That slide could not be duplicated.");
        ctx.commit(result.deck);
        ctx.select(result.newIds[0], null);
        const at = result.deck.slideOrder.indexOf(result.newIds[0]);
        return `Duplicated "${titleOf(deck.slides[id])}". The copy is slide ${at + 1}, right after the original, with the same text and objects. Order: ${orderText(result.deck)}`;
      },
    }),
    tool({
      name: "delete_slide",
      label: "Delete slide",
      description:
        "Delete one slide (`slide`, its number or title) or several at once (`slides`, numbers or titles). Several slides go in one step.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Number or title of one slide." })),
        slides: Type.Optional(Type.Array(Type.String({ description: "Numbers or titles, to delete them together." }))),
      }),
      prepare: stringArgs,
      intent: REMOVE_INTENT,
      confirm: ({ slide, slides }) => {
        const deck = ctx.deck();
        const which = [...(slides ?? []), ...(slide !== undefined ? [slide] : [])];
        if (!which.length) return undefined;
        const names = which.map((item) => {
          try {
            const found = findSlide(deck, asWhich(item), ctx.activeSlideId);
            return `slide ${found.index + 1} (“${titleOf(deck.slides[found.id])}”)`;
          } catch {
            return `"${item}"`;
          }
        });
        return names.length === 1 ? `Delete ${names[0]}?` : `Delete ${names.length} slides (${names.join(" and ")})?`;
      },
      target: ({ slide, slides }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide ?? slides?.[0]), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      execute({ slide, slides: many }) {
        const deck = ctx.deck();
        const which = [...(many ?? []), ...(slide !== undefined ? [slide] : [])];
        if (!which.length) throw new ToolError("Say which slide to delete, by number or title.");
        const ids = resolveIds(deck, which, ctx.activeSlideId);
        const result = deleteSlides(deck, ids);
        if ("error" in result) throw new ToolError(result.error);
        ctx.commit(result.deck);
        ctx.select(result.activeId, null);
        const names = ids.map((id) => titleOf(deck.slides[id]));
        return `Deleted ${names.join(" and ")}. ${result.deck.slideOrder.length} left. Order: ${orderText(result.deck)}`;
      },
    }),
    tool({
      name: "copy_element",
      label: "Copy object",
      description:
        "Copy one object on a slide (a shape or a text box) so paste_element can put it on another slide at the same position. This does not duplicate a slide. `shape` is rectangle, rounded rectangle, or circle when the slide has several objects; otherwise the selected object is copied.",
      parameters: Type.Object({
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        shape: Type.Optional(Type.String({ description: "rectangle, rounded rectangle, or circle." })),
      }),
      prepare: stringArgs,
      target: () => canvas(),
      execute({ slide, shape }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const current = ctx.deck().slides[id];
        const want = shape ? SHAPE_TYPES[shape.toLowerCase()] : undefined;
        if (shape && !want) throw new ToolError(`"${shape}" is not a shape here. Use rectangle, rounded rectangle, or circle.`);
        const matches = current.elements.filter((el) => {
          if (want) return el.type === "shape" && el.shapeType === want;
          return el.type === "shape" || el.type === "image" || el.type === "text";
        });
        const selected = current.elements.find((el) => el.id === ctx.selectedElementId);
        const el = (want ? matches.find((item) => item.id === selected?.id) : selected) ?? matches.at(-1);
        if (!el || (want && el.shapeType !== want)) {
          const present = current.elements.filter((item) => item.type === "shape").map((item) => item.shapeType ?? "shape");
          throw new ToolError(
            shape
              ? `Slide ${index + 1} "${titleOf(current)}" has no ${shape}${present.length ? ` (it has: ${present.join(", ")})` : ""}.`
              : "Nothing is selected to copy. Say which shape, or select an object first.",
          );
        }
        if (!ctx.copyElements(id, [el.id])) throw new ToolError("That object could not be copied.");
        const kind = el.type === "shape" ? `${shape ?? el.shapeType} shape` : el.type === "text" ? `text box "${el.content ?? ""}"` : el.type;
        return `Copied the ${kind} at (${el.x}, ${el.y}) on slide ${index + 1} "${titleOf(current)}". paste_element puts it on another slide at the same position.`;
      },
    }),
    tool({
      name: "paste_element",
      label: "Paste object",
      description:
        "Paste the object copied with copy_element onto a slide, at the same position it had. On a different slide the position stays the same. `slide` is the destination's number or title.",
      parameters: Type.Object({
        slide: Type.String({ description: "Number or title of the slide to paste onto." }),
      }),
      prepare: stringArgs,
      target: ({ slide }) => {
        try {
          return thumbnail(findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId).index);
        } catch {
          return undefined;
        }
      },
      execute({ slide }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const placed = ctx.pasteElements(id);
        if (!placed.length) throw new ToolError("Nothing is copied. Use copy_element first.");
        const el = placed[placed.length - 1];
        return `Pasted the ${el.type === "shape" ? `${el.shapeType ?? "shape"} shape` : el.type} onto slide ${index + 1} "${titleOf(ctx.deck().slides[id])}" at (${el.x}, ${el.y}).`;
      },
    }),
    tool({
      name: "add_slide_comment",
      label: "Comment on object",
      description:
        'Start one comment thread on an object, such as the chart image. The comment is a mark on that object. It is not written into the speaker notes. Do not call set_speaker_notes. signed_as is the author. Example: object "chart", text "Use the September numbers", signed_as "Maria". If that object already has an open thread, call reply_slide_comment instead of starting another one. Do not resolve the thread.',
      parameters: Type.Object({
        text: Type.Optional(Type.String({ description: 'The comment, without a signature. Example: "Use the September numbers".' })),
        signed_as: Type.Optional(Type.String({ description: 'Author name. Example: "Maria".' })),
        object: Type.Optional(Type.String({ description: 'The object. Use "chart" for the chart image, not the title text box.' })),
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
      }),
      prepare: (args) => commentPrepare(args, false),
      target: ({ slide, object }) => {
        try {
          const found = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
          const element = findCommentElement(
            ctx.deck().slides[found.id],
            object,
            found.id === ctx.activeSlideId ? ctx.selectedElementId : null,
          );
          return document.querySelector(`.slide-canvas [data-element-id="${CSS.escape(element.id)}"]`) ?? canvas();
        } catch {
          return canvas();
        }
      },
      async execute({ text, signed_as, object, slide }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const element = findCommentElement(ctx.deck().slides[id], object, id === ctx.activeSlideId ? ctx.selectedElementId : null);
        const parsed = commentBody(text ?? "", signed_as);
        if (!parsed.author)
          throw new ToolError('Pass signed_as with the author, for example "Maria". The speaker notes were not changed.');
        if (!parsed.text) throw new ToolError("Pass text with the comment. The speaker notes were not changed.");
        const existing = ctx.deck().slides[id].comments?.find((thread) => thread.elementId === element.id && !thread.resolved);
        if (existing) {
          ctx.select(id, element.id);
          const author = existing.messages[0]?.authorName ?? parsed.author;
          return `The ${elementLabel(element)} already has open thread ${existing.id}: "${existing.messages[0]?.text ?? ""}". Call reply_slide_comment with the reply and signed_as "${author}". Do not start another thread, do not resolve it, and do not call set_speaker_notes.`;
        }
        const added = addSlideComment(ctx.deck(), id, element.id, parsed.text, parsed.author);
        if (!added.threadId) throw new ToolError("Could not add that comment. The speaker notes were not changed.");
        ctx.commit(added.deck);
        ctx.select(id, element.id);
        await wait(300);
        const remainder = parsed.remainder
          ? ` The rest ("${parsed.remainder}") was not stored. Call reply_slide_comment with that text and signed_as "${parsed.author}".`
          : ` Call reply_slide_comment to add a reply under thread ${added.threadId} with signed_as "${parsed.author}".`;
        return `Started comment thread ${added.threadId} on the ${elementLabel(element)} (object ${element.id}) on slide ${index + 1}. ${parsed.author}: "${parsed.text}". Speaker notes were not changed.${remainder} Do not call set_speaker_notes and do not resolve the thread.`;
      },
    }),
    tool({
      name: "reply_slide_comment",
      label: "Reply to comment",
      description:
        'Add a reply under the open comment thread on an object. It stays in that same thread and is not resolved. Speaker notes are not changed. Do not call set_speaker_notes. signed_as is the author of the thread, not a name that appears in the reply. Example: text "Priya has them.", signed_as "Maria". Call add_slide_comment first.',
      parameters: Type.Object({
        text: Type.Optional(Type.String({ description: 'The reply. Example: "Priya has them."' })),
        signed_as: Type.Optional(Type.String({ description: 'Same author who started the thread. Example: "Maria".' })),
        object: Type.Optional(Type.String({ description: 'The object. Use "chart" for the chart image.' })),
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        thread: Type.Optional(Type.String({ description: "Thread id from add_slide_comment. Default: the open thread on that object." })),
      }),
      prepare: (args) => commentPrepare(args, true),
      target: ({ slide, object }) => {
        try {
          const found = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
          const element = findCommentElement(
            ctx.deck().slides[found.id],
            object,
            found.id === ctx.activeSlideId ? ctx.selectedElementId : null,
          );
          return document.querySelector(`.slide-canvas [data-element-id="${CSS.escape(element.id)}"]`) ?? canvas();
        } catch {
          return canvas();
        }
      },
      async execute({ text, signed_as, object, slide, thread }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const element = findCommentElement(ctx.deck().slides[id], object, id === ctx.activeSlideId ? ctx.selectedElementId : null);
        const open = (ctx.deck().slides[id].comments ?? []).filter((item) => !item.resolved && item.elementId === element.id);
        const chosen = (thread ? open.find((item) => item.id === thread) : undefined) ?? open[0];
        if (!chosen)
          throw new ToolError(
            `No open comment on the ${elementLabel(element)}. Call add_slide_comment first. Speaker notes were not changed.`,
          );
        const parsed = commentBody(text ?? "", signed_as);
        const author = replyAuthor(parsed.author, parsed.text, chosen.messages[0]?.authorName ?? "");
        if (!parsed.text) throw new ToolError("Pass text with the reply. Speaker notes were not changed.");
        if (!author)
          throw new ToolError('Pass signed_as with the thread author, for example "Maria". Speaker notes were not changed.');
        const next = replyToSlideComment(ctx.deck(), id, chosen.id, parsed.text, author);
        if (next === ctx.deck())
          throw new ToolError("That reply was not added. The thread stays open and the speaker notes were not changed.");
        ctx.commit(next);
        ctx.select(id, element.id);
        await wait(300);
        const saved = ctx.deck().slides[id].comments?.find((item) => item.id === chosen.id);
        const lines = saved?.messages.map((message) => `${message.authorName}: "${message.text}"`).join("; ") ?? "";
        return `Added a reply under thread ${chosen.id} on the ${elementLabel(element)}, slide ${index + 1}. The thread is still open. ${lines}. Speaker notes were not changed. Do not call set_speaker_notes and do not resolve the thread.`;
      },
    }),
    tool({
      name: "set_speaker_notes",
      label: "Speaker notes",
      description:
        "Write the speaker notes for a slide (what to say; only the presenter sees them). A comment on a chart or another object is not a speaker note: use add_slide_comment and reply_slide_comment, which leave the notes unchanged.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), notes: Type.String() }),
      target: () => document.querySelector(".notes-textarea"),
      async execute({ slide, notes }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        let typed = "";
        for (const word of notes.match(/\S+\s*|\s+/g) ?? [notes]) {
          typed += word;
          update(id, (s) => ({ ...s, notes: typed }));
          await wait(20);
        }
        return `Wrote speaker notes for slide ${index + 1}.`;
      },
    }),
    tool({
      name: "go_to_slide",
      label: "Go to slide",
      description: "Show a slide in the editor (or, while presenting, jump the show to it).",
      parameters: Type.Object({ slide: Type.Number() }),
      target: ({ slide }) => (ctx.presenting ? document.querySelector(".presenter-slide-box") : thumbnail(slide - 1)),
      execute({ slide }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        if (ctx.presenting) ctx.goToShowSlide(index);
        else ctx.select(id, null);
        return `Showing slide ${index + 1}.`;
      },
    }),
    tool({
      name: "start_presentation",
      label: "Present",
      description: "Start the slideshow from the first slide (or from `from_slide`), optionally with the speaker notes panel.",
      parameters: Type.Object({ from_slide: Type.Optional(Type.Number()), with_notes: Type.Optional(Type.Boolean()) }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Slideshow"),
      async execute({ from_slide, with_notes }) {
        const index = from_slide ? findSlide(ctx.deck(), from_slide, ctx.activeSlideId).index : 0;
        const deck = ctx.deck();
        ctx.present(index, !!with_notes);
        await wait(600);
        const screen = document.fullscreenElement
          ? "in full screen"
          : "in the window (the browser allows full screen only right after the user clicks or presses a key; they can click Full screen in the show's controls)";
        return `Presenting ${screen} from slide ${index + 1} of ${deck.slideOrder.length}, "${titleOf(deck.slides[deck.slideOrder[index]])}"${with_notes ? ", with the speaker notes beside it" : ""}. Use next_slide to advance and end_presentation to stop.`;
      },
    }),
    tool({
      name: "next_slide",
      label: "Next slide",
      description: "During the slideshow, go forward (or back with back=true) one slide.",
      parameters: Type.Object({ back: Type.Optional(Type.Boolean()) }),
      repeatable: true,
      target: ({ back }) => showButton(back ? "Previous" : "Next"),
      execute({ back }) {
        if (!ctx.presenting) throw new ToolError("The slideshow is not running. Use start_presentation first.");
        const deck = ctx.deck();
        const last = deck.slideOrder.length - 1;
        const next = Math.max(0, Math.min(last, ctx.showIndex + (back ? -1 : 1)));
        const name = (i: number) => `slide ${i + 1} of ${last + 1}, "${titleOf(deck.slides[deck.slideOrder[i]])}"`;
        if (next === ctx.showIndex)
          throw new ToolError(
            `The show is already on the ${back ? "first" : "last"} slide (${name(next)}); there is no ${back ? "previous" : "next"} one. end_presentation stops the show.`,
          );
        ctx.goToShowSlide(next);
        return `Showing ${name(next)}.${next === last ? " This is the last slide." : ""}`;
      },
    }),
    tool({
      name: "end_presentation",
      label: "End show",
      description: "Stop the slideshow and go back to editing.",
      parameters: Type.Object({}),
      target: () => showButton("Exit"),
      execute() {
        if (!ctx.presenting) return "The slideshow was not running; the editor is showing.";
        ctx.endShow();
        return "Stopped the slideshow; the editor is showing again.";
      },
    }),
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check spelling in text boxes with the on-device dictionary Docs uses. Nothing is sent off this computer. Speaker notes are not checked. Then call fix_spelling to change a typo such as recieve to receive inside that box only. A name with no suggestion, such as Danquah, is added with add_to_dictionary and is not replaced. Do not use set_slide_text for spelling.",
      parameters: Type.Object({}),
      target: () => canvas(),
      execute() {
        const issues = slideSpellingIssues(ctx.deck());
        if (!issues.length) return "No spelling mistakes found. The check used the on-device dictionary and did not send the text anywhere.";
        return `${describeSlideSpelling(issues)}\nThe check used the on-device dictionary and did not send the text anywhere. Call fix_spelling for each typo. Add each name with add_to_dictionary.`;
      },
    }),
    tool({
      name: "fix_spelling",
      label: "Fix spelling",
      description:
        'Replace one misspelled word inside a text box and leave the other words. Example: {"word":"recieve"} changes a box that reads "recieve the keys" into "receive the keys". It does not rewrite the sentence. A name with no suggestion is not changed: add it with add_to_dictionary. Do not use set_slide_text.',
      parameters: Type.Object({
        word: Type.Optional(Type.String({ description: 'The misspelled word only, such as "recieve". Not the whole text box.' })),
        correction: Type.Optional(Type.String({ description: "Ignored unless it is the suggestion. The suggestion replaces the word." })),
      }),
      prepare(args) {
        const word = spellingArg(args.word, args.text, args.typo, args.find);
        const correction = spellingArg(args.correction, args.replace, args.replacement, args.suggestion);
        return {
          ...(word ? { word } : {}),
          ...(correction ? { correction } : {}),
        };
      },
      target: () => canvas(),
      async execute({ word }) {
        const started = ctx.deck();
        const issues = slideSpellingIssues(started);
        const requested = word ? spellingWord(word, issues) : "";
        const pick = (list: SlideIssue[]) => list.filter((issue) => !requested || sameMisspelling(issue.word, requested));
        const chosen = pick(issues);
        if (requested && !chosen.length)
          return `"${requested}" is not a misspelling in this presentation, so nothing was changed.\n${describeSlideSpelling(issues)}`;
        if (requested && chosen.length && !spellingSuggestions(chosen[0].word).length)
          return `"${chosen[0].word}" has no spelling suggestion, so it was not changed. It looks like a name: add it with add_to_dictionary. Do not replace it. The box still reads "${chosen[0].text}".`;
        let deck = started;
        const notes: string[] = [];
        const done = new Set<string>();
        for (let guard = 0; guard < 40; guard++) {
          const pending = pick(slideSpellingIssues(deck)).filter((issue) => {
            const key = `${issue.slideId}:${issue.elementId}:${issue.word.toLowerCase()}:${issue.from}`;
            return spellingSuggestions(issue.word).length > 0 && !done.has(key);
          });
          const issue = pending[0];
          if (!issue) break;
          done.add(`${issue.slideId}:${issue.elementId}:${issue.word.toLowerCase()}:${issue.from}`);
          const suggestion = spellingSuggestions(issue.word)[0];
          const element = deck.slides[issue.slideId]?.elements.find((item) => item.id === issue.elementId);
          if (!suggestion || element?.content?.slice(issue.from, issue.to) !== issue.word) continue;
          const replacement = applySuggestionCase(issue.word, suggestion);
          const nextText = element.content.slice(0, issue.from) + replacement + element.content.slice(issue.to);
          deck = replaceSlideWord(deck, issue.slideId, issue.elementId, issue.from, issue.to, replacement);
          ctx.select(issue.slideId, issue.elementId);
          notes.push(`"${element.content}" → "${nextText}" ("${issue.word}" → "${replacement}")`);
        }
        if (notes.length) {
          ctx.commit(deck);
          await wait(300);
        }
        const left = slideSpellingIssues(ctx.deck());
        const parts = [
          notes.length
            ? `Corrected ${notes.length} text box(es), changing only the misspelled word: ${notes.join("; ")}.`
            : "No typos with a suggestion were changed.",
        ];
        const names = left.filter((issue) => !spellingSuggestions(issue.word).length);
        const typos = left.filter((issue) => spellingSuggestions(issue.word).length);
        if (names.length)
          parts.push(
            `Still unknown, with no suggestion: ${names.map((issue) => `"${issue.word}"`).join(", ")}. Add each with add_to_dictionary. Do not replace them.`,
          );
        if (typos.length) parts.push(`Still misspelled: ${describeSlideSpelling(typos)}`);
        if (!names.length && !typos.length) parts.push("No spelling mistakes are left.");
        parts.push("The check used the on-device dictionary and did not send the text anywhere.");
        return parts.join(" ");
      },
    }),
    tool({
      name: "add_to_dictionary",
      label: "Add to dictionary",
      description:
        'Add a name to the personal dictionary Docs uses, so spelling stops flagging it. The store is suiteleaf.personal-dictionary on this computer. Example: {"word":"Danquah"}. The text box is not changed. Do not add a typo such as recieve; correct typos with fix_spelling.',
      parameters: Type.Object({
        word: Type.String({ description: 'The name to stop flagging, such as "Danquah".' }),
      }),
      prepare: (args) => ({ word: spellingArg(args.word, args.name, args.text) }),
      target: () => canvas(),
      async execute({ word }) {
        const cleaned = word.trim();
        if (!cleaned) throw new ToolError("Say which word to add to the dictionary, such as Danquah.");
        const issues = slideSpellingIssues(ctx.deck());
        const token = spellingWord(cleaned, issues);
        const matches = issues.filter((issue) => sameMisspelling(issue.word, token));
        if (matches.length && spellingSuggestions(matches[0].word).length) {
          const suggestion = spellingSuggestions(matches[0].word)[0];
          return `"${matches[0].word}" looks like a typo (suggestion: ${suggestion}). It was not added to the dictionary. Correct it with fix_spelling. The box still reads "${matches[0].text}".`;
        }
        if (!matches.length && spellingSuggestions(token).length)
          return `"${token}" looks like a typo (suggestion: ${spellingSuggestions(token)[0]}). It was not added to the dictionary. Correct it with fix_spelling.`;
        const stored = matches[0]?.word ?? token;
        const next = addToPersonalDictionary(readPersonalDictionary(), stored);
        writePersonalDictionary(next);
        await wait(400);
        const still = matches.length ? ` The box still reads "${matches[0].text}".` : "";
        return `"${stored}" is in the personal dictionary Docs uses (${next.added.join(", ")}). It is not flagged.${still} The spelling in the text was not changed.`;
      },
    }),
    tool({
      name: "export_presentation",
      label: "Export",
      description:
        "Export a copy in another format, for other apps: PowerPoint (pptx), a web page (html), or plain text (txt). Only when the user asks for one of these; to download or save the file itself, use download_file.",
      parameters: Type.Object({ format: Type.String({ enum: ["pptx", "html", "txt"] }) }),
      target: () => document.querySelector(".workspace-header [aria-haspopup]"),
      async execute({ format }) {
        await ctx.exportAs(format as "pptx");
        return `Exported "${ctx.title}.${format}".`;
      },
    }),
  ];
}

export function slideSnapshot(ctx: SlidesAgentContext) {
  const deck = ctx.deck();
  const current = deck.slideOrder.indexOf(ctx.activeSlideId) + 1;
  const theme = deck.theme
    ? ` Theme: ${deck.theme.name}, accent ${deck.theme.accent}, headings ${deck.theme.headingFont}, body ${deck.theme.bodyFont}.`
    : " No theme.";
  const library = readThemeLibrary();
  const saved = library.length
    ? ` Theme library: ${library.map((item) => `"${item.name}" accent ${item.accent}, headings ${item.headingFont}, body ${item.bodyFont}, background ${item.background}`).join("; ")}. apply_saved_theme copies one onto this deck.`
    : "";
  return `Open presentation: "${ctx.title}", ${deck.slideOrder.length} slide(s); slide ${current} is selected${ctx.presenting ? `; the slideshow is running on slide ${ctx.showIndex + 1}` : ""}.${theme}${saved}\n${deck.slideOrder
    .slice(0, 20)
    .map((id, i) => describeSlide(deck.slides[id], i))
    .join("\n")}`;
}
