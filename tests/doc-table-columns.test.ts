import { getSchema } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Node } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { expect, test } from "vitest";
import JSZip from "jszip";
import type { JsonNode } from "@suiteleaf/core";
import { exportDocx } from "../packages/core/src/docx-export";
import { sortDocumentTable } from "../apps/web/src/editors/doc-table-sort";
import { equalizeDocumentTable } from "../apps/web/src/editors/doc-table-columns";

const schema = getSchema([StarterKit, TableKit]);

const cell = (
  type: string,
  text: string,
  colspan: number,
  colwidth: number[],
): JsonNode => ({
  type,
  attrs: { colspan, rowspan: 1, colwidth },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
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
          {
            type: "tableRow",
            content: [cell("tableCell", "October market", 2, [300, 100])],
          },
          {
            type: "tableRow",
            content: [
              cell("tableHeader", "Item", 1, [300]),
              cell("tableHeader", "Amount", 1, [100]),
            ],
          },
          {
            type: "tableRow",
            content: [
              cell("tableCell", "Pears", 1, [300]),
              cell("tableCell", "4", 1, [100]),
            ],
          },
          {
            type: "tableRow",
            content: [
              cell("tableCell", "Apples", 1, [300]),
              cell("tableCell", "2", 1, [100]),
            ],
          },
        ],
      },
      sentence,
    ],
  };
}

function cells(doc: JsonNode) {
  const table = doc.content?.find((node) => node.type === "table");
  return (table?.content ?? []).map((row) =>
    (row.content ?? []).map((entry) => ({
      type: entry.type,
      colspan: Number(entry.attrs?.colspan) || 1,
      colwidth: entry.attrs?.colwidth,
      text: (entry.content ?? [])
        .map((block) =>
          (block.content ?? []).map((part) => part.text ?? "").join(""),
        )
        .join(""),
    })),
  );
}

test("equal columns share the current table width and keep a spanned title", async () => {
  const doc = shoppingList();
  const snapshot = JSON.stringify(doc);
  const next = equalizeDocumentTable(doc);

  expect(JSON.stringify(doc)).toBe(snapshot);
  expect(next.content?.[1]).toBe(sentence);
  expect(cells(next)).toEqual([
    [
      {
        type: "tableCell",
        colspan: 2,
        colwidth: [200, 200],
        text: "October market",
      },
    ],
    [
      { type: "tableHeader", colspan: 1, colwidth: [200], text: "Item" },
      { type: "tableHeader", colspan: 1, colwidth: [200], text: "Amount" },
    ],
    [
      { type: "tableCell", colspan: 1, colwidth: [200], text: "Pears" },
      { type: "tableCell", colspan: 1, colwidth: [200], text: "4" },
    ],
    [
      { type: "tableCell", colspan: 1, colwidth: [200], text: "Apples" },
      { type: "tableCell", colspan: 1, colwidth: [200], text: "2" },
    ],
  ]);
  const title = cells(next)[0]?.[0]?.colwidth as number[];
  expect(title[0]! + title[1]!).toBe(400);
  expect(cells(Node.fromJSON(schema, next).toJSON() as JsonNode)).toEqual(
    cells(next),
  );

  const sorted = sortDocumentTable(next, 0, true);
  expect(sorted.content?.[1]).toBe(sentence);
  expect(cells(sorted)[0]).toEqual([
    {
      type: "tableCell",
      colspan: 2,
      colwidth: [200, 200],
      text: "October market",
    },
  ]);
  expect(cells(sorted)[1]?.map((entry) => entry.text)).toEqual([
    "Item",
    "Amount",
  ]);
  expect(
    cells(sorted)
      .slice(2)
      .map((row) => row.map((entry) => entry.text)),
  ).toEqual([
    ["Apples", "2"],
    ["Pears", "4"],
  ]);
  expect(
    cells(sorted)
      .slice(1)
      .every((row) => row.every((entry) => entry.colwidth?.[0] === 200)),
  ).toBe(true);

  const zip = await JSZip.loadAsync(
    await exportDocx({ title: "October market", content: sorted }),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  const table = xml.slice(xml.indexOf("<w:tbl>"), xml.indexOf("</w:tbl>"));
  const grid = [...table.matchAll(/<w:gridCol\b[^>]*\bw:w="(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  const rows = table.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];
  const texts = (rowXml: string) =>
    [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]);
  expect(grid).toEqual([3000, 3000]);
  expect(rows[0]).toContain('<w:gridSpan w:val="2"/>');
  expect(texts(rows[0]!)).toEqual(["October market"]);
  expect(texts(rows[1]!)).toEqual(["Item", "Amount"]);
  expect(rows[1]).not.toContain('w:val="2"');
});
