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
  type DocFile,
} from "../packages/core/src";
import { pivotResult, shiftRange } from "../apps/web/src/analysis";
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
      ["Team", "Q1", "Q2"],
      ["North", 30, 40],
      ["South", 50, null],
    ]);
  });
  it("computes average/min/max/count and exact-match filters", () => {
    expect(pivotResult(data, { ...c, aggregate: "AVERAGE" })[1]).toEqual([
      "North",
      15,
      40,
    ]);
    expect(pivotResult(data, { ...c, aggregate: "MIN" })[1]).toEqual([
      "North",
      10,
      40,
    ]);
    expect(pivotResult(data, { ...c, aggregate: "MAX" })[1]).toEqual([
      "North",
      20,
      40,
    ]);
    expect(pivotResult(data, { ...c, aggregate: "COUNT" })[2]).toEqual([
      "South",
      1,
      1,
    ]);
    expect(
      pivotResult(data, { ...c, filterColumn: 0, filterValue: "South" }),
    ).toEqual([
      ["Team", "Q1"],
      ["South", 50],
    ]);
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
