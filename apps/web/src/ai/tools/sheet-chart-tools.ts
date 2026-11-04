import { Type } from "@earendil-works/pi-ai";
import type { ChartDefinition, PivotDefinition } from "@suiteleaf/core";
import { applyNamedFormat } from "../../formats";
import { moveCursor } from "../cursor";
import { tool, ToolError, type SuiteTool } from "../host";
import type { SheetsAgentContext } from "./sheet-context";
import {
  a1,
  columnLetter,
  display,
  grid,
  NUMBER_FORMATS,
  parseA1,
  parseCell,
  rangeScreenRect,
  resolveColumn,
  revealRange,
  usedRange,
  wait,
} from "./sheet-cells";
import type { SheetToolKit } from "./sheet-tool-kit";

/**
 * A chart range must start with its header row, as the Insert chart panel expects. A range that starts
 * just below the headers is extended up to them; returns the range to use and a note saying so.
 */
function checkHeaderRow(sheet: any, input: string): { range: string; note: string } {
  const r = parseA1(input);
  const width = r.endColumn - r.startColumn + 1;
  const first = sheet.getRange(r.startRow, r.startColumn, 1, width).getValues()[0] as unknown[];
  const numeric = first.slice(1).some((v) => typeof v === "number");
  if (!numeric) return { range: a1(r), note: "" };
  const above =
    r.startRow > 0 ? (sheet.getRange(r.startRow - 1, r.startColumn, 1, width).getValues()[0] as unknown[]) : [];
  if (above.some((v) => typeof v === "string" && v.trim())) {
    const range = a1({ ...r, startRow: r.startRow - 1 });
    return { range, note: `${a1(r)} starts below the header row, so the chart uses ${range} and takes its series names from row ${r.startRow}.` };
  }
  throw new ToolError(
    `The first row of ${input} holds numbers (${first.map(display).join(", ")}), so the chart would have no series names. Include the header row.`,
  );
}

function findChart(ctx: SheetsAgentContext, title?: string) {
  const sheetId = ctx.book.getActiveSheet().getSheetId();
  const charts = ctx.content().charts.filter((c) => c.sheetId === sheetId);
  if (title) return charts.find((c) => c.title.toLowerCase().includes(title.toLowerCase())) ?? charts.at(-1);
  return charts.at(-1);
}

/** What a chart range plots: "It shows Budget, Actual (A1:C5's header row) for Design, … (column A)." */
function chartContents(sheet: any, source: { startRow: number; endRow: number; startColumn: number; endColumn: number }) {
  try {
    const values = sheet
      .getRange(source.startRow, source.startColumn, source.endRow - source.startRow + 1, source.endColumn - source.startColumn + 1)
      .getValues() as unknown[][];
    const series = values[0].slice(1).map(display);
    const labels = values.slice(1).map((row) => display(row[0]));
    const formulas = (sheet
      .getRange(source.startRow, source.startColumn, source.endRow - source.startRow + 1, source.endColumn - source.startColumn + 1)
      .getFormulas?.() ?? []) as string[][];
    const totals = labels
      .map((label, i) => ({ label, row: source.startRow + i + 2, formulas: formulas[i + 1]?.slice(1) ?? [] }))
      .filter((r) => /^(grand\s+)?totals?\b/i.test(r.label) || (r.formulas.length && r.formulas.every((f) => /^=SUM\(/i.test(f ?? ""))));
    const total = totals.length
      ? ` Row ${totals.map((r) => r.row).join(", ")} (${totals.map((r) => r.label).join(", ")}) adds up the rows above, so it dwarfs the others; charts usually leave totals out.`
      : "";
    return `It shows ${series.join(", ")} (from the header row) for ${labels.join(", ")} (from column ${columnLetter(source.startColumn)}).${total} If that is more than the user asked for, narrow the range with edit_chart.`;
  } catch {
    return "";
  }
}

/** The cells a chart sits over, e.g. "F1:J12". */
export function chartCells(sheet: any, c: ChartDefinition) {
  try {
    const rect = (row: number, col: number) => JSON.parse(sheet.getRange(row, col, 1, 1).getCellRect().toJSON());
    const origin = rect(0, 0);
    const x = c.x + (c.excel ? origin.left : 0),
      y = c.y + (c.excel ? origin.top : 0);
    const column = (px: number) => {
      let i = 0;
      while (i < 200 && rect(0, i).right <= px) i++;
      return i;
    };
    const row = (px: number) => {
      let i = 0;
      while (i < 2000 && rect(i, 0).bottom <= px) i++;
      return i;
    };
    return a1({ startRow: row(y), endRow: row(y + c.height - 1), startColumn: column(x), endColumn: column(x + c.width - 1) });
  } catch {
    return `x=${c.x}, y=${c.y}`;
  }
}

/** Charts and pivot tables. */
export function sheetChartTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { book } = ctx;
  const { sheet, select } = kit;
  return [
    tool({
      name: "insert_chart",
      label: "Insert chart",
      description:
        "Insert a chart from a range whose first row is headers and first column is labels (e.g. A1:C5); include only the columns and rows the user wants charted. type: column (the default), line, pie or scatter. The chart appears below the table.",
      parameters: Type.Object({
        range: Type.String(),
        type: Type.Optional(Type.String({ enum: ["column", "line", "pie", "scatter"] })),
        title: Type.Optional(Type.String()),
      }),
      target: () => document.querySelector(".chart-btn") ?? undefined,
      async execute({ range: asked, type = "column", title }) {
        const { range, note } = checkHeaderRow(sheet(), asked);
        select(range);
        const before = new Set(ctx.content().charts.map((c) => c.id));
        ctx.openPanel("chart", {
          range,
          sheetId: sheet().getSheetId(),
          title: title ?? "",
          chartType: type === "column" ? "bar" : (type as ChartDefinition["type"]),
        });
        await wait(1200);
        await ctx.submitPanel();
        await wait(400);
        const chart = ctx.content().charts.find((c) => !before.has(c.id));
        if (!chart) throw new ToolError("The chart was not created. Check that the range has a header row and numbers.");
        return `Inserted a ${type} chart "${chart.title}" from ${a1(chart.source)} (${chart.width}×${chart.height}px), below the table: it covers ${chartCells(sheet(), chart)}. The table is ${a1(usedRange(sheet()))}.${note ? ` ${note}` : ""} ${chartContents(sheet(), chart.source)}`;
      },
    }),
    tool({
      name: "edit_chart",
      label: "Edit chart",
      description:
        "Change a chart: its range, type, title, position (place it with its top-left at a cell, e.g. F1) or size in pixels.",
      parameters: Type.Object({
        chart: Type.Optional(Type.String({ description: "The chart's title; defaults to the only or newest chart." })),
        range: Type.Optional(Type.String()),
        type: Type.Optional(Type.String({ enum: ["column", "line", "pie", "scatter"] })),
        title: Type.Optional(Type.String()),
        move_to: Type.Optional(Type.String({ description: "Top-left cell for the chart, e.g. F1" })),
        width: Type.Optional(Type.Number()),
        height: Type.Optional(Type.Number()),
      }),
      target: ({ chart }) => {
        const c = findChart(ctx, chart);
        return document.querySelector(`[data-chart-id="${c?.id}"]`);
      },
      async execute(args) {
        const c = findChart(ctx, args.chart);
        if (!c) throw new ToolError("There is no chart on this sheet yet. Make one with insert_chart first, then edit it.");
        // Check everything before changing anything, so an error means nothing moved.
        const range = args.range ? checkHeaderRow(sheet(), args.range).range : undefined;
        if (args.move_to) parseCell(args.move_to);
        const changed: string[] = [];
        if (args.move_to || args.width || args.height) {
          if (args.move_to) {
            const cell = parseCell(args.move_to);
            const origin = JSON.parse(sheet().getRange(0, 0, 1, 1).getCellRect().toJSON());
            const at = JSON.parse(sheet().getRange(cell.row, cell.column, 1, 1).getCellRect().toJSON());
            // Charts made in SuiteLeaf are placed in canvas pixels (headers included); Excel ones from A1.
            c.x = at.left - (c.excel ? origin.left : 0);
            c.y = at.top - (c.excel ? origin.top : 0);
            changed.push(`moved to ${args.move_to}`);
          }
          const was = { width: c.width, height: c.height };
          if (args.width) c.width = Math.max(200, Math.round(args.width));
          if (args.height) c.height = Math.max(150, Math.round(args.height));
          const grew = c.width * c.height - was.width * was.height;
          if (args.width || args.height)
            changed.push(`resized to ${c.width}×${c.height} (from ${was.width}×${was.height}, so ${grew > 0 ? "larger" : grew < 0 ? "smaller" : "the same size"})`);
          book.getSheetBySheetId(c.sheetId)?.removeFloatDom(c.id);
          ctx.refreshCharts();
          ctx.persist();
          await wait(300);
          await moveCursor(document.querySelector(`[data-chart-id="${c.id}"]`), "Edit chart");
        }
        const typeName = (t: string) => (t === "column" ? "bar" : t);
        if (
          (range && a1(parseA1(range)) !== a1(c.source)) ||
          (args.type && typeName(args.type) !== c.type) ||
          (args.title && args.title.trim() !== c.title)
        ) {
          ctx.openPanel(
            "chart",
            {
              range: range ? a1(parseA1(range)) : a1(c.source),
              sheetId: c.source.sheetId,
              title: args.title ?? c.title,
              chartType: args.type ? (args.type === "column" ? "bar" : (args.type as ChartDefinition["type"])) : c.type,
            },
            c.id,
          );
          await wait(1100);
          await ctx.submitPanel();
          changed.push("updated its settings");
        }
        const now = ctx.content().charts.find((x) => x.id === c.id) ?? c;
        return `Chart "${now.title}": ${changed.join(", ") || "no change"}. It is ${now.width}×${now.height}px and covers ${chartCells(sheet(), now)}; the table is ${a1(usedRange(sheet()))}.${changed.includes("updated its settings") ? ` ${chartContents(sheet(), now.source)}` : ""}`;
      },
    }),
    tool({
      name: "create_pivot",
      label: "Pivot table",
      description:
        "Summarize a table with a pivot table on a new, read-only sheet that updates by itself when the source changes. rows: headers whose values go down the side; columns: headers whose values go across the top (\"split by who paid\" is columns [\"Paid by\"]); value: the header to summarize; summarize: SUM, COUNT, AVERAGE, MIN, MAX, or PERCENT. PERCENT is each number as a percent of the total. Grand totals are added. Numbers keep the source column's number format; number_format (e.g. currency for dollars) sets it on the source's value cells, which the pivot follows. Only use filter_column/filter_value when the user asks to leave some rows out (keeps rows whose filter_column equals filter_value).",
      parameters: Type.Object({
        range: Type.Optional(Type.String()),
        rows: Type.Array(Type.String({ description: "Header names; their values go down the side" })),
        columns: Type.Optional(Type.Array(Type.String({ description: "Header names; their values go across the top" }))),
        value: Type.String(),
        summarize: Type.String({ enum: ["SUM", "COUNT", "AVERAGE", "MIN", "MAX", "PERCENT"] }),
        filter_column: Type.Optional(Type.String()),
        filter_value: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
        number_format: Type.Optional(Type.String({ enum: ["currency", "accounting", "percent", "percent_whole", "number", "plain"] })),
      }),
      target: () => document.querySelector(".pivot-btn") ?? undefined,
      async execute(args) {
        const s = sheet();
        const r = args.range ? parseA1(args.range) : usedRange(s);
        const field = (name: string) => resolveColumn(s, r, name) - r.startColumn;
        let filterValue = args.filter_value ?? "";
        // A filter column without a value (Gemma sometimes sends one) filters nothing.
        const filtering = !!args.filter_column && !!filterValue.trim();
        if (filtering) {
          const col = resolveColumn(s, r, args.filter_column!);
          const values = [
            ...new Set<string>(
              s
                .getRange(r.startRow + 1, col, r.endRow - r.startRow, 1)
                .getValues()
                .map((x: unknown[]) => display(x[0])),
            ),
          ];
          const match = values.find((v) => v.trim().toLowerCase() === filterValue.trim().toLowerCase());
          if (match === undefined)
            throw new ToolError(
              `No row has ${args.filter_column} equal to "${filterValue}"; its values are ${values.slice(0, 20).join(", ")}. Leave filter_column and filter_value out to summarize every row.`,
            );
          filterValue = match;
        }
        const valueColumn = resolveColumn(s, r, args.value);
        const valueCells = a1({ startRow: r.startRow + 1, endRow: r.endRow, startColumn: valueColumn, endColumn: valueColumn });
        if (args.number_format) {
          const id = NUMBER_FORMATS[args.number_format];
          await revealRange(book, valueCells);
          await moveCursor(rangeScreenRect(book, valueCells), "Format cells");
          if (!id || !applyNamedFormat(id, (code) => s.getRange(valueCells).setNumberFormat(code)).ok)
            throw new ToolError(`Unknown number format ${args.number_format}.`);
          ctx.persist();
          await ctx.settle();
          await moveCursor(document.querySelector(".pivot-btn"), "Pivot table");
        }
        const before = new Set(ctx.content().pivots.map((p) => p.id));
        select(a1(r));
        ctx.openPanel("pivot", {
          range: a1(r),
          sheetId: s.getSheetId(),
          title: args.title ?? "Pivot table",
          rows: args.rows.map(field),
          columns: (args.columns ?? []).map(field),
          value: field(args.value),
          aggregate: args.summarize as PivotDefinition["aggregate"],
          filterColumn: filtering ? field(args.filter_column!) : -1,
          filterValue,
        });
        await wait(1300);
        await ctx.submitPanel();
        await wait(500);
        const p = ctx.content().pivots.find((x) => !before.has(x.id));
        if (!p) throw new ToolError("The pivot table was not created.");
        const target = book.getSheetBySheetId(p.targetSheetId);
        const code = s.getRange(r.startRow + 1, valueColumn, 1, 1).getNumberFormat?.() || "";
        const format = args.number_format
          ? `as ${args.number_format} (${code}): the source cells ${valueCells} on sheet "${s.getSheetName()}" were formatted that way, and the pivot follows them`
          : code && code !== "General"
            ? `in the source's number format (${code})`
            : `as plain numbers, like the source cells ${valueCells} on sheet "${s.getSheetName()}". If the user asked for another format (e.g. dollars), call format_cells on this pivot sheet with that number_format; it formats the source numbers, which the pivot follows`;
        return `Created pivot table "${p.title}" on sheet "${target?.getSheetName()}" (read-only; it follows the source):\n${grid(target, usedRange(target), 30, 10)}\nNumbers are shown ${format}.`;
      },
    }),
    tool({
      name: "copy_pivot",
      label: "Editable copy",
      description:
        "Make an editable copy of a pivot table (pivot sheets are read-only) on a new sheet with the same numbers and formatting. Defaults to the pivot on the active sheet, or the only one.",
      parameters: Type.Object({ pivot: Type.Optional(Type.String({ description: "The pivot table's title" })) }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Make editable copy")),
      async execute({ pivot }) {
        const all = ctx.content().pivots;
        const p =
          (pivot && all.find((x) => x.title.toLowerCase() === pivot.trim().toLowerCase())) ||
          all.find((x) => x.targetSheetId === sheet().getSheetId()) ||
          (all.length === 1 ? all[0] : undefined);
        if (!p)
          throw new ToolError(
            all.length ? `Say which pivot table to copy: ${all.map((x) => `"${x.title}"`).join(", ")}.` : "There is no pivot table in this workbook.",
          );
        ctx.copyPivot(p);
        await wait(300);
        await moveCursor(
          [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === sheet().getSheetName()),
          "Editable copy",
        );
        return `Made an editable copy of "${p.title}" on the new sheet "${sheet().getSheetName()}", now the active sheet:\n${grid(sheet(), usedRange(sheet()), 30, 10)}`;
      },
    }),
  ];
}
