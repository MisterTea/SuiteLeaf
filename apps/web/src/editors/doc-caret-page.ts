/** A block the pagination pass already placed, with its 0-based page. */
export type PageMark = { pos: number; page: number };

/**
 * Document positions where each page starts, from marks pagination already
 * assigned. Page 1 starts at 0. Each later page starts at the earliest mark
 * on that page. This does not measure layout again.
 */
export function pageStartsFromMarks(marks: readonly PageMark[]): number[] {
  let pages = 0;
  const earliest: Array<number | undefined> = [];
  for (const mark of marks) {
    if (!Number.isInteger(mark.page) || mark.page < 0) continue;
    const current = earliest[mark.page];
    earliest[mark.page] =
      current == null ? mark.pos : Math.min(current, mark.pos);
    pages = Math.max(pages, mark.page + 1);
  }
  if (pages === 0) return [0];
  const starts = [0];
  for (let page = 1; page < pages; page++) {
    const at = earliest[page];
    const previous = starts[page - 1] ?? 0;
    starts.push(at == null ? previous : Math.max(previous, at));
  }
  return starts;
}

export function parsePageStarts(value: string | null | undefined): number[] {
  if (!value) return [0];
  const starts = value
    .split(",")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  return starts.length ? starts : [0];
}

/** 1-based page containing a document position. `starts[0]` is page 1. */
export function pageAtPosition(pos: number, starts: readonly number[]): number {
  let page = 1;
  for (let index = 0; index < starts.length; index++) {
    if (starts[index] <= pos) page = index + 1;
    else break;
  }
  return page;
}

/** Status-bar label. Chrome only: it is not written into the document. */
export function formatCaretPage(page: number, pageCount: number): string {
  const total = Math.max(1, Number.isFinite(pageCount) ? Math.floor(pageCount) : 1);
  const current = Math.min(
    total,
    Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1),
  );
  return `Page ${current} of ${total}`;
}
