import type { Node as PMNode } from "@tiptap/pm/model";
import type NSpell from "nspell";

export interface Misspelling {
  word: string;
  from: number;
  to: number;
  suggestions: string[];
}

let checker: Promise<NSpell> | undefined;

/** The English (US) Hunspell checker, loaded on first use. */
export function spellchecker() {
  return (checker ??= (async () => {
    const [{ default: nspell }, aff, dic] = await Promise.all([
      import("nspell"),
      import("dictionary-en-files/index.aff?raw"),
      import("dictionary-en-files/index.dic?raw"),
    ]);
    return nspell(aff.default, dic.default);
  })());
}

const WORD = /[A-Za-z\u00C0-\u024F]+(?:['\u2019][A-Za-z]+)*/g;

/** Words worth checking: not acronyms, initials or words next to digits/URLs. */
function checkable(word: string, text: string, index: number) {
  if (word.length < 2 || /^[A-Z]+$/.test(word)) return false;
  const before = text[index - 1] ?? " ",
    after = text[index + word.length] ?? " ";
  return !/[\d@/_.:-]/.test(before) && !/[\d@/_]/.test(after);
}

/** Misspelled words in a document, in order, with up to three suggestions each. */
export function findMisspellings(doc: PMNode, spell: NSpell, ignored: ReadonlySet<string> = new Set()) {
  const found: Misspelling[] = [];
  const cache = new Map<string, string[] | null>();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === "link" || m.type.name === "code")) return;
    const text = node.text;
    for (const match of text.matchAll(WORD)) {
      const word = match[0].replace(/\u2019/g, "'");
      if (!checkable(word, text, match.index!) || ignored.has(word.toLowerCase())) continue;
      if (!cache.has(word)) cache.set(word, spell.correct(word) ? null : spell.suggest(word).slice(0, 3));
      const suggestions = cache.get(word);
      if (suggestions)
        found.push({ word, from: pos + match.index!, to: pos + match.index! + match[0].length, suggestions });
    }
  });
  return found;
}
