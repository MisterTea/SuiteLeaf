import { describe, expect, it } from "vitest";
import type { JsonNode } from "../packages/core/src";
import {
  letterTitle,
  mergeBatch,
  mergeIssueText,
  mergeLetters,
  mergeSheetChoices,
  nameColumn,
  previewMerge,
  sheetTable,
  spreadsheetChoices,
} from "../apps/web/src/editors/mail-merge";

function doc(text: string): JsonNode {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

const letter = "Hello {{Name}}, your plot is {{Plot}}.";

describe("merge letters", () => {
  it("matches a placeholder to a header with surrounding space", () => {
    const headers = [" Name ", "Plot"];
    const before = headers.slice();
    const result = mergeLetters(doc("Hello {{Name}}."), headers, [["Rosa", "Sunny"]]);
    expect(headers).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.content?.[0]?.content?.[0]?.text).toBe("Hello Rosa.");
    expect(previewMerge(doc("Hello {{Name}}."), headers, [["Rosa", "Sunny"]])).toEqual([]);
    const blank = mergeLetters(doc("Hello {{Name}}."), [" "], [["Rosa"]]);
    expect(blank.ok).toBe(false);
  });

  it("matches a placeholder when the header uses different capitalization", () => {
    const headers = ["name"];
    const result = mergeLetters(doc("Hello {{Name}}."), headers, [["Rosa"]]);
    expect(headers).toEqual(["name"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.content?.[0]?.content?.[0]?.text).toBe("Hello Rosa.");
    expect(previewMerge(doc("Hello {{Name}}."), headers, [["Rosa"]])).toEqual([]);
  });

  it("writes one letter per row with a page break between them", () => {
    const template = doc(letter);
    const result = mergeLetters(
      template,
      ["Name", "Plot"],
      [
        ["Rosa", "Sunny"],
        ["Leo", "Shade"],
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.content).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello Rosa, your plot is Sunny." }],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello Leo, your plot is Shade." }],
      },
    ]);
  });

  it("names a placeholder that is not a column and does not produce a document", () => {
    const template = doc("Hello {{Bed}}.");
    const result = mergeLetters(
      template,
      ["Name", "Plot"],
      [["Rosa", "Sunny"]],
    );
    expect(result).toEqual({ ok: false, missing: ["Bed"] });
  });

  it("skips an empty row", () => {
    const result = mergeLetters(
      doc(letter),
      ["Name", "Plot"],
      [
        ["Rosa", "Sunny"],
        ["", " "],
        ["Leo", "Shade"],
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = JSON.stringify(result.content);
    expect(text).toContain("Hello Rosa, your plot is Sunny.");
    expect(text).toContain("Hello Leo, your plot is Shade.");
    expect(
      result.content.content?.filter((node) => node.type === "pageBreak"),
    ).toHaveLength(1);
    expect(text).not.toContain("Hello ,");
  });

  it("does not mutate the template document", () => {
    const template = doc(letter);
    const snapshot = structuredClone(template);
    const filled = mergeLetters(
      template,
      ["Name", "Plot"],
      [["Rosa", "Sunny"]],
    );
    const refused = mergeLetters(template, ["Name"], [["Rosa"]]);
    expect(filled.ok).toBe(true);
    expect(refused).toEqual({ ok: false, missing: ["Plot"] });
    expect(template).toEqual(snapshot);
  });

  it("matches the header text and ignores every sheet after the first", () => {
    const table = sheetTable({
      sheetOrder: ["first", "second"],
      sheets: {
        first: {
          cellData: {
            "0": { "0": { v: "" } },
            "1": { "0": { v: "Name" }, "1": { display: "Plot", v: "ignored" } },
            "2": { "0": { v: "Rosa" }, "1": { v: "Sunny" } },
            "4": {
              "0": { v: "Leo" },
              "1": { p: { body: { dataStream: "Shade\r\n" } } },
            },
          },
        },
        second: {
          cellData: {
            "0": { "0": { v: "Bed" } },
            "1": { "0": { v: "North" } },
          },
        },
      },
    });
    expect(table.headers).toEqual(["Name", "Plot"]);
    expect(table.rows).toEqual([
      ["Rosa", "Sunny"],
      ["", ""],
      ["Leo", "Shade"],
    ]);
    const result = mergeLetters(doc(letter), table.headers, table.rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.content)).not.toContain("North");
    expect(JSON.stringify(result.content)).not.toContain("{{");
  });

  it("lists library spreadsheets by title and leaves SuiteDrive copies out", () => {
    expect(
      spreadsheetChoices([
        { file: { id: "b", kind: "sheet", title: "Zucchini" } },
        { file: { id: "a", kind: "doc", title: "Plot letter" } },
        {
          drive: { itemId: "remote" },
          file: { id: "c", kind: "sheet", title: "Garden members" },
        },
        {
          trashedAt: "2026-01-01T00:00:00.000Z",
          file: { id: "d", kind: "sheet", title: "Old plots" },
        },
        { file: { id: "e", kind: "sheet", title: "Garden members" } },
      ]),
    ).toEqual([
      { id: "e", title: "Garden members" },
      { id: "b", title: "Zucchini" },
    ]);
  });

  it("offers a server spreadsheet that is not in the library, and names its folder", () => {
    const local = spreadsheetChoices([
      { file: { id: "local", kind: "sheet", title: "Plot notes" } },
      {
        drive: { itemId: "remote" },
        file: { id: "cached", kind: "sheet", title: "Garden members" },
      },
    ]);
    expect(local).toEqual([{ id: "local", title: "Plot notes" }]);
    expect(
      mergeSheetChoices(local, [
        {
          id: "remote",
          name: "Garden members.slsheet",
          parentName: "Garden club",
        },
        {
          id: "other",
          name: "Garden members.slsheet",
          parentName: "Thursday plans",
        },
      ]),
    ).toEqual([
      {
        key: "drive:remote",
        source: "drive",
        id: "remote",
        title: "Garden members",
        place: "Garden club",
      },
      {
        key: "drive:other",
        source: "drive",
        id: "other",
        title: "Garden members",
        place: "Thursday plans",
      },
      {
        key: "library:local",
        source: "library",
        id: "local",
        title: "Plot notes",
        place: "On this computer",
      },
    ]);
  });
});

describe("merge batch", () => {
  it("lists a blank field before writing and keeps the template", () => {
    const template = doc(letter);
    const snapshot = structuredClone(template);
    const issues = previewMerge(
      template,
      ["Name", "Plot"],
      [
        ["Rosa", ""],
        ["Leo", "Shade"],
      ],
    );
    expect(issues).toEqual([{ row: 1, field: "Plot", reason: "blank", column: 1 }]);
    const batch = mergeBatch(template, ["Name", "Plot"], [["Rosa", ""]], "Name");
    expect(batch.ok).toBe(false);
    expect(JSON.stringify(template)).toBe(JSON.stringify(snapshot));
  });

  it("writes distinct letters and repeats the same names for the same rows", () => {
    const rows = [
      ["Rosa", "Sunny"],
      ["Rosa", "Shade"],
    ];
    const first = mergeBatch(doc(letter), ["Name", "Plot"], rows, "Name");
    const second = mergeBatch(doc(letter), ["Name", "Plot"], rows, "Name");
    expect(first.ok && first.letters.map((letter) => letter.name)).toEqual(["Rosa", "Rosa 2"]);
    const mixed = mergeBatch(doc("Hello {{Name}}."), ["Name"], [["Ada"], ["ada"]], "Name");
    expect(mixed.ok && mixed.letters.map((letter) => letter.name)).toEqual(["Ada", "ada 2"]);
    expect(second.ok && second.letters.map((letter) => letter.name)).toEqual(
      first.ok ? first.letters.map((letter) => letter.name) : [],
    );
    if (!first.ok) return;
    expect(JSON.stringify(first.letters[0].content)).toContain("Sunny");
    expect(JSON.stringify(first.letters[1].content)).toContain("Shade");
  });

  it("names files from the Name column and describes a blank cell", () => {
    expect(nameColumn(["Plot", "Name"])).toBe("Name");
    expect(nameColumn(["Plot"])).toBe("Plot");
    expect(
      mergeIssueText([{ row: 1, field: "Plot", reason: "blank", column: 1 }]),
    ).toBe("Row 1 has no Plot. Cell B2.");
    expect(mergeIssueText([{ row: 0, field: "secret-value", reason: "missing-column" }])).toBe(
      "That name is not a column.",
    );
    expect(mergeIssueText([{ row: 2, field: "apiKey", reason: "blank", column: 0 }])).toBe(
      "Row 2 has an empty cell. Cell A3.",
    );
    expect(letterTitle("Garden notes", "Rosa")).toBe("Garden notes — Rosa");
    expect(letterTitle("Garden notes", "../../secret-value")).toBe("Garden notes — secret-value");
    expect(letterTitle("Garden notes", "../")).toBe("Garden notes — Letter");
    expect(letterTitle("Garden notes", "Beds/North")).toBe("Garden notes — Beds North");
  });
});
