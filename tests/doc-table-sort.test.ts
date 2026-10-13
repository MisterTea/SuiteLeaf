import { expect, test } from "vitest";
import JSZip from "jszip";
import type { JsonNode } from "@suiteleaf/core";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  nextSortAscending,
  sortColumnLabel,
  sortDocumentTable,
} from "../apps/web/src/editors/doc-table-sort";

const cell = (type: string, text: string): JsonNode => ({
  type,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const row = (type: string, values: string[]): JsonNode => ({
  type: "tableRow",
  content: values.map((text) => cell(type, text)),
});
const sentence: JsonNode = {
  type: "paragraph",
  content: [{ type: "text", text: "Buy these Saturday." }],
};

function shoppingList(): JsonNode {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row("tableHeader", ["Item", "Amount"]),
          row("tableCell", ["Pears", "4"]),
          row("tableCell", ["Apples", "2"]),
          row("tableCell", ["Figs", "10"]),
        ],
      },
      sentence,
    ],
  };
}

function tableRows(doc: JsonNode) {
  const table = doc.content?.find((node) => node.type === "table");
  return (table?.content ?? []).map((line) => ({
    types: (line.content ?? []).map((entry) => entry.type),
    text: (line.content ?? []).map((entry) =>
      (entry.content ?? [])
        .map((block) => block.content?.[0]?.text ?? "")
        .join(""),
    ),
  }));
}

test("sorting a document table keeps the header and moves whole body rows", async () => {
  const doc = shoppingList();
  const snapshot = JSON.stringify(doc);

  expect(sortColumnLabel("Item", false, true)).toBe("Sort Item A to Z");
  expect(sortColumnLabel("Amount", true, true)).toBe(
    "Sort Amount small to large",
  );
  expect(nextSortAscending({ column: 1, ascending: true }, 1)).toBe(false);
  expect(sortColumnLabel("Amount", true, false)).toBe(
    "Sort Amount large to small",
  );

  const byName = sortDocumentTable(doc, 0, true);
  expect(JSON.stringify(doc)).toBe(snapshot);
  expect(tableRows(byName)[0]).toEqual({
    types: ["tableHeader", "tableHeader"],
    text: ["Item", "Amount"],
  });
  expect(tableRows(byName).slice(1)).toEqual([
    { types: ["tableCell", "tableCell"], text: ["Apples", "2"] },
    { types: ["tableCell", "tableCell"], text: ["Figs", "10"] },
    { types: ["tableCell", "tableCell"], text: ["Pears", "4"] },
  ]);
  expect(byName.content).toHaveLength(2);
  expect(byName.content?.[1]).toBe(sentence);
  expect(byName.content?.[0]?.content).toHaveLength(4);

  const byAmount = sortDocumentTable(byName, 1, true);
  expect(
    tableRows(byAmount)
      .slice(1)
      .map((line) => line.text),
  ).toEqual([
    ["Apples", "2"],
    ["Pears", "4"],
    ["Figs", "10"],
  ]);

  const reversed = sortDocumentTable(
    byAmount,
    1,
    nextSortAscending({ column: 1, ascending: true }, 1),
  );
  expect(tableRows(reversed)[0].text).toEqual(["Item", "Amount"]);
  expect(
    tableRows(reversed)
      .slice(1)
      .map((line) => line.text),
  ).toEqual([
    ["Figs", "10"],
    ["Pears", "4"],
    ["Apples", "2"],
  ]);
  expect(reversed.content?.[1]).toBe(sentence);

  const zip = await JSZip.loadAsync(
    await exportDocx({ title: "Shopping list", content: reversed }),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  const table = xml.slice(xml.indexOf("<w:tbl>"), xml.indexOf("</w:tbl>"));
  const rows = table.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];
  const texts = (rowXml: string) =>
    [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]);
  expect(rows).toHaveLength(4);
  expect(rows[0]).toContain("<w:tblHeader");
  expect(texts(rows[0])).toEqual(["Item", "Amount"]);
  expect(rows.slice(1).some((rowXml) => rowXml.includes("<w:tblHeader"))).toBe(
    false,
  );
  expect(rows.slice(1).map(texts)).toEqual([
    ["Figs", "10"],
    ["Pears", "4"],
    ["Apples", "2"],
  ]);
  expect(xml.indexOf("</w:tbl>")).toBeLessThan(
    xml.indexOf("Buy these Saturday"),
  );
});
