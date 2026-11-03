import type { JsonNode } from "./index";
import { documentPageSettings, pageNumberAt, pageTextCapacity, type PageSettings } from "./document-layout";

type CaptionNode = {
  type?: string;
  attrs?: { captionId?: string; id?: string; pageSettings?: unknown; restartAt?: unknown };
  content?: CaptionNode[];
  text?: string;
};

function blockLines(text: string, charsPerLine: number): number {
  if (!text) return 0;
  return text.split("\n").reduce((lines, block) => {
    if (!block) return lines + 1;
    return lines + Math.max(1, Math.ceil(block.length / charsPerLine));
  }, 0);
}

function nodeText(node: CaptionNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function restartNumber(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const restart = Number(raw);
  return restart >= 1 && restart <= 9999 ? restart : null;
}

function pageMap(
  doc: { content?: CaptionNode[] },
  settings: PageSettings,
  idOf: (node: CaptionNode) => string | undefined,
): Record<string, number> {
  const { charsPerLine, linesPerPage } = pageTextCapacity(settings);
  let pageIndex = 0;
  let used = 0;
  let pageCount = 1;
  let restartAt: number | null = null;
  let restartIndex = 0;
  const found: { id: string; page: number }[] = [];
  const printedAt = (index: number) =>
    restartAt == null
      ? pageNumberAt(settings, index, pageCount).page
      : restartAt + (index - restartIndex);
  const visit = (items: CaptionNode[]) => {
    for (const node of items) {
      if (node.type === "sectionBreak") {
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
      if (node.type === "pageBreak") {
        pageIndex += 1;
        used = 0;
        pageCount = Math.max(pageCount, pageIndex + 1);
        continue;
      }
      const flow = node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock";
      if (flow) {
        const lines = Math.max(1, blockLines(nodeText(node), charsPerLine));
        if (used > 0 && used + lines > linesPerPage) {
          pageIndex += 1;
          used = 0;
        }
        const id = idOf(node);
        if (id && !found.some((item) => item.id === id)) found.push({ id, page: printedAt(pageIndex) });
        used += lines;
        while (used > linesPerPage) {
          used -= linesPerPage;
          pageIndex += 1;
        }
        pageCount = Math.max(pageCount, pageIndex + (used > 0 ? 1 : 0));
        continue;
      }
      if (node.content) visit(node.content);
    }
  };
  visit(doc.content ?? []);
  const pages: Record<string, number> = {};
  for (const item of found) {
    if (Number.isInteger(item.page) && item.page >= 1 && item.page <= 9999) pages[item.id] = item.page;
  }
  return pages;
}

/** Printed page for each caption id. The document is not changed, and the id is not a line of text. */
export function captionPageMap(doc: { content?: CaptionNode[] }, settings: PageSettings): Record<string, number> {
  return pageMap(doc, settings, (node) => node.attrs?.captionId);
}

/** Printed page for each heading id. The document is not changed, and the id is not a line of text. */
export function headingPageMap(doc: { content?: CaptionNode[] }, settings: PageSettings): Record<string, number> {
  return pageMap(doc, settings, (node) => (node.type === "heading" ? node.attrs?.id : undefined));
}

/** Page numbers for a Word export that stored page settings and did not turn page numbers off. */
export function captionPagesForExport(source: {
  attrs?: { pageSettings?: unknown };
  content?: CaptionNode[];
}): Record<string, number> | undefined {
  const stored = source.attrs?.pageSettings;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  if ((stored as { pageNumbers?: unknown }).pageNumbers === false) return undefined;
  return captionPageMap(source, documentPageSettings(source as JsonNode));
}

/** Heading pages for a Word export that stored page settings and left page numbers on. */
export function headingPagesForExport(source: {
  attrs?: { pageSettings?: unknown };
  content?: CaptionNode[];
}): Record<string, number> | undefined {
  const stored = source.attrs?.pageSettings;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  if ((stored as { pageNumbers?: unknown }).pageNumbers === false) return undefined;
  return headingPageMap(source, documentPageSettings(source as JsonNode));
}
