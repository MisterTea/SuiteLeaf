/**
 * A structural timing of a workbook. Cell values are counted and then dropped.
 * This does not time Univer's recalculation and does not claim a speedup.
 */

import { cellAddress } from "./sheet-audit";

type Cell = { f?: string | null; v?: unknown } | null;
type Cells = Record<string, Record<string, Cell>>;

export type SheetCostInput = {
  name: string;
  cellData?: Cells;
  conditionalFormats?: unknown[];
  charts?: unknown[];
};

export type SheetCostReport = {
  cancelled: false;
  sheets: number;
  cells: number;
  formulas: number;
  volatileFormulas: number;
  conditionalFormats: number;
  charts: number;
  elapsedMs: number;
  dominant: { kind: string; action: string };
};

export type SheetCostStop = {
  cancelled: true;
  elapsedMs: number;
};

const VOLATILE = /\b(NOW|RAND|RANDBETWEEN|TODAY|OFFSET|INDIRECT)\s*\(/i;

function formulaSource(formula: string): string {
  return formula.replace(/"(?:[^"]|"")*"/g, "");
}

/** Addresses of volatile formulas. The formula text is not returned. */
export function volatileFormulaAddresses(cellData: SheetCostInput["cellData"]): string[] {
  const found: string[] = [];
  const rows = cellData ?? {};
  for (const row of Object.keys(rows)) {
    for (const column of Object.keys(rows[row] ?? {})) {
      const formula = typeof rows[row]?.[column]?.f === "string" ? rows[row][column].f : "";
      if (formula && VOLATILE.test(formulaSource(formula))) {
        found.push(cellAddress(Number(row), Number(column)));
      }
    }
  }
  return found.sort(compareAddresses).slice(0, 20);
}

function compareAddresses(left: string, right: string): number {
  const a = addressParts(left);
  const b = addressParts(right);
  return a.column - b.column || a.row - b.row || left.localeCompare(right, "en");
}

function addressParts(address: string): { column: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) return { column: Number.MAX_SAFE_INTEGER, row: Number.MAX_SAFE_INTEGER };
  let column = 0;
  for (const char of match[1]) column = column * 26 + (char.charCodeAt(0) - 64);
  return { column, row: Number(match[2]) };
}

function weight(
  report: Omit<SheetCostReport, "cancelled" | "elapsedMs" | "dominant">,
) {
  const volatile = report.volatileFormulas * 50;
  const formulas = report.formulas * 5;
  const rules = report.conditionalFormats * 8 + report.charts * 8;
  const cells = report.cells;
  const ranked = [
    {
      kind: "volatile formulas",
      score: volatile,
      action:
        "Volatile formulas recalculate even when their inputs do not change. Replace NOW, RAND, TODAY, INDIRECT, or OFFSET with a value or an ordinary reference where you can.",
    },
    {
      kind: "formulas",
      score: formulas,
      action:
        "Formulas are the largest measured part of this scan. A long chain can be split, and data that no longer fits an interactive sheet can move to a query.",
    },
    {
      kind: "rules and charts",
      score: rules,
      action:
        "Conditional rules and charts are the largest measured part of this scan. Fewer rules over the same range, or a chart on a smaller range, reduces that work.",
    },
    {
      kind: "stored cells",
      score: cells,
      action:
        "Stored cells are the largest measured part of this scan. This pass does not time recalculation.",
    },
  ];
  return ranked.sort((a, b) => b.score - a.score)[0];
}

/** Read the workbook and return a cost report. `shouldStop` ends the scan and leaves the input unchanged. */
export function inspectSheetCost(
  sheets: SheetCostInput[],
  shouldStop?: () => boolean,
): SheetCostReport | SheetCostStop {
  const started = Date.now();
  const counts = {
    sheets: sheets.length,
    cells: 0,
    formulas: 0,
    volatileFormulas: 0,
    conditionalFormats: 0,
    charts: 0,
  };
  for (const sheet of sheets) {
    counts.conditionalFormats += sheet.conditionalFormats?.length ?? 0;
    counts.charts += sheet.charts?.length ?? 0;
    const rows = sheet.cellData ?? {};
    for (const row of Object.keys(rows)) {
      for (const column of Object.keys(rows[row] ?? {})) {
        if (shouldStop?.())
          return { cancelled: true, elapsedMs: Date.now() - started };
        const cell = rows[row][column];
        counts.cells += 1;
        const formula = typeof cell?.f === "string" ? cell.f : "";
        if (!formula) continue;
        counts.formulas += 1;
        if (VOLATILE.test(formulaSource(formula))) counts.volatileFormulas += 1;
      }
    }
  }
  const dominant = weight(counts);
  return {
    cancelled: false,
    ...counts,
    elapsedMs: Date.now() - started,
    dominant: { kind: dominant.kind, action: dominant.action },
  };
}
