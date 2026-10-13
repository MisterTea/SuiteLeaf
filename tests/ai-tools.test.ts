import { describe, expect, it } from "vitest";
import { createFile, type FileRecord } from "@suiteleaf/core";
import { a1, columnIndex, columnLetter, parseA1, parseCell } from "../apps/web/src/ai/tools/sheets";
import { findRecord } from "../apps/web/src/ai/tools/files";

describe("spreadsheet addresses", () => {
  it("converts column letters both ways", () => {
    for (const [letters, index] of [["A", 0], ["Z", 25], ["AA", 26], ["AZ", 51], ["BA", 52]] as const) {
      expect(columnIndex(letters)).toBe(index);
      expect(columnLetter(index)).toBe(letters);
    }
  });

  it("parses cells, ranges in either order, sheet prefixes and whole columns", () => {
    expect(parseCell("$C$7")).toEqual({ row: 6, column: 2 });
    expect(parseA1("C5:A1")).toEqual({ startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 });
    expect(parseA1("Budget!B2")).toEqual({ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 });
    expect(parseA1("D:D")).toMatchObject({ startColumn: 3, endColumn: 3, startRow: 0 });
    expect(a1(parseA1("b2:d9"))).toBe("B2:D9");
    expect(a1(parseA1("B2"))).toBe("B2");
  });

  it("explains addresses it cannot read", () => {
    expect(() => parseCell("row 2")).toThrow(/not a cell address/);
  });
});

describe("finding files by name", () => {
  const records: FileRecord[] = [
    { file: createFile("doc", "Garden club notes") },
    { file: createFile("sheet", "Household budget 2026") },
    { file: createFile("slide", "Garden club update") },
  ];

  it("prefers exact names, then partial ones, and ignores native extensions", () => {
    expect(findRecord(records, "garden club update").file.kind).toBe("slide");
    expect(findRecord(records, "Household budget 2026.slsheet").file.kind).toBe("sheet");
    expect(findRecord(records, "budget").file.title).toBe("Household budget 2026");
  });

  it("narrows by kind and lists the files when nothing matches", () => {
    expect(findRecord(records, "garden", "doc").file.title).toBe("Garden club notes");
    expect(() => findRecord(records, "taxes")).toThrow(/"Garden club notes"/);
  });
});
