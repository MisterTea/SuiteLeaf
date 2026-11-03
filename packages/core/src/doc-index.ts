/**
 * An index built from marks on the document text.
 * The input document is not changed.
 * With page settings, each line uses the printed page number from the export
 * line box. Without them, the line keeps the section number.
 */

import { lowerRoman, pageNumberAt, pageTextCapacity, type PageSettings } from "./document-layout";

type IndexNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: IndexNode[];
  text?: string;
};

type Entry = {
  term: string;
  subentry: string;
  see: string;
  seeAlso: string;
  section: number;
  page: number;
  origin: number | null;
  originIndex: number;
};

function restartNumber(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const restart = Number(raw);
  return restart >= 1 && restart <= 9999 ? restart : null;
}

function pageLabel(settings: PageSettings, page: number): string {
  if (settings.pageNumberFormat === "roman") return lowerRoman(page);
  if (settings.pageNumberFormat === "page") return `Page ${page}`;
  return String(page);
}

function blockLines(text: string, charsPerLine: number): number {
  if (!text) return 0;
  return text.split("\n").reduce((lines, block) => {
    if (!block) return lines + 1;
    return lines + Math.max(1, Math.ceil(block.length / charsPerLine));
  }, 0);
}

function field(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\u200B-\u200D\uFEFF\u2060]+|[\s\u200B-\u200D\uFEFF\u2060]+$/g, "");
}

function nodeText(node: IndexNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function collect(
  nodes: IndexNode[],
  section: { n: number },
  entries: Entry[],
  seen: Set<string>,
  settings?: PageSettings,
) {
  const { charsPerLine, linesPerPage } = settings
    ? pageTextCapacity(settings)
    : { charsPerLine: 1, linesPerPage: 1 };
  let pageIndex = 0;
  let used = 0;
  let pageCount = 1;
  let restartAt: number | null = null;
  let restartIndex = 0;
  const pending: Entry[] = [];
  const remember = (node: IndexNode, page: number) => {
    if (node.type !== "text") return;
    for (const mark of node.marks ?? []) {
      if (mark.type !== "index") continue;
      const term = field(mark.attrs?.term);
      const subentry = field(mark.attrs?.subentry);
      const see = field(mark.attrs?.see);
      const seeAlso = field(mark.attrs?.seeAlso);
      const key = `${term.toLocaleLowerCase("en")}\n${subentry.toLocaleLowerCase("en")}\n${see.toLocaleLowerCase("en")}\n${seeAlso.toLocaleLowerCase("en")}`;
      if (!term || seen.has(key)) continue;
      seen.add(key);
      pending.push({
        term,
        subentry,
        see,
        seeAlso,
        section: section.n,
        page,
        origin: restartAt,
        originIndex: restartIndex,
      });
    }
  };
  const visit = (items: IndexNode[]) => {
    for (const node of items) {
      if (node.type === "sectionBreak") {
        section.n += 1;
        pageIndex += 1;
        used = 0;
        pageCount = Math.max(pageCount, pageIndex + 1);
        const restart = restartNumber(node.attrs?.restartAt);
        if (restart != null) {
          restartAt = restart;
          restartIndex = pageIndex;
        }
        continue;
      }
      if (node.type === "note") {
        const marks = (items: IndexNode[]) => {
          for (const child of items) {
            if (child.type === "text") remember(child, pageIndex);
            else if (child.content) marks(child.content);
          }
        };
        if (node.content) marks(node.content);
        continue;
      }
      if (node.type === "index" || node.type === "tableOfContents") continue;
      if (node.type === "pageBreak") {
        pageIndex += 1;
        used = 0;
        pageCount = Math.max(pageCount, pageIndex + 1);
        continue;
      }
      const flow = node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock";
      if (flow) {
        const lines = Math.max(1, blockLines(nodeText(node), charsPerLine));
        if (settings && used > 0 && used + lines > linesPerPage) {
          pageIndex += 1;
          used = 0;
        }
        const start = pageIndex;
        if (node.content) {
          for (const child of node.content) remember(child, start);
        }
        if (settings) {
          used += lines;
          while (used > linesPerPage) {
            used -= linesPerPage;
            pageIndex += 1;
          }
          pageCount = Math.max(pageCount, pageIndex + (used > 0 ? 1 : 0));
        }
        continue;
      }
      if (node.type === "text") remember(node, pageIndex);
      if (node.content) visit(node.content);
    }
  };
  visit(nodes);
  if (settings) {
    for (const entry of pending) {
      entry.page =
        entry.origin == null
          ? pageNumberAt(settings, entry.page, pageCount).page
          : entry.origin + (entry.page - entry.originIndex);
    }
  }
  entries.push(...pending);
}

const SECRET_SEE = /password|secret|token|authorization|api[-_]?key|credential/i;

function entryLine(entry: Entry, terms: Set<string>, settings?: PageSettings): string {
  const label = entry.subentry ? `${entry.term}, ${entry.subentry}` : entry.term;
  const see = entry.see.toLocaleLowerCase("en");
  const pointsAtItself =
    see === entry.term.toLocaleLowerCase("en") || see === label.toLocaleLowerCase("en");
  if (entry.see && !pointsAtItself) {
    if (!terms.has(see)) {
      return SECRET_SEE.test(entry.see)
        ? `${label}. That index term is missing.`
        : `${label}, see ${entry.see}. That index term is missing.`;
    }
    return `${label}, see ${entry.see}`;
  }
  const line = settings
    ? `${label}, ${pageLabel(settings, entry.page)}`
    : `${label}, section ${entry.section}`;
  const also = entry.seeAlso.toLocaleLowerCase("en");
  if (!entry.seeAlso || also === entry.term.toLocaleLowerCase("en") || also === label.toLocaleLowerCase("en")) {
    return line;
  }
  if (!terms.has(also)) {
    return SECRET_SEE.test(entry.seeAlso)
      ? `${line}. That index term is missing.`
      : `${line}. See also ${entry.seeAlso}. That index term is missing.`;
  }
  return `${line}. See also ${entry.seeAlso}`;
}

/** Rewrite each index from the marked terms that are still in the document. */
export function refreshIndex<T extends { content?: IndexNode[] }>(doc: T, settings?: PageSettings): T {
  const copy = structuredClone(doc);
  const entries: Entry[] = [];
  collect(copy.content ?? [], { n: 1 }, entries, new Set(), settings);
  entries.sort(
    (a, b) =>
      a.term.localeCompare(b.term, "en") ||
      a.subentry.localeCompare(b.subentry, "en") ||
      a.see.localeCompare(b.see, "en") ||
      a.page - b.page ||
      a.section - b.section,
  );
  const terms = new Set(entries.map((entry) => entry.term.toLocaleLowerCase("en")));
  const walk = (nodes: IndexNode[]) => {
    for (const node of nodes) {
      if (node.type === "index") {
        node.content = entries.map((entry) => ({
          type: "paragraph",
          content: [
            {
              type: "text",
              text: entryLine(entry, terms, settings),
            },
          ],
        }));
        continue;
      }
      if (node.content) walk(node.content);
    }
  };
  walk(copy.content ?? []);
  return copy;
}
