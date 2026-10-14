import { describe, expect, it } from "vitest";
import type { JsonNode } from "../packages/core/src";
import {
  mergeLetters,
  mergeSheetChoices,
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
