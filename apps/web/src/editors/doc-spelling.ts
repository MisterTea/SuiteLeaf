import type { JsonNode } from "@suiteleaf/core";
import { Extension, Mark } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { englishHeadwords } from "./english-words";
import { readProofing, type ProofingSettings } from "./doc-word-count";

export type PersonalDictionary = { added: string[]; flagged: string[] };

export const PERSONAL_DICTIONARY_KEY = "suiteleaf.personal-dictionary";

/** Sheets and Slides listen for this so they share the Docs dictionary. */
export const SPELLING_CHANGED_EVENT = "suiteleaf-spelling-changed";

const emptyDictionary = (): PersonalDictionary => ({ added: [], flagged: [] });

export function readPersonalDictionary(): PersonalDictionary {
  try {
    const raw = JSON.parse(localStorage.getItem(PERSONAL_DICTIONARY_KEY) || "null") as
      | Partial<PersonalDictionary>
      | null;
    const list = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((word): word is string => typeof word === "string" && word.trim().length > 0)
        : [];
    return { added: list(raw?.added), flagged: list(raw?.flagged) };
  } catch {
    return emptyDictionary();
  }
}

export function writePersonalDictionary(dictionary: PersonalDictionary) {
  try {
    localStorage.setItem(PERSONAL_DICTIONARY_KEY, JSON.stringify(dictionary));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(SPELLING_CHANGED_EVENT));
  } catch {
    /* private mode */
  }
}

export const sameWord = (left: string, right: string) =>
  left.toLowerCase().replace(/’/g, "'") === right.toLowerCase().replace(/’/g, "'");

/** One occurrence the writer chose to keep. The same word stays wrong everywhere else. */
export const SPELLING_IGNORE_MARK = "spellingIgnore";

export const SpellingIgnoreMark = Mark.create({
  name: SPELLING_IGNORE_MARK,
  inclusive: false,
  excludes: "",
  parseHTML() {
    return [{ tag: "span[data-spelling-ignore]" }];
  },
  renderHTML() {
    return ["span", { "data-spelling-ignore": "true" }, 0];
  },
});

export function addToPersonalDictionary(dictionary: PersonalDictionary, word: string): PersonalDictionary {
  const cleaned = word.trim();
  if (!cleaned) return dictionary;
  return {
    added: dictionary.added.some((item) => sameWord(item, cleaned))
      ? dictionary.added
      : [...dictionary.added, cleaned],
    flagged: dictionary.flagged.filter((item) => !sameWord(item, cleaned)),
  };
}

export function flagWord(dictionary: PersonalDictionary, word: string): PersonalDictionary {
  const cleaned = word.trim();
  if (!cleaned) return dictionary;
  return {
    added: dictionary.added.filter((item) => !sameWord(item, cleaned)),
    flagged: dictionary.flagged.some((item) => sameWord(item, cleaned))
      ? dictionary.flagged
      : [...dictionary.flagged, cleaned],
  };
}

export function removePersonalWord(
  dictionary: PersonalDictionary,
  word: string,
  list: "added" | "flagged",
): PersonalDictionary {
  return {
    ...dictionary,
    [list]: dictionary[list].filter((item) => !sameWord(item, word)),
  };
}

export function ignoreWord(settings: ProofingSettings, word: string): ProofingSettings {
  const cleaned = word.trim();
  if (!cleaned || settings.ignored.some((item) => sameWord(item, cleaned))) return settings;
  return { ...settings, ignored: [...settings.ignored, cleaned] };
}

export function unignoreWord(settings: ProofingSettings, word: string): ProofingSettings {
  return { ...settings, ignored: settings.ignored.filter((item) => !sameWord(item, word)) };
}

const headwords = englishHeadwords
  .split("\n")
  .map((word) => word.trim())
  .filter(Boolean);
const rank = new Map<string, number>();
headwords.forEach((word, index) => rank.set(word, index));
const dictionary = new Set(headwords);

function regularPlural(word: string) {
  if (word.length < 2 || !/^[a-z]+$/.test(word)) return null;
  if (word.endsWith("y") && !"aeiou".includes(word.at(-2) ?? "")) return `${word.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}
for (const word of headwords) {
  const plural = regularPlural(word);
  if (plural && !rank.has(plural)) {
    rank.set(plural, (rank.get(word) ?? 5000) + 8000);
    dictionary.add(plural);
  }
}

/** Forms the frequency list stores without apostrophes, plus won't. */
const contractions = [
  "don't",
  "it's",
  "that's",
  "can't",
  "won't",
  "i'm",
  "you're",
  "we're",
  "they're",
  "i've",
  "we've",
  "they've",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "hasn't",
  "haven't",
  "hadn't",
  "doesn't",
  "didn't",
  "couldn't",
  "shouldn't",
  "wouldn't",
  "let's",
  "there's",
  "here's",
  "what's",
  "who's",
  "she's",
  "he's",
  "i'll",
  "we'll",
  "they'll",
  "you'll",
];
for (const word of contractions) dictionary.add(word);

const normalize = (word: string) => word.toLowerCase().replace(/’/g, "'");

/**
 * The en_US Hunspell dictionary, derived from SCOWL, for real words outside the
 * common-word list such as elf, zombie, and melee. It loads after the editor
 * opens; until then only the common words are known.
 */
let hunspell: { correct: (word: string) => boolean } | null = null;
let loadingHunspell: Promise<void> | null = null;

export function loadFullDictionary(): Promise<void> {
  loadingHunspell ??= Promise.all([
    import("nspell"),
    import("dictionary-en-files/index.aff?raw"),
    import("dictionary-en-files/index.dic?raw"),
  ])
    .then(([{ default: nspell }, aff, dic]) => {
      hunspell = nspell(aff.default, dic.default);
      if (typeof window !== "undefined") window.dispatchEvent(new Event(SPELLING_CHANGED_EVENT));
    })
    .catch(() => {
      loadingHunspell = null;
    });
  return loadingHunspell;
}

if (typeof window !== "undefined") void loadFullDictionary();

function inDictionary(word: string): boolean {
  const value = normalize(word);
  if (dictionary.has(value)) return true;
  const bare = value.replace(/'/g, "");
  if (bare !== value && dictionary.has(bare)) return true;
  const possessive = /^([a-z]+)'s$/.exec(value);
  if (possessive && dictionary.has(possessive[1])) return true;
  if (value.includes("-")) {
    const parts = value.split("-").filter(Boolean);
    if (parts.length > 1 && parts.every((part) => dictionary.has(part))) return true;
  }
  // Hunspell knows which words are names, so it reads the word as written.
  return !!hunspell?.correct(word.replace(/’/g, "'"));
}

/** How many of the most common words a capitalized first word is compared with. */
const COMMON_WORDS = 1000;

/** One letter added, dropped, changed, or swapped from a very common word, as "Teh" is from "the". */
function slipOfCommonWord(word: string) {
  const target = normalize(word).replace(/'/g, "");
  return [...edits(target)].some((item) => (rank.get(item) ?? Infinity) < COMMON_WORDS);
}

/**
 * Whether to underline a word. A capitalized word is taken to be a name, and
 * a word with capitals after its first letter an acronym or a brand, such as
 * SUNY or VMWare. The first word of a sentence is capitalized anyway, so it is
 * underlined only when it is a slip of a common word.
 */
export function isMisspelling(
  word: string,
  personal: PersonalDictionary,
  ignored: readonly string[],
  sentenceStart = false,
) {
  const value = normalize(word);
  if (ignored.some((item) => sameWord(item, value))) return false;
  if (personal.flagged.some((item) => sameWord(item, value))) return true;
  if (personal.added.some((item) => sameWord(item, value))) return false;
  if (value.length < 2 || /\d/.test(value)) return false;
  if (/[A-Z]/.test(word)) {
    if (!sentenceStart || /[A-Z]/.test(word.slice(1))) return false;
    return !inDictionary(word) && slipOfCommonWord(word);
  }
  return !inDictionary(word);
}

const WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
/** Email addresses, URLs of any scheme, bare web addresses, and file names, whose parts are not words. */
const ADDRESS =
  /\bmailto:[^\s<>"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"]+|\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[a-z]{2,24}\b(?:\/[^\s<>"]*)?/g;
/** Marks the place of a picture or other object inside a line of text. */
const OBJECT = "\ufffc";

/** Nothing but space, opening quotes, or brackets since the start of the text, a line, or a sentence. */
function startsSentence(text: string, from: number) {
  for (let at = from - 1; at >= 0; at--) {
    const ch = text[at];
    if (ch === "\n") return true;
    if (/[\s"'“‘(\[]/.test(ch)) continue;
    return /[.!?…:;]/.test(ch);
  }
  return true;
}

export type SpellingToken = { word: string; from: number; to: number; sentenceStart: boolean };

/**
 * The caret is at the end of this word and the word is not yet followed by a
 * letter, so the person is still typing it. A space or punctuation finishes it.
 */
export function isTypingWord(to: number, caret: number | null, next?: string) {
  if (caret == null || caret !== to) return false;
  // A space after the word means it is finished, so the underline can show
  // while the caret is still sitting there.
  if (next && /\s/.test(next)) return false;
  return !next;
}

/** The words to check, leaving out addresses and letters joined to digits, such as jgmath2000. */
export function spellingTokens(text: string): SpellingToken[] {
  const addresses = [...text.matchAll(ADDRESS)].map((match) => [match.index, match.index + match[0].length]);
  return [...text.matchAll(WORD)].flatMap((match) => {
    const from = match.index;
    const to = from + match[0].length;
    if (addresses.some(([start, end]) => from < end && to > start)) return [];
    if (/[\d_]/.test(text[from - 1] ?? "") || /[\d_]/.test(text[to] ?? "")) return [];
    return [{ word: match[0], from, to, sentenceStart: startsSentence(text, from) }];
  });
}

/**
 * A text block's words as one string, so a word split by bold or a link is
 * read whole. Objects keep their size; a line break is a newline. `ignored`
 * holds the stretches marked to skip.
 */
function blockText(block: ProseNode) {
  let text = "";
  const ignored: [number, number][] = [];
  block.forEach((child) => {
    const start = text.length;
    if (child.isText) text += child.text ?? "";
    else text += child.type.name === "hardBreak" ? "\n" : OBJECT.repeat(child.nodeSize);
    if (child.marks.some((mark) => mark.type.name === SPELLING_IGNORE_MARK)) ignored.push([start, text.length]);
  });
  return { text, ignored };
}

const overlaps = (ranges: [number, number][], from: number, to: number) =>
  ranges.some(([start, end]) => from < end && to > start);
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function edits(word: string) {
  const splits = Array.from({ length: word.length + 1 }, (_, index) => [
    word.slice(0, index),
    word.slice(index),
  ]);
  const out = new Set<string>();
  for (const [left, right] of splits) {
    if (right) out.add(left + right.slice(1));
    if (right.length > 1) out.add(left + right[1] + right[0] + right.slice(2));
    if (right) for (const letter of LETTERS) out.add(left + letter + right.slice(1));
    for (const letter of LETTERS) out.add(left + letter + right);
  }
  return out;
}

function trigrams(word: string) {
  const padded = `^${word}$`;
  const grams: string[] = [];
  for (let index = 0; index < padded.length - 2; index++) grams.push(padded.slice(index, index + 3));
  return grams;
}

function sharedTrigrams(left: string, right: string) {
  const counts = new Map<string, number>();
  for (const gram of trigrams(left)) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let shared = 0;
  for (const gram of trigrams(right)) {
    const have = counts.get(gram) ?? 0;
    if (!have) continue;
    shared += 1;
    counts.set(gram, have - 1);
  }
  return shared;
}

/** Prefer a close, ordinary word: "movment" → movement, "teh" → the. */
export function spellingSuggestions(word: string, limit = 5) {
  const target = normalize(word).replace(/'/g, "");
  if (!/^[a-z-]+$/.test(target) || target.length > 32) return [];
  const near = edits(target);
  let candidates = [...near].filter((item) => dictionary.has(item) && item !== target).map((item) => ({
    word: item,
    distance: 1,
  }));
  if (!candidates.length && target.length <= 12) {
    const farther = new Set<string>();
    for (const item of near) for (const next of edits(item)) farther.add(next);
    candidates = [...farther]
      .filter((item) => dictionary.has(item) && !near.has(item) && (rank.get(item) ?? 99999) < 8000)
      .map((item) => ({ word: item, distance: 2 }));
  }
  candidates.sort((left, right) => {
    const score = (item: { word: string; distance: number }) =>
      item.distance * 10000 -
      sharedTrigrams(target, item.word) * 50 +
      (rank.get(item.word) ?? 99999);
    return score(left) - score(right) || left.word.localeCompare(right.word);
  });
  return candidates.slice(0, limit).map((item) => item.word);
}

export type SpellingRange = { from: number; to: number; word: string };

export function misspelledRanges(
  doc: ProseNode,
  personal: PersonalDictionary,
  ignored: readonly string[],
): SpellingRange[] {
  const ranges: SpellingRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const block = blockText(node);
    for (const token of spellingTokens(block.text)) {
      if (overlaps(block.ignored, token.from, token.to)) continue;
      if (!isMisspelling(token.word, personal, ignored, token.sentenceStart)) continue;
      ranges.push({ from: pos + 1 + token.from, to: pos + 1 + token.to, word: token.word });
    }
    return false;
  });
  return ranges;
}

export function misspelledWords(
  doc: JsonNode,
  personal: PersonalDictionary = emptyDictionary(),
  ignored: readonly string[] = [],
) {
  const words: string[] = [];
  const walk = (node: JsonNode) => {
    const children = node.content ?? [];
    if (!children.some((child) => child.type === "text")) {
      children.forEach(walk);
      return;
    }
    let text = "";
    const skip: [number, number][] = [];
    for (const child of children) {
      const start = text.length;
      text += child.type === "text" ? (child.text ?? "") : child.type === "hardBreak" ? "\n" : OBJECT;
      if (child.marks?.some((mark) => mark.type === SPELLING_IGNORE_MARK)) skip.push([start, text.length]);
    }
    for (const token of spellingTokens(text))
      if (!overlaps(skip, token.from, token.to) && isMisspelling(token.word, personal, ignored, token.sentenceStart))
        words.push(token.word);
  };
  walk(doc);
  return words;
}

export type SpellingMenuHit = SpellingRange & {
  suggestions: string[];
  x: number;
  y: number;
  /** This copy was ignored on purpose, so it is not underlined. */
  kept: boolean;
};

export function spellingHit(
  view: EditorView,
  event: Event,
  personal: PersonalDictionary,
): SpellingMenuHit | null {
  if (!(event instanceof MouseEvent)) return null;
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;
  const $pos = view.state.doc.resolve(coords.pos);
  if (!$pos.parent.isTextblock) return null;
  const { text } = blockText($pos.parent);
  const offset = coords.pos - $pos.start();
  const ignored = readProofing(view.state.doc.toJSON() as JsonNode).ignored;
  const found = spellingTokens(text).find((token) => offset >= token.from && offset <= token.to);
  if (!found || !isMisspelling(found.word, personal, ignored, found.sentenceStart)) return null;
  const from = $pos.start() + found.from;
  const to = from + found.word.length;
  return {
    from,
    to,
    word: found.word,
    suggestions: spellingSuggestions(found.word),
    x: event.clientX,
    y: event.clientY,
    kept: view.state.doc.resolve(from).marks().some((mark) => mark.type.name === SPELLING_IGNORE_MARK),
  };
}

type SpellHighlight = { currentFrom: number; currentTo: number; nonce: number };
export const spellingKey = new PluginKey<SpellHighlight>("spelling");

export function spellingHighlight(from: number, to: number) {
  return { currentFrom: from, currentTo: to };
}

export const Proofing = Extension.create({
  name: "proofing",
  addExtensions() {
    return [SpellingIgnoreMark];
  },
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: { proofing: { default: null, rendered: false } },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SpellHighlight>({
        key: spellingKey,
        state: {
          init: () => ({ currentFrom: -1, currentTo: -1, nonce: 0 }),
          apply(tr, value) {
            const meta = tr.getMeta(spellingKey) as { currentFrom: number; currentTo: number } | undefined;
            if (!tr.docChanged && !meta) return value;
            return {
              currentFrom: meta ? meta.currentFrom : tr.mapping.map(value.currentFrom),
              currentTo: meta ? meta.currentTo : tr.mapping.map(value.currentTo),
              nonce: value.nonce + 1,
            };
          },
        },
        props: {
          decorations(state) {
            const highlight = spellingKey.getState(state);
            const settings = readProofing(state.doc.toJSON() as JsonNode);
            const personal = readPersonalDictionary();
            const caret = state.selection.empty ? state.selection.from : null;
            return DecorationSet.create(
              state.doc,
              misspelledRanges(state.doc, personal, settings.ignored)
                .filter((range) => {
                  const next = state.doc.textBetween(
                    range.to,
                    Math.min(state.doc.content.size, range.to + 1),
                  );
                  return !isTypingWord(range.to, caret, next);
                })
                .map((range) =>
                Decoration.inline(range.from, range.to, {
                  class:
                    highlight &&
                    range.from === highlight.currentFrom &&
                    range.to === highlight.currentTo
                      ? "spelling-misspelling spelling-current"
                      : "spelling-misspelling",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
