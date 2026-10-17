/** Paper page breaks and a repeating print header. Not the on-screen freeze. */

export type SheetPrintSettings = {
  /** 0-based rows. A break is drawn above each one, and that row starts a page. */
  breaksAbove: number[];
  /** Repeat row 1 on every printed page, whether or not it is frozen on screen. */
  repeatFirstRow: boolean;
};

export type PrintContent = {
  print?: {
    sheets: Record<string, SheetPrintSettings>;
  };
};

export type PrintedRow = {
  /** 0-based source row. */
  source: number;
  cells: string[];
  /** A copy of row 1 added so a later page keeps its column names. */
  repeated: boolean;
};

export type PrintedPage = {
  rows: PrintedRow[];
  /** Row 1 is copied onto later pieces when a tall page is split. */
  repeatFirstRow?: boolean;
};

export function emptyPrint(): SheetPrintSettings {
  return { breaksAbove: [], repeatFirstRow: false };
}

export function readSheetPrint(
  content: PrintContent,
  sheetId: string,
): SheetPrintSettings {
  const found = content.print?.sheets[sheetId];
  return {
    breaksAbove: [...(found?.breaksAbove ?? [])],
    repeatFirstRow: !!found?.repeatFirstRow,
  };
}

/** Drop a sheet's entry when it is back to the defaults, so untouched files stay unchanged. */
export function writeSheetPrint(
  content: PrintContent,
  sheetId: string,
  settings: SheetPrintSettings,
): void {
  const sheets = { ...(content.print?.sheets ?? {}) };
  if (!settings.breaksAbove.length && !settings.repeatFirstRow)
    delete sheets[sheetId];
  else
    sheets[sheetId] = {
      breaksAbove: [...settings.breaksAbove],
      repeatFirstRow: settings.repeatFirstRow,
    };
  if (Object.keys(sheets).length) content.print = { sheets };
  else delete content.print;
}

/** Apply one field and leave the other as it is, so Undo of a break keeps the header setting. */
export function mergePrint(
  current: SheetPrintSettings,
  patch: { breaksAbove?: number[]; repeatFirstRow?: boolean },
): SheetPrintSettings {
  return {
    breaksAbove: [...(patch.breaksAbove ?? current.breaksAbove)],
    repeatFirstRow: patch.repeatFirstRow ?? current.repeatFirstRow,
  };
}

export function toggleBreak(
  breaks: number[],
  row: number,
): { breaks: number[]; added: boolean } {
  if (breaks.includes(row))
    return { breaks: breaks.filter((item) => item !== row), added: false };
  return { breaks: [...breaks, row].sort((a, b) => a - b), added: true };
}

export function printCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return "";
}

/**
 * Split the grid at manual row breaks. With no break there is one flow.
 * Repeating row 1 copies it onto later pages and does not duplicate it on page 1.
 */
export function printedPages(
  grid: readonly (readonly unknown[])[],
  settings: SheetPrintSettings,
): PrintedPage[] {
  const rowCount = grid.length;
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const cellsOf = (row: number) =>
    Array.from({ length: width }, (_, column) => printCell(grid[row]?.[column]));
  const breaks = [...new Set(settings.breaksAbove)]
    .filter((row) => row > 0 && row < rowCount)
    .sort((a, b) => a - b);
  const starts = [0, ...breaks];
  return starts
    .map((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1]! : rowCount;
      const rows: PrintedRow[] = [];
      for (let row = start; row < end; row++)
        rows.push({ source: row, repeated: false, cells: cellsOf(row) });
      if (settings.repeatFirstRow && start > 0 && rowCount > 0)
        rows.unshift({ source: 0, repeated: true, cells: cellsOf(0) });
      return {
        rows,
        ...(settings.repeatFirstRow ? { repeatFirstRow: true } : {}),
      };
    })
    .filter((page) => page.rows.length > 0);
}

export function escapePrint(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function rowHtml(row: PrintedRow): string {
  const cells = row.cells.map((cell) => `<td>${escapePrint(cell)}</td>`).join("");
  const cls = row.source === 0 ? ' class="print-header"' : "";
  return `<tr${cls}>${cells}</tr>`;
}

function tableHtml(page: PrintedPage, repeat: boolean): string {
  const head = repeat && page.rows[0]?.source === 0 ? page.rows[0] : null;
  const body = head ? page.rows.slice(1) : page.rows;
  const thead = head ? `<thead>${rowHtml(head)}</thead>` : "";
  return `<table>${thead}<tbody>${body.map(rowHtml).join("")}</tbody></table>`;
}

/** A printed sheet can be larger than the old 10,000-cell cap. Past this, the page would be too large to lay out. */
export const PRINT_MAX_CELLS = 500_000;
/** Rows on one printed page when a used range is taller than a single sheet of paper. */
export const PRINT_ROWS_PER_PAGE = 60;

export function usedCellCount(grid: readonly (readonly unknown[])[]): number {
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  return grid.length * width;
}

/**
 * Split a tall printed page so a sheet with more than 10,000 cells still prints.
 * A repeated header row stays at the top of each piece.
 */
export function paginatePrinted(
  pages: readonly PrintedPage[],
  rowsPerPage = PRINT_ROWS_PER_PAGE,
): PrintedPage[] {
  const repeating = pages.some(
    (page) => page.repeatFirstRow || page.rows.some((row) => row.repeated),
  );
  const out: PrintedPage[] = [];
  for (const page of pages) {
    if (page.rows.length <= rowsPerPage) {
      out.push(page);
      continue;
    }
    const head =
      repeating && page.rows[0]?.source === 0 ? page.rows[0] : null;
    const body = head ? page.rows.slice(1) : page.rows;
    const size = Math.max(1, rowsPerPage - (head ? 1 : 0));
    if (!body.length && head) {
      out.push({ rows: [head] });
      continue;
    }
    for (let index = 0; index < body.length; index += size) {
      const slice = body.slice(index, index + size);
      out.push({
        rows: head ? [{ ...head, repeated: index > 0 }, ...slice] : slice,
      });
    }
  }
  return out;
}

/** HTML for the existing print path. Page breaks are real pages; row 1 repeats only when asked. */
export function printMarkup(
  title: string,
  sheetName: string,
  pages: PrintedPage[],
  repeat: boolean,
): string {
  const body = pages
    .map(
      (page, index) =>
        `<article class="print-page" data-page="${index + 1}">${tableHtml(page, repeat)}</article>`,
    )
    .join("");
  return `<h1>${escapePrint(title)} — ${escapePrint(sheetName)}</h1>${body}`;
}
