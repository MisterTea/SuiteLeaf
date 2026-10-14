import type { JsonNode } from "@suiteleaf/core";
import type { Node as ProseNode } from "@tiptap/pm/model";

/** Saved on the document so exclusions and ignored words travel with the file. */
export type ProofingSettings = {
  stopAtHeading: string | null;
  /** Word and Docs leave footnotes out until the reader asks for them. */
  countFootnotes: boolean;
  ignored: string[];
  /** Grammar phrases the reader skipped. Separate from ignored spellings. */
  ignoredGrammar: string[];
};

export const defaultProofing: ProofingSettings = {
  stopAtHeading: null,
  countFootnotes: false,
  ignored: [],
  ignoredGrammar: [],
};

export const WORD_COUNT_VISIBILITY_KEY = "suiteleaf.doc-word-count";

export function wordCountIsVisible(): boolean {
  try {
    return localStorage.getItem(WORD_COUNT_VISIBILITY_KEY) !== "hidden";
  } catch {
    return true;
  }
}

export function setWordCountVisible(visible: boolean) {
  try {
    localStorage.setItem(
      WORD_COUNT_VISIBILITY_KEY,
      visible ? "shown" : "hidden",
    );
  } catch {
    /* private mode */
  }
}

export function readProofing(doc: JsonNode | null | undefined): ProofingSettings {
  const raw = doc?.attrs?.proofing;
  if (!raw || typeof raw !== "object")
    return { ...defaultProofing, ignored: [], ignoredGrammar: [] };
  const value = raw as Partial<ProofingSettings>;
  const stop = typeof value.stopAtHeading === "string" ? value.stopAtHeading.trim() : "";
  const phrases = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((word): word is string => typeof word === "string" && word.trim().length > 0)
      : [];
  return {
    stopAtHeading: stop || null,
    countFootnotes: value.countFootnotes === true,
    ignored: phrases(value.ignored),
    ignoredGrammar: phrases(value.ignoredGrammar),
  };
}

export type TextStats = {
  words: number;
  characters: number;
  charactersWithoutSpaces: number;
};

export type DocumentCounts = TextStats & {
  paragraphs: number;
  headings: string[];
  hasFootnotes: boolean;
  footnoteWords: number;
};

/**
 * Microsoft Word's Word Count dialog (ComputeStatistics), for ordinary prose:
 * tokens split on whitespace and on en/em dashes; a token counts only when it
 * contains a letter or number, so "well-known" is one word and "..." is none.
 * Paragraph marks are not characters. Headers and footers are not in the
 * document body, so they are not counted.
 */
const WORD_BREAK = /[\s\u2013\u2014]+/u;
const SPACES = /[ \t\u00a0\u2002\u2003]/g;

export function countPlainText(text: string): TextStats {
  const body = text.replace(/[\n\r]/g, "");
  return {
    words: text.split(WORD_BREAK).filter((token) => /[\p{L}\p{N}]/u.test(token)).length,
    characters: [...body].length,
    charactersWithoutSpaces: [...body.replace(SPACES, "")].length,
  };
}

function isFootnote(node: JsonNode) {
  return node.type === "footnote" || node.type === "endnote";
}

function blockText(node: JsonNode): string {
  let text = "";
  for (const child of node.content ?? []) {
    if (child.type === "text") text += child.text ?? "";
    else if (child.type === "equation") text += String(child.attrs?.plain ?? "");
    else if (child.type === "hardBreak") text += " ";
    else text += blockText(child);
  }
  return text;
}

const TEXT_BLOCK = new Set(["paragraph", "heading", "codeBlock"]);

export function countDocument(doc: JsonNode, settings: ProofingSettings): DocumentCounts {
  const headings: string[] = [];
  const chunks: string[] = [];
  const footnoteChunks: string[] = [];
  let paragraphs = 0;
  let stopped = false;
  let hasFootnotes = false;

  const visit = (node: JsonNode, inFootnote: boolean) => {
    if (isFootnote(node)) {
      hasFootnotes = true;
      for (const child of node.content ?? []) visit(child, true);
      return;
    }
    if (node.type === "heading") {
      const heading = blockText(node).trim();
      headings.push(heading);
      if (!stopped && settings.stopAtHeading && heading === settings.stopAtHeading) {
        stopped = true;
        return;
      }
    }
    if (TEXT_BLOCK.has(node.type)) {
      const text = blockText(node);
      if (inFootnote) {
        footnoteChunks.push(text);
        if (settings.countFootnotes) paragraphs += 1;
      } else if (!stopped) {
        paragraphs += 1;
        chunks.push(text);
      }
      return;
    }
    for (const child of node.content ?? []) visit(child, inFootnote);
  };
  for (const child of doc.content ?? []) visit(child, false);

  const main = countPlainText(chunks.join("\n"));
  const notes = countPlainText(footnoteChunks.join("\n"));
  const stats = settings.countFootnotes
    ? {
        words: main.words + notes.words,
        characters: main.characters + notes.characters,
        charactersWithoutSpaces: main.charactersWithoutSpaces + notes.charactersWithoutSpaces,
      }
    : main;
  return { ...stats, paragraphs, headings, hasFootnotes, footnoteWords: notes.words };
}

export function stopPosition(doc: ProseNode, heading: string | null): number | null {
  if (!heading) return null;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "heading" && node.textContent.trim() === heading) {
      found = pos;
      return false;
    }
  });
  return found;
}

export type SelectionSnapshot = {
  stats: TextStats;
  paragraphs: number;
  /** Share of the document the selection covers, for an on-screen page estimate. */
  fraction: number;
};

/** Counts the selected slice, stopping at an excluded heading so N never exceeds the total. */
export function selectionSnapshot(
  doc: ProseNode,
  from: number,
  to: number,
  stop: number | null,
): SelectionSnapshot | null {
  if (from === to) return null;
  const end = stop === null ? to : Math.min(to, stop);
  if (end <= from)
    return {
      stats: { words: 0, characters: 0, charactersWithoutSpaces: 0 },
      paragraphs: 0,
      fraction: 0,
    };
  let paragraphs = 0;
  doc.nodesBetween(from, end, (node) => {
    if (TEXT_BLOCK.has(node.type.name)) paragraphs += 1;
  });
  return {
    stats: countPlainText(doc.textBetween(from, end, "\n", "\n")),
    paragraphs,
    fraction: (end - from) / Math.max(1, doc.content.size),
  };
}

export function selectionPages(fraction: number, pageCount: number) {
  if (pageCount <= 1) return pageCount > 0 ? 1 : 0;
  return Math.min(pageCount, Math.max(1, Math.ceil(fraction * pageCount - 1e-9)));
}

const formatNumber = (value: number) => value.toLocaleString("en-US");

export function formatWordCount(input: {
  totalWords: number;
  selectionWords: number | null;
  excludes: string[];
}) {
  const base =
    input.selectionWords === null
      ? `${formatNumber(input.totalWords)} words`
      : `${formatNumber(input.selectionWords)} of ${formatNumber(input.totalWords)} words`;
  return input.excludes.length ? `${base} (excludes ${input.excludes.join(" and ")})` : base;
}

export function exclusionNotes(counts: DocumentCounts, settings: ProofingSettings) {
  const notes: string[] = [];
  if (settings.stopAtHeading) notes.push(settings.stopAtHeading);
  if (counts.hasFootnotes && !settings.countFootnotes) notes.push("footnotes");
  return notes;
}
