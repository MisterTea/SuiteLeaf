/** Page numbers from page breaks, before the paper is measured. Heading text is not returned. */

type TocNode = {
  type: { name: string };
  textContent: string;
  attrs?: { restartAt?: unknown };
  descendants: (visit: (node: TocNode, pos: number) => boolean | void) => void;
};

export type TocSpot = { pos: number; page: number };

/** A 1-based physical page where printed numbering starts again. */
export type PageRestart = { page: number; restartAt: number };

export type PageCount = {
  page: number;
  restartAt: number | null;
  restartPage: number;
  restarts: PageRestart[];
};

export function startPageCount(): PageCount {
  return { page: 1, restartAt: null, restartPage: 1, restarts: [] };
}

function restartNumber(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const restart = Number(raw);
  return restart >= 1 && restart <= 9999 ? restart : null;
}

/** A page break moves to the next physical page. A section break can also restart the printed number. */
export function countBreak(count: PageCount, restart?: unknown) {
  count.page += 1;
  const next = restartNumber(restart);
  if (next == null) return;
  count.restartAt = next;
  count.restartPage = count.page;
  count.restarts.push({ page: count.page, restartAt: next });
}

export function countedPage(count: PageCount): number {
  if (count.restartAt == null) return count.page;
  const page = count.restartAt + (count.page - count.restartPage);
  return page >= 1 && page <= 9999 ? page : count.page;
}

/** The number printed on a measured physical page. A page before any restart stays physical. */
export function printedFromPhysical(physical: number, restarts: readonly PageRestart[]): number {
  let restartAt: number | null = null;
  let restartPage = 1;
  for (const mark of restarts) {
    if (mark.page <= physical) {
      restartAt = mark.restartAt;
      restartPage = mark.page;
    }
  }
  if (restartAt == null) return physical;
  const page = restartAt + (physical - restartPage);
  return page >= 1 && page <= 9999 ? page : physical;
}

function walkBreaks(doc: TocNode, visitHeading?: (pos: number, page: number) => void): PageCount {
  const count = startPageCount();
  doc.descendants((node, pos) => {
    if (node.type.name === "note" || node.type.name === "tableOfContents") return false;
    if (node.type.name === "sectionBreak") {
      countBreak(count, node.attrs?.restartAt);
      return false;
    }
    if (node.type.name === "pageBreak") {
      countBreak(count);
      return false;
    }
    if (visitHeading && node.type.name === "heading" && node.textContent.trim()) {
      visitHeading(pos, countedPage(count));
    }
  });
  return count;
}

export function headingPageRestarts(doc: TocNode): PageRestart[] {
  return walkBreaks(doc).restarts;
}

export function pageBreakSpots(doc: TocNode): TocSpot[] {
  const spots: TocSpot[] = [];
  walkBreaks(doc, (pos, page) => spots.push({ pos, page }));
  return spots;
}
