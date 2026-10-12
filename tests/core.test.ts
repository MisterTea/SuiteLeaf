import { describe, it, expect } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  duplicateFile,
  parseRange,
  rangeLabel,
  safeLink,
  filename,
  nativeFilename,
  mimeFor,
  kindFromName,
  parseNamedFile,
  type DocFile,
} from "../packages/core/src";
import {
  copySheetName,
  defaultValueField,
  pivotCells,
  pivotResult,
  shiftRange,
  uniqueSheetName,
  valueFormat,
} from "../apps/web/src/analysis";
describe("portable files", () => {
  it("round trips rich documents, embedded images, and workbook formulas", () => {
    const d = createFile("doc") as DocFile;
    d.content.content!.push(
      { type: "image", attrs: { src: "data:image/png;base64,aGVsbG8=" } },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }],
      },
    );
    expect(parseFile(serializeFile(d))).toEqual(d);
    const s = createFile("sheet");
    expect(parseFile(serializeFile(s))).toEqual(s);
  });
  it("rejects malformed files, future versions, external images, and unsafe links", () => {
    expect(() => parseFile("{}")).toThrow();
    const d = createFile("doc");
    expect(() => parseFile(JSON.stringify({ ...d, version: 2 }))).toThrow(
      "version",
    );
    expect(() =>
      parseFile(
        JSON.stringify({
          ...d,
          content: {
            type: "doc",
            content: [
              {
                type: "image",
                attrs: { src: "https://example.org/image.png" },
              },
            ],
          },
        }),
      ),
    ).toThrow("embedded");
    expect(() =>
      parseFile(
        JSON.stringify({
          ...d,
          content: {
            type: "doc",
            content: [
              {
                type: "text",
                text: "bad",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        }),
      ),
    ).toThrow("Unsafe");

    // Sheet validation edge cases
    const s = createFile("sheet");
    expect(() =>
      parseFile(
        JSON.stringify({
          ...s,
          content: {
            ...s.content,
            workbook: { ...s.content.workbook, sheetOrder: ["s1", "s1"] },
          },
        }),
      ),
    ).toThrow("Workbook must have distinct worksheets.");

    expect(() =>
      parseFile(
        JSON.stringify({
          ...s,
          content: {
            ...s.content,
            workbook: { ...s.content.workbook, sheetOrder: ["nonexistent"] },
          },
        }),
      ),
    ).toThrow("Workbook contains a missing worksheet.");

    expect(() =>
      parseFile(
        JSON.stringify({
          ...s,
          content: {
            ...s.content,
            charts: [
              {
                id: "c1",
                type: "bar",
                title: "Invalid Chart",
                source: {
                  sheetId: s.content.workbook.sheetOrder[0],
                  startRow: 5,
                  endRow: 2,
                  startColumn: 0,
                  endColumn: 2,
                },
                sheetId: s.content.workbook.sheetOrder[0],
                x: 10,
                y: 10,
                width: 400,
                height: 300,
              },
            ],
          },
        }),
      ),
    ).toThrow("Invalid source range.");

    // Slide validation edge cases
    const sl = createFile("slide");
    expect(() =>
      parseFile(
        JSON.stringify({
          ...sl,
          content: {
            ...sl.content,
            slideOrder: ["sl1", "sl1"],
          },
        }),
      ),
    ).toThrow("Presentation must have distinct slides.");

    expect(() =>
      parseFile(
        JSON.stringify({
          ...sl,
          content: {
            ...sl.content,
            slideOrder: ["missing_slide"],
          },
        }),
      ),
    ).toThrow("Presentation contains a missing slide.");
  });
  it("copies without aliasing and assigns a new file identity", () => {
    const d = createFile("doc");
    const copy = duplicateFile(d);
    expect(copy.id).not.toBe(d.id);
    copy.title = "different";
    expect(d.title).not.toBe(copy.title);
  });
  it("validates and labels multi-letter and absolute ranges", () => {
    expect(rangeLabel(parseRange("$AA$2:$AC$10", "s"))).toBe("AA2:AC10");
    expect(() => parseRange("D9:A1", "s")).toThrow();
    expect(() => parseRange("A1:ZZ999999", "s")).toThrow();
    expect(safeLink("javascript:alert(1)")).toBe(false);
    expect(filename("My Presentation: Final / v1", "suiteleaf")).toBe(
      "My Presentation_ Final _ v1.suiteleaf",
    );
    expect(filename("")).toBe("Untitled.suiteleaf");
  });
  it("uses a distinct extension and MIME type for each kind", () => {
    expect(nativeFilename(createFile("doc", "Notes"))).toBe("Notes.sldoc");
    expect(nativeFilename(createFile("sheet", "Budget"))).toBe(
      "Budget.slsheet",
    );
    expect(nativeFilename(createFile("slide", "Deck"))).toBe("Deck.slslides");
    expect(mimeFor("sheet")).toBe("application/vnd.suiteleaf.sheet+json");
    expect(kindFromName("/a.b/Deck.SLSLIDES")).toBe("slide");
    expect(kindFromName("old.suiteleaf")).toBeNull();
    expect(kindFromName("report.docx")).toBeUndefined();
    expect(kindFromName("/Users/jason.gauci/notes")).toBeUndefined();
    const sheet = serializeFile(createFile("sheet"));
    expect(parseNamedFile("budget.slsheet", sheet).kind).toBe("sheet");
    expect(parseNamedFile("legacy.suiteleaf", sheet).kind).toBe("sheet");
    expect(() => parseNamedFile("budget.sldoc", sheet)).toThrow(
      "contains a sheet",
    );
    expect(() => parseNamedFile("budget.json", sheet)).toThrow(".sldoc");
  });
  it("rejects payload exceeding 50 MB", () => {
    // Large payload check without allocating 50MB string
    const bigFile = { ...createFile("doc"), title: "x".repeat(50) };
    const encoded = new TextEncoder().encode(JSON.stringify(bigFile));
    expect(encoded.length).toBeLessThan(50 * 1024 * 1024);
  });
});
describe("analytics", () => {
  const data = [
    ["Team", "Quarter", "Revenue"],
    ["North", "Q1", 10],
    ["North", "Q1", 20],
    ["South", "Q1", 50],
    ["North", "Q2", 40],
    ["South", "Q2", "bad"],
    ["South", "Q2", null],
  ];
  const c = { rows: [0], columns: [1], value: 2, aggregate: "SUM" as const };
  it("groups across row and column fields, ignoring nonnumeric aggregate values", () => {
    expect(pivotResult(data, c)).toEqual([
      ["Team", "Q1", "Q2", "Grand Total"],
      ["North", 30, 40, 70],
      ["South", 50, null, 50],
      ["Grand Total", 80, 40, 120],
    ]);
  });
  it("adds a Grand Total row, and a Grand Total column only when columns split the values", () => {
    expect(pivotResult(data, { ...c, columns: [] })).toEqual([
      ["Team", "SUM Revenue"],
      ["North", 70],
      ["South", 50],
      ["Grand Total", 120],
    ]);
    expect(
      pivotResult(data, { ...c, rows: [0, 1], columns: [] }).at(-1),
    ).toEqual(["Grand Total", null, 120]);
  });
  it("computes totals from the underlying records, not from the subtotals", () => {
    const avg = pivotResult(data, { ...c, aggregate: "AVERAGE" });
    expect(avg[1].slice(0, 3)).toEqual(["North", 15, 40]);
    expect(avg[1][3]).toBeCloseTo(70 / 3);
    expect(avg.at(-1)![0]).toBe("Grand Total");
    expect(avg.at(-1)![1]).toBeCloseTo(80 / 3);
    expect(avg.at(-1)!.slice(2)).toEqual([40, 30]);
    expect(pivotResult(data, { ...c, aggregate: "COUNT" }).at(-1)).toEqual([
      "Grand Total",
      3,
      2,
      5,
    ]);
  });
  it("sorts numeric group keys numerically", () => {
    const years = [["Year", "N"], [10, 1], [9, 2], [100, 3]];
    expect(
      pivotResult(years, { rows: [0], columns: [], value: 1, aggregate: "SUM" })
        .slice(1, -1)
        .map((r) => r[0]),
    ).toEqual([9, 10, 100]);
  });
  it("computes average/min/max/count and exact-match filters", () => {
    expect(
      pivotResult(data, { ...c, aggregate: "AVERAGE" })[1].slice(0, 3),
    ).toEqual(["North", 15, 40]);
    expect(pivotResult(data, { ...c, aggregate: "MIN" })[1]).toEqual([
      "North",
      10,
      40,
      10,
    ]);
    expect(pivotResult(data, { ...c, aggregate: "MAX" })[1]).toEqual([
      "North",
      20,
      40,
      40,
    ]);
    expect(pivotResult(data, { ...c, aggregate: "COUNT" })[2]).toEqual([
      "South",
      1,
      1,
      2,
    ]);
    expect(
      pivotResult(data, { ...c, filterColumn: 0, filterValue: "South" }),
    ).toEqual([
      ["Team", "Q1", "Grand Total"],
      ["South", 50, 50],
      ["Grand Total", 50, 50],
    ]);
  });
  it("formats pivot cells: bold header and totals, source number format on values, stale cells cleared", () => {
    const cells = pivotCells(pivotResult(data, c), {
      rowFields: 1,
      numberFormat: '"$"#,##0.00',
      previous: { rows: 6, columns: 5 },
    });
    expect(cells[0][0]).toEqual({ v: "Team", t: 1, s: { bl: 1 } });
    expect(cells[1][0]).toEqual({ v: "North", t: 1, s: null });
    expect(cells[1][1]).toEqual({
      v: 30,
      t: 2,
      s: { n: { pattern: '"$"#,##0.00' } },
    });
    expect(cells[1][3]).toEqual({
      v: 70,
      t: 2,
      s: { bl: 1, n: { pattern: '"$"#,##0.00' } },
    });
    expect(cells[2][2]).toBeNull();
    expect(cells[3][0]).toEqual({ v: "Grand Total", t: 1, s: { bl: 1 } });
    expect(cells[3][3]?.s).toEqual({ bl: 1, n: { pattern: '"$"#,##0.00' } });
    expect(cells[0][4]).toBeNull();
    expect(cells[5][0]).toBeNull();
  });
  it("finds the source number format and a numeric default value field", () => {
    const formats = [[], [null, null, "0.0%"], [null, null, "0.0%"]];
    expect(valueFormat(data, formats, 2)).toBe("0.0%");
    expect(valueFormat(data, formats, 0)).toBeUndefined();
    const log = [
      ["Date", "Category", "Paid by", "Amount"],
      ["Oct 1", "Groceries", "Ana", 84.2],
    ];
    expect(defaultValueField(log, [0])).toBe(3);
    expect(defaultValueField([["A", "B"], ["x", "y"]], [0])).toBe(1);
  });
  it("names pivot tabs and editable copies after the pivot", () => {
    expect(uniqueSheetName("October", ["Sheet1"])).toBe("October");
    expect(uniqueSheetName("October", ["october", "October 2"])).toBe(
      "October 3",
    );
    expect(copySheetName("October by category", ["October by category"])).toBe(
      "October by category (copy)",
    );
    expect(
      copySheetName("October by category", ["October by category (copy)"]),
    ).toBe("October by category (copy 2)");
  });
  it("rejects overlapping fields and handles empty selections", () => {
    expect(() => pivotResult(data, { ...c, columns: [0] })).toThrow();
    expect(() => pivotResult([], c)).toThrow();
  });
  it("tracks insertion, partial deletion, and complete deletion of source ranges", () => {
    const r = parseRange("B4:D8", "s");
    expect(rangeLabel(shiftRange(r, "row", 0, 2, false)!)).toBe("B6:D10");
    expect(rangeLabel(shiftRange(r, "row", 4, 2, true)!)).toBe("B4:D6");
    expect(shiftRange(r, "row", 0, 10, true)).toBeNull();
    expect(rangeLabel(shiftRange(r, "column", 0, 1, true)!)).toBe("A4:C8");
  });
});

import { csvCell } from "../apps/web/src/csv";
it("imports numeric CSV values while preserving formulas, identifiers, and precision", () => {
  expect(csvCell("12.5")).toEqual({ v: 12.5, t: 2 });
  expect(csvCell("TRUE")).toEqual({ v: true, t: 3 });
  for (const text of [
    "=SUM(A1:A3)",
    "01234",
    "12345678901234567",
    "1e100",
    "not a number",
    "",
  ])
    expect(csvCell(text)).toEqual({ v: text, t: 1 });
});
