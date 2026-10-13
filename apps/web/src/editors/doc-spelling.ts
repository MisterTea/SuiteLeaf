import type { JsonNode } from "@suiteleaf/core";
import { Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { englishHeadwords } from "./english-words";
import { readProofing, type ProofingSettings } from "./doc-word-count";

export type PersonalDictionary = { added: string[]; flagged: string[] };

export const PERSONAL_DICTIONARY_KEY = "suiteleaf.personal-dictionary";

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
  } catch {
    /* private mode */
  }
}

const sameWord = (left: string, right: string) =>
  left.toLowerCase().replace(/’/g, "'") === right.toLowerCase().replace(/’/g, "'");

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
  return false;
}

export function isMisspelling(
  word: string,
  personal: PersonalDictionary,
  ignored: readonly string[],
) {
  const value = normalize(word);
  if (ignored.some((item) => sameWord(item, value))) return false;
  if (personal.flagged.some((item) => sameWord(item, value))) return true;
  if (personal.added.some((item) => sameWord(item, value))) return false;
  if (value.length < 2 || /\d/.test(value)) return false;
  return !inDictionary(value);
}

const WORD = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
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
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(WORD)) {
      const word = match[0];
      if (!isMisspelling(word, personal, ignored)) continue;
      const from = pos + (match.index ?? 0);
      ranges.push({ from, to: from + word.length, word });
    }
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
    if (node.text) {
      for (const match of node.text.matchAll(WORD)) {
        if (isMisspelling(match[0], personal, ignored)) words.push(match[0]);
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return words;
}

export type SpellingMenuHit = SpellingRange & {
  suggestions: string[];
  x: number;
  y: number;
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
  const text = $pos.parent.textContent;
  const offset = coords.pos - $pos.start();
  const ignored = readProofing(view.state.doc.toJSON() as JsonNode).ignored;
  let found: RegExpExecArray | null = null;
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) found = match;
  }
  if (!found || !isMisspelling(found[0], personal, ignored)) return null;
  const start = found.index ?? 0;
  const from = $pos.start() + start;
  const to = from + found[0].length;
  return {
    from,
    to,
    word: found[0],
    suggestions: spellingSuggestions(found[0]),
    x: event.clientX,
    y: event.clientY,
  };
}

type SpellHighlight = { currentFrom: number; currentTo: number; nonce: number };
export const spellingKey = new PluginKey<SpellHighlight>("spelling");

export function spellingHighlight(from: number, to: number) {
  return { currentFrom: from, currentTo: to };
}

export const Proofing = Extension.create({
  name: "proofing",
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
            return DecorationSet.create(
              state.doc,
              misspelledRanges(state.doc, personal, settings.ignored).map((range) =>
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
