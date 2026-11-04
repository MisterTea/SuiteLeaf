import {
  BorderStyle,
  HeadingLevel,
  Paragraph,
  TabStopType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { JsonNode } from "./index";
import { wordStyleId } from "./doc-styles";
import { docxParagraphIndent } from "./paragraph-indent";
import type { DocxCommentPlan } from "./doc-comments";
import { docxLineSpacing } from "./line-spacing";
import { docxParagraphGap } from "./paragraph-spacing";
import type { CitationLibrary } from "./citations";
import {
  chartCaption,
  chartForViewer,
  chartProvenance,
  missingSpreadsheetText,
  withheldChartText,
} from "./linked-chart";
import { alignment, runs, type NoteSlot } from "./docx-runs";
import { textBoxPlain } from "./docx-text-boxes";

export function columnSegments(
  nodes: JsonNode[],
): { columns: 1 | 2; nodes: JsonNode[] }[] {
  const out: { columns: 1 | 2; nodes: JsonNode[] }[] = [];
  const push = (columns: 1 | 2, node: JsonNode) => {
    const last = out[out.length - 1];
    if (last && last.columns === columns) last.nodes.push(node);
    else out.push({ columns, nodes: [node] });
  };
  const walk = (items: JsonNode[], columns: 1 | 2) => {
    for (const node of items) {
      if (node.type === "columnLayout")
        walk(node.content ?? [], node.attrs?.columns === 1 ? 1 : 2);
      else push(columns, node);
    }
  };
  walk(nodes, 1);
  return out;
}
/** Source name, then one row per bar. A missing sheet keeps the last numbers. */
function linkedChartBlocks(node: JsonNode): (Paragraph | Table)[] {
  const chart = chartForViewer(node.attrs, node.attrs?.viewerAllowed !== false);
  const written: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun(chartCaption(chart.sourceTitle))],
    }),
    new Paragraph({
      children: [new TextRun(chartProvenance(chart.sourceTitle, chart.snapshotAt))],
    }),
  ];
  if (chart.labels.length)
    written.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: chart.labels.map(
          (label, index) =>
            new TableRow({
              children: [label, String(chart.values[index])].map(
                (text) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun(text)] }),
                    ],
                  }),
              ),
            }),
        ),
      }),
    );
  if (chart.withheld)
    written.push(new Paragraph({ children: [new TextRun(withheldChartText)] }));
  if (chart.missing)
    written.push(
      new Paragraph({ children: [new TextRun(missingSpreadsheetText)] }),
    );
  return written;
}
export function blocks(
  nodes: JsonNode[],
  plan: DocxCommentPlan,
  notes: Map<string, NoteSlot>,
  library: CitationLibrary,
  list?: { ordered: boolean; level: number },
): (Paragraph | Table | TableOfContents)[] {
  return nodes.flatMap((n): (Paragraph | Table | TableOfContents)[] => {
    if (n.type === "note" || n.type === "sectionBreak" || n.type === "docShape") return [];
    if (n.type === "linkedChart") return linkedChartBlocks(n);
    if (n.type === "columnLayout")
      return blocks(n.content ?? [], plan, notes, library, list);
    if (n.type === "bibliography")
      return [new Paragraph({ children: [new TextRun("SLBIBFIELD")] })];
    if (n.type === "figureList" || n.type === "index")
      return blocks(n.content ?? [], plan, notes, library, list);
    if (n.type === "tableOfContents") {
      const max = Number(n.attrs?.maxLevel) === 1 ? "1-1" : "1-3";
      const pageNumbers = n.attrs?.pageNumbers !== false;
      return [
        ...blocks(n.content ?? [], plan, notes, library, list),
        new TableOfContents("Contents", {
          hyperlink: true,
          headingStyleRange: max,
          ...(pageNumbers ? {} : { pageNumbersEntryLevelsRange: max }),
        }),
      ];
    }
    if (n.type === "bulletList" || n.type === "orderedList")
      return blocks(n.content ?? [], plan, notes, library, {
        ordered: n.type === "orderedList",
        level: list ? Math.min(8, list.level + 1) : 0,
      });
    if (n.type === "listItem" || n.type === "blockquote")
      return blocks(n.content ?? [], plan, notes, library, list);
    if (n.type === "table")
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: (n.content ?? []).map(
            (row) =>
              new TableRow({
                tableHeader:
                  (!!row.content?.length &&
                    row.content.every((cell) => cell.type === "tableHeader")) ||
                  undefined,
                children: (row.content ?? []).map(
                  (cell) =>
                    new TableCell({
                      columnSpan: Number(cell.attrs?.colspan) || 1,
                      rowSpan: Number(cell.attrs?.rowspan) || 1,
                      verticalAlign: VerticalAlign.TOP,
                      children: blocks(cell.content ?? [], plan, notes, library).filter(
                        (block): block is Paragraph | Table =>
                          block instanceof Paragraph || block instanceof Table,
                      ),
                    }),
                ),
              }),
          ),
        }),
      ];
    if (n.type === "textBox") {
      const text = textBoxPlain(n);
      const hex = [...new TextEncoder().encode(text)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return [new Paragraph({ children: [new TextRun(`SLTBXEXPORT${hex}END`)] })];
    }
    if (n.type === "pageBreak")
      return [new Paragraph({ pageBreakBefore: true })];
    if (n.type === "horizontalRule")
      return [
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "808080" },
          },
        }),
      ];
    const children =
      n.type === "image"
        ? runs({ type: "paragraph", content: [n] }, plan, notes, library)
        : runs(n, plan, notes, library);
    const spacing =
      n.type === "paragraph" || n.type === "heading"
        ? { ...docxLineSpacing(n.attrs?.lineSpacing), ...docxParagraphGap(n.attrs) }
        : undefined;
    const indent =
      n.type === "paragraph" || n.type === "heading"
        ? docxParagraphIndent(n.attrs)
        : undefined;
    const stop = Number(n.attrs?.tabStop);
    const tabStops =
      Number.isFinite(stop) && stop > 0 && stop <= 22
        ? [{ type: TabStopType.LEFT, position: Math.round(stop * 1440) }]
        : undefined;
    const namedStyle = n.type === "paragraph" ? wordStyleId(n.attrs?.styleId) : undefined;
    return [
      new Paragraph({
        children,
        tabStops,
        ...(namedStyle ? { style: namedStyle } : {}),
        alignment: alignment(n.attrs?.textAlign),
        ...(spacing ? { spacing } : {}),
        ...(indent ? { indent } : {}),
        heading:
          n.type === "heading"
            ? ([
                HeadingLevel.HEADING_1,
                HeadingLevel.HEADING_2,
                HeadingLevel.HEADING_3,
                HeadingLevel.HEADING_4,
                HeadingLevel.HEADING_5,
                HeadingLevel.HEADING_6,
              ][Number(n.attrs?.level) - 1] ?? HeadingLevel.HEADING_1)
            : undefined,
        ...(n.attrs?.keepNext === true ? { keepNext: true } : {}),
        ...(n.attrs?.keepLines === true ? { keepLines: true } : {}),
        ...(n.attrs?.widowControl === true ? { widowControl: true } : {}),
        ...(list
          ? list.ordered
            ? { numbering: { reference: "suiteleaf-list", level: list.level } }
            : { bullet: { level: list.level } }
          : {}),
      }),
    ];
  });
}
