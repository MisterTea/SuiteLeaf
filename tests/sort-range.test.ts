import { expect, test } from "vitest";
import {
  detectHeaderRow,
  rangeSpan,
  sortBody,
  sortColumnLabels,
} from "../apps/web/src/sort-range";

const volunteers = [
  ["Name", "Team", "Hours"],
  ["Priya Shah", "Kitchen", 14],
  ["Wen Zhou", "Greeters", 31],
];
const table = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 };

test("a text row over numbers is detected as a header", () => {
  expect(detectHeaderRow(volunteers)).toBe(true);
  expect(
    detectHeaderRow([
      ["Hours", null],
      [3, null],
    ]),
  ).toBe(true);
});

test("data rows are not mistaken for a header", () => {
  expect(detectHeaderRow([[3], [1], [2]])).toBe(false);
  expect(
    detectHeaderRow([
      ["Name", 2024],
      ["Wen", 31],
    ]),
  ).toBe(false);
  expect(detectHeaderRow([["b"], ["a"]])).toBe(false);
  expect(
    detectHeaderRow([
      [null, ""],
      [1, 2],
    ]),
  ).toBe(false);
  expect(detectHeaderRow([["Name", "Hours"]])).toBe(false);
});

test("sort-by choices use header names only when row 1 is a header", () => {
  const offset = { ...table, startColumn: 3, endColumn: 5 };
  expect(sortColumnLabels(volunteers, offset, true)).toEqual([
    "Name",
    "Team",
    "Hours",
  ]);
  expect(sortColumnLabels(volunteers, offset, false)).toEqual([
    "Column D",
    "Column E",
    "Column F",
  ]);
  expect(sortColumnLabels([["Name", null]], table, true)).toEqual([
    "Name",
    "Column B",
    "Column C",
  ]);
});

test("the header row stays out of the sorted rows", () => {
  expect(sortBody(table, true)).toEqual({ ...table, startRow: 1 });
  expect(sortBody(table, false)).toEqual(table);
  expect(() => sortBody({ ...table, endRow: 1 }, true)).toThrow(/two rows/);
});

test("the dialog title spells out the range", () => {
  expect(
    rangeSpan({ startRow: 0, endRow: 8, startColumn: 0, endColumn: 2 }),
  ).toBe("A1 to C9");
});
