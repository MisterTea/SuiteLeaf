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

import {
  csvCell,
  defaultDelimitedOptions,
  delimitedCellData,
  guessHeader,
  identifierColumns,
  parseDelimited,
} from "../apps/web/src/csv";
describe("delimited imports", () => {
  const members =
    "Member ID,Name,ZIP,Plot,Dues paid\n00412,Rosa Delgado,02139,A3,45\n01205,Mei Chen,10001,B4,0\n";
  it("detects or overrides the separator", () => {
    expect(parseDelimited(members).delimiter).toBe(",");
    expect(parseDelimited("a;b\n1;2").delimiter).toBe(";");
    expect(parseDelimited("a\tb\n1\t2").rows).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a;b\n1;2", ",").rows).toEqual([["a;b"], ["1;2"]]);
    expect(parseDelimited('a,"b\n1,2').error).toBeTruthy();
  });
  it("keeps every value of a code column as text, and the header out of the data", () => {
    const { rows } = parseDelimited(members);
    const options = defaultDelimitedOptions(rows, ",");
    expect(options).toEqual({
      delimiter: ",",
      header: true,
      convert: true,
      keepIdentifiers: true,
    });
    expect([...identifierColumns(rows, true)]).toEqual([0, 2]);
    const cells = delimitedCellData(rows, options);
    expect(cells[0][4]).toEqual({ v: "Dues paid", t: 1 });
    expect(cells[1][0]).toEqual({ v: "00412", t: 1 });
    expect(cells[2][2]).toEqual({ v: "10001", t: 1 });
    expect(cells[2][4]).toEqual({ v: 0, t: 2 });
    const perCell = delimitedCellData(rows, { ...options, keepIdentifiers: false });
    expect(perCell[1][2]).toEqual({ v: "02139", t: 1 });
    expect(perCell[2][2]).toEqual({ v: 10001, t: 2 });
    const text = delimitedCellData(rows, { ...options, convert: false });
    expect(text[1][4]).toEqual({ v: "45", t: 1 });
  });
  it("only treats a row of distinct labels as a header", () => {
    expect(guessHeader([["Item", "Amount"], ["a", "1"]])).toBe(true);
    expect(guessHeader([["2024", "Amount"], ["a", "1"]])).toBe(false);
    expect(guessHeader([["Item", "Item"], ["a", "1"]])).toBe(false);
    expect(guessHeader([["Item", "Amount"]])).toBe(false);
    const cells = delimitedCellData([["1", "=SUM(A1)"], ["12345678901234567", "2"]], {
      delimiter: ",",
      header: false,
      convert: true,
      keepIdentifiers: true,
    });
    expect(cells[0][0]).toEqual({ v: "1", t: 1 });
    expect(cells[0][1]).toEqual({ v: "=SUM(A1)", t: 1 });
    expect(cells[1][1]).toEqual({ v: 2, t: 2 });
  });
});
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
