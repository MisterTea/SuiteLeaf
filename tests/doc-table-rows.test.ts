import { getSchema } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Node } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { expect, test } from "vitest";
import JSZip from "jszip";
import type { JsonNode } from "@suiteleaf/core";
import { exportDocx } from "../packages/core/src/docx-export";
import { sortDocumentTable } from "../apps/web/src/editors/doc-table-sort";
import {
  equalizeDocumentTableRows,
  tableRowWithHeight,
} from "../apps/web/src/editors/doc-table-rows";

const schema = getSchema([
  StarterKit,
  TableKit.configure({ tableRow: false }),
  tableRowWithHeight,
]);

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

function row(height: number, cells: JsonNode[]): JsonNode {
  return { type: "tableRow", attrs: { height }, content: cells };
}

function shoppingList(): JsonNode {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row(20, [cell("tableCell", "October market", 2, [300, 100])]),
          row(20, [
            cell("tableHeader", "Item", 1, [300]),
            cell("tableHeader", "Amount", 1, [100]),
          ]),
          row(48, [
            cell(
              "tableCell",
              "Pears. Keep the ripe ones for Saturday pie.",
              1,
              [300],
            ),
            cell("tableCell", "4", 1, [100]),
          ]),
        ],
      },
      sentence,
    ],
  };
}

function rowsOf(doc: JsonNode) {
  const table = doc.content?.find((node) => node.type === "table");
  return table?.content ?? [];
}

function described(doc: JsonNode) {
  return rowsOf(doc).map((line) => ({
    height: line.attrs?.height ?? null,
    cells: (line.content ?? []).map((entry) => ({
      type: entry.type,
      colspan: Number(entry.attrs?.colspan) || 1,
      colwidth: entry.attrs?.colwidth,
      text: (entry.content ?? [])
        .map((block) =>
          (block.content ?? []).map((part) => part.text ?? "").join(""),
        )
        .join(""),
    })),
  }));
}

test("equal rows grow to the tallest row and leave that row unchanged", async () => {
  const doc = shoppingList();
  const snapshot = JSON.stringify(doc);
  const tall = rowsOf(doc)[2];
  const next = equalizeDocumentTableRows(doc);

  expect(JSON.stringify(doc)).toBe(snapshot);
  expect(next.content?.[1]).toBe(sentence);
  expect(rowsOf(next)[2]).toBe(tall);
  expect(described(next).map((line) => line.height)).toEqual([48, 48, 48]);
  expect(described(next)).toEqual([
    {
      height: 48,
      cells: [
        {
          type: "tableCell",
          colspan: 2,
          colwidth: [300, 100],
          text: "October market",
        },
      ],
    },
    {
      height: 48,
      cells: [
        { type: "tableHeader", colspan: 1, colwidth: [300], text: "Item" },
        { type: "tableHeader", colspan: 1, colwidth: [100], text: "Amount" },
      ],
    },
    {
      height: 48,
      cells: [
        {
          type: "tableCell",
          colspan: 1,
          colwidth: [300],
          text: "Pears. Keep the ripe ones for Saturday pie.",
        },
        { type: "tableCell", colspan: 1, colwidth: [100], text: "4" },
      ],
    },
  ]);
  expect(rowsOf(next)[0]?.content).toBe(rowsOf(doc)[0]?.content);
  expect(rowsOf(next)[1]?.content).toBe(rowsOf(doc)[1]?.content);

  const legacy = Node.fromJSON(schema, {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [cell("tableCell", "Older", 1, [100])],
          },
        ],
      },
    ],
  });
  expect(legacy.firstChild?.firstChild?.attrs.height).toBeNull();
  expect(described(Node.fromJSON(schema, next).toJSON() as JsonNode)).toEqual(
    described(next),
  );

  const sorted = sortDocumentTable(next, 0, true);
  expect(sorted.content?.[1]).toBe(sentence);
  expect(described(sorted).map((line) => line.height)).toEqual([48, 48, 48]);
  expect(described(sorted)[0]?.cells[0]?.colspan).toBe(2);
  expect(described(sorted)[2]?.cells.map((entry) => entry.text)).toEqual([
    "Pears. Keep the ripe ones for Saturday pie.",
    "4",
  ]);

  const zip = await JSZip.loadAsync(
    await exportDocx({ title: "October market", content: next }),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  const table = xml.slice(xml.indexOf("<w:tbl>"), xml.indexOf("</w:tbl>"));
  const grid = [...table.matchAll(/<w:gridCol\b[^>]*\bw:w="(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  const wordRows = table.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];
  const texts = (rowXml: string) =>
    [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]);
  const trHeight = (rowXml: string) => {
    const tag = rowXml.match(/<w:trHeight\b[^>]*\/>/);
    const val = tag?.[0].match(/\bw:val="(\d+)"/);
    const rule = tag?.[0].match(/\bw:hRule="([^"]+)"/);
    return { val: Number(val?.[1]), rule: rule?.[1] ?? null };
  };
  expect(grid).toEqual([4500, 1500]);
  expect(wordRows).toHaveLength(3);
  expect(wordRows[0]).toContain('<w:gridSpan w:val="2"/>');
  expect(texts(wordRows[0]!)).toEqual(["October market"]);
  expect(texts(wordRows[2]!)).toEqual([
    "Pears. Keep the ripe ones for Saturday pie.",
    "4",
  ]);
  expect(wordRows.map(trHeight)).toEqual([
    { val: 720, rule: "atLeast" },
    { val: 720, rule: "atLeast" },
    { val: 720, rule: "atLeast" },
  ]);

  const wrapped = shoppingList();
  for (const line of rowsOf(wrapped)) delete line.attrs;
  const fromRender = equalizeDocumentTableRows(wrapped, [20, 20, 48]);
  expect(fromRender.content?.[1]).toBe(wrapped.content?.[1]);
  expect(described(fromRender).map((line) => line.height)).toEqual([
    48, 48, 48,
  ]);
  expect(described(fromRender)[2]?.cells[0]?.text).toBe(
    "Pears. Keep the ripe ones for Saturday pie.",
  );
  expect(described(fromRender)[0]?.cells[0]?.colwidth).toEqual([300, 100]);
});
