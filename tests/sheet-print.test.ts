import { expect, test } from "vitest";
import { createFile, parseFile, serializeFile } from "../packages/core/src";

import {
  PRINT_MAX_CELLS,
  escapePrint,
  mergePrint,
  paginatePrinted,
  printMarkup,
  printedPages,
  toggleBreak,
  usedCellCount,
  writeSheetPrint,
  type PrintContent,
} from "../apps/web/src/editors/sheet-print";

const budget = [
  ["Month", "Rent", "Paid"],
  ["January 2024", 1450, "Yes"],
  ["February 2024", 1450, "Yes"],
  ["March 2025", 1450, "Yes"],
  ["April 2025", 1450, "No"],
];

test("a row break splits pages above the selected row and leaves the cells alone", () => {
  const grid = structuredClone(budget);
  const pages = printedPages(grid, { breaksAbove: [3], repeatFirstRow: false });
  expect(grid).toEqual(budget);
  expect(pages).toHaveLength(2);
  expect(pages[0]!.rows.map((row) => row.cells[0])).toEqual([
    "Month",
    "January 2024",
    "February 2024",
  ]);
  expect(pages[1]!.rows.map((row) => row.cells[0])).toEqual([
    "March 2025",
    "April 2025",
  ]);
  expect(pages[1]!.rows[0]!.repeated).toBe(false);
  expect(pages[1]!.rows.some((row) => row.cells.includes("Month"))).toBe(false);
});

test("repeating row 1 puts the header on page 2 without a second copy on page 1", () => {
  const pages = printedPages(budget, { breaksAbove: [3], repeatFirstRow: true });
  expect(pages[0]!.rows.map((row) => row.cells[0])).toEqual([
    "Month",
    "January 2024",
    "February 2024",
  ]);
  expect(pages[0]!.rows[0]!.repeated).toBe(false);
  expect(pages[1]!.rows[0]).toMatchObject({
    source: 0,
    repeated: true,
    cells: ["Month", "Rent", "Paid"],
  });
  expect(pages[1]!.rows[1]!.cells[0]).toBe("March 2025");
});

test("with no break the sheet is one flow, even when the header is set to repeat", () => {
  const pages = printedPages(budget, { breaksAbove: [], repeatFirstRow: true });
  expect(pages).toHaveLength(1);
  expect(pages[0]!.rows.filter((row) => row.source === 0)).toHaveLength(1);
  expect(printedPages(budget, { breaksAbove: [0, 3], repeatFirstRow: false })[0]!.rows).toHaveLength(3);
});

test("one undo of a break keeps the repeating header", () => {
  expect(toggleBreak([], 15)).toEqual({ breaks: [15], added: true });
  expect(toggleBreak([15, 20], 15)).toEqual({ breaks: [20], added: false });
  const afterBreak = mergePrint(
    { breaksAbove: [], repeatFirstRow: false },
    { breaksAbove: [15] },
  );
  const withHeader = mergePrint(afterBreak, { repeatFirstRow: true });
  const undone = mergePrint(withHeader, { breaksAbove: [] });
  expect(undone).toEqual({ breaksAbove: [], repeatFirstRow: true });
  expect(printedPages(budget, undone)).toHaveLength(1);
});

test("print markup repeats the header on page 2 and escapes cell text", () => {
  const pages = printedPages(
    [
      ["Month", "Rent"],
      ["<March>", 1],
    ],
    { breaksAbove: [1], repeatFirstRow: true },
  );
  const html = printMarkup("Rent & budget", "Sheet", pages, true);
  expect(html).toContain("Rent &amp; budget");
  expect(html).toContain("&lt;March&gt;");
  expect(html.match(/<thead>/g)).toHaveLength(2);
  const plain = printMarkup("Budget", "Sheet", printedPages([["A"], ["B"]], { breaksAbove: [1], repeatFirstRow: false }), false);
  expect(plain).not.toContain("<thead>");
  expect(escapePrint(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
});

test("a sheet larger than 10,000 cells splits across printed pages", () => {
  const rows = Array.from({ length: 200 }, () => Array.from({ length: 60 }, () => 1));
  expect(usedCellCount(rows)).toBe(12_000);
  expect(usedCellCount(rows)).toBeGreaterThan(10_000);
  expect(PRINT_MAX_CELLS).toBeGreaterThan(10_000);
  const pages = paginatePrinted(printedPages(rows, { breaksAbove: [], repeatFirstRow: false }));
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.every((page) => page.rows.length <= 60)).toBe(true);
  expect(pages.flatMap((page) => page.rows)).toHaveLength(200);
});

test("a repeated print header stays on each piece of a tall page", () => {
  const rows = Array.from({ length: 80 }, (_, index) => [String(index)]);
  const printed = printedPages(rows, { breaksAbove: [10], repeatFirstRow: true });
  const pages = paginatePrinted(printed, 15);
  expect(pages.slice(1).every((page) => page.rows[0]?.cells[0] === "0")).toBe(true);
  expect(pages.some((page) => page.rows[0]?.repeated)).toBe(true);
});

test("print settings survive the native file round trip and can be cleared", () => {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("expected a sheet");
  const id = file.content.workbook.sheetOrder[0]!;
  writeSheetPrint(file.content, id, { breaksAbove: [15], repeatFirstRow: true });
  const saved = parseFile(serializeFile(file));
  if (saved.kind !== "sheet") throw new Error("expected a sheet");
  expect(saved.content.print?.sheets[id]).toEqual({
    breaksAbove: [15],
    repeatFirstRow: true,
  });
  const cleared: PrintContent = saved.content;
  writeSheetPrint(cleared, id, { breaksAbove: [], repeatFirstRow: false });
  expect(cleared.print).toBeUndefined();
});
