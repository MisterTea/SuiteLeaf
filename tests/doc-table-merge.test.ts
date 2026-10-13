import { getSchema } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { CellSelection, mergeCells, splitCell } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import JSZip from "jszip";
import { expect, test } from "vitest";
import type { JsonNode } from "@suiteleaf/core";
import { exportDocx } from "../packages/core/src/docx-export";
import { sortDocumentTable } from "../apps/web/src/editors/doc-table-sort";

const schema = getSchema([StarterKit, TableKit]);

const cell = (type: string, text: string, colspan = 1): JsonNode => ({
  type,
  attrs: { colspan, rowspan: 1, colwidth: null },
  content: [
    text
      ? { type: "paragraph", content: [{ type: "text", text }] }
      : { type: "paragraph" },
  ],
});

const row = (cells: JsonNode[]): JsonNode => ({
  type: "tableRow",
  content: cells,
});

const sentence: JsonNode = {
  type: "paragraph",
  content: [{ type: "text", text: "Buy these Saturday." }],
};

function shoppingList(): Node {
  return Node.fromJSON(schema, {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row([cell("tableCell", "October market"), cell("tableCell", "")]),
          row([cell("tableHeader", "Item"), cell("tableHeader", "Amount")]),
          row([cell("tableCell", "Pears"), cell("tableCell", "4")]),
          row([cell("tableCell", "Apples"), cell("tableCell", "2")]),
          row([cell("tableCell", "Figs"), cell("tableCell", "10")]),
        ],
      },
      sentence,
    ],
  });
}

function cellPositions(doc: Node): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader")
      positions.push(pos);
  });
  return positions;
}

function apply(
  state: EditorState,
  command: (
    state: EditorState,
    dispatch?: (tr: EditorState["tr"]) => void,
  ) => boolean,
): EditorState {
  let next = state;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  expect(ok).toBe(true);
  return next;
}

function tableCells(doc: JsonNode) {
  const table = doc.content?.find((node) => node.type === "table");
  return (table?.content ?? []).map((line) =>
    (line.content ?? []).map((entry) => ({
      type: entry.type,
      colspan: Number(entry.attrs?.colspan) || 1,
      text: (entry.content ?? [])
        .map((block) =>
          (block.content ?? []).map((part) => part.text ?? "").join(""),
        )
        .join(""),
    })),
  );
}

test("a merged title stays spanned above the header when the body sorts", async () => {
  const doc = shoppingList();
  const [titleLeft, titleRight] = cellPositions(doc);
  let state = EditorState.create({
    schema,
    doc,
    selection: CellSelection.create(doc, titleLeft!, titleRight!),
  });

  state = apply(state, mergeCells);
  const merged = state.doc.toJSON() as JsonNode;
  expect(tableCells(merged)[0]).toEqual([
    { type: "tableCell", colspan: 2, text: "October market" },
  ]);
  expect(tableCells(merged)[1]).toEqual([
    { type: "tableHeader", colspan: 1, text: "Item" },
    { type: "tableHeader", colspan: 1, text: "Amount" },
  ]);
  expect(tableCells(merged).slice(2)).toEqual([
    [
      { type: "tableCell", colspan: 1, text: "Pears" },
      { type: "tableCell", colspan: 1, text: "4" },
    ],
    [
      { type: "tableCell", colspan: 1, text: "Apples" },
      { type: "tableCell", colspan: 1, text: "2" },
    ],
    [
      { type: "tableCell", colspan: 1, text: "Figs" },
      { type: "tableCell", colspan: 1, text: "10" },
    ],
  ]);

  state = apply(state, splitCell);
  const split = state.doc.toJSON() as JsonNode;
  expect(tableCells(split)[0]).toEqual([
    { type: "tableCell", colspan: 1, text: "October market" },
    { type: "tableCell", colspan: 1, text: "" },
  ]);
  expect(tableCells(split)[1]?.map((entry) => entry.text)).toEqual([
    "Item",
    "Amount",
  ]);
  expect(tableCells(split)[1]?.every((entry) => entry.colspan === 1)).toBe(
    true,
  );

  const titleCells = cellPositions(state.doc);
  state = EditorState.create({
    schema,
    doc: state.doc,
    selection: CellSelection.create(state.doc, titleCells[0]!, titleCells[1]!),
  });
  state = apply(state, mergeCells);

  const byName = sortDocumentTable(state.doc.toJSON() as JsonNode, 0, true);
  expect(tableCells(byName)[0]).toEqual([
    { type: "tableCell", colspan: 2, text: "October market" },
  ]);
  expect(tableCells(byName)[1]).toEqual([
    { type: "tableHeader", colspan: 1, text: "Item" },
    { type: "tableHeader", colspan: 1, text: "Amount" },
  ]);
  expect(
    tableCells(byName)
      .slice(2)
      .map((line) => line.map((entry) => entry.text)),
  ).toEqual([
    ["Apples", "2"],
    ["Figs", "10"],
    ["Pears", "4"],
  ]);
  expect(byName.content?.[1]).toEqual(sentence);

  const byAmount = sortDocumentTable(byName, 1, true);
  expect(tableCells(byAmount)[0]).toEqual([
    { type: "tableCell", colspan: 2, text: "October market" },
  ]);
  expect(
    tableCells(byAmount)
      .slice(2)
      .map((line) => line.map((entry) => entry.text)),
  ).toEqual([
    ["Apples", "2"],
    ["Pears", "4"],
    ["Figs", "10"],
  ]);

  const zip = await JSZip.loadAsync(
    await exportDocx({ title: "October market", content: byAmount }),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  const table = xml.slice(xml.indexOf("<w:tbl>"), xml.indexOf("</w:tbl>"));
  const rows = table.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];
  const texts = (rowXml: string) =>
    [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]);
  const cells = (rowXml: string) => rowXml.match(/<w:tc[ >]/g) ?? [];
  expect(rows).toHaveLength(5);
  expect(cells(rows[0])).toHaveLength(1);
  expect(rows[0]).toContain('<w:gridSpan w:val="2"/>');
  expect(texts(rows[0])).toEqual(["October market"]);
  expect(rows[0]).not.toContain("<w:tblHeader");
  expect(rows[1]).toContain("<w:tblHeader");
  expect(cells(rows[1])).toHaveLength(2);
  expect(rows[1]).not.toContain('w:val="2"');
  expect(texts(rows[1])).toEqual(["Item", "Amount"]);
  expect(rows.slice(2).map(texts)).toEqual([
    ["Apples", "2"],
    ["Pears", "4"],
    ["Figs", "10"],
  ]);
  expect(
    rows
      .slice(2)
      .map(cells)
      .every((rowCells) => rowCells.length === 2),
  ).toBe(true);
  expect(rows.slice(2).some((rowXml) => rowXml.includes('w:val="2"'))).toBe(
    false,
  );
});
