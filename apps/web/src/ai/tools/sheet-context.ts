import type { ChartDefinition, PivotDefinition, SheetFile } from "@suiteleaf/core";

/** What the Sheets editor lends the agent. */
export interface SheetsAgentContext {
  api: any;
  book: any;
  title: string;
  content: () => SheetFile["content"];
  persist: () => void;
  settle: () => Promise<void>;
  /** Open the chart or pivot panel prefilled, as Insert chart / Pivot table does. */
  openPanel: (type: "chart" | "pivot", values: PanelValues, editing?: string) => void;
  /** Press the panel's Create/Update button. */
  submitPanel: () => Promise<void>;
  refreshCharts: () => void;
  copyPivot: (p: PivotDefinition) => void;
  /** Open Data › Sort range on `range`, filled in with `rules` (columns counted from the range's first column). */
  showSort: (
    range: { startRow: number; endRow: number; startColumn: number; endColumn: number },
    rules?: { column: number; ascending: boolean }[],
    hasHeader?: boolean,
  ) => void;
  sort: (rules: { column: number; ascending: boolean }[], hasHeader: boolean) => void;
  freeze: (axis: "rows" | "columns", count: number) => void;
  /** Group detail rows. A total whose formula adds those rows is left outside the group. */
  groupRows: (
    startRow: number,
    endRow: number,
  ) =>
    | { ok: true; startRow: number; endRow: number; keptTotal: boolean; already: boolean }
    | { ok: false; message: string };
  /** Keep one 0-based detail row visible and collapse the other rows in its group. */
  showOnlyRow: (row: number) =>
    | {
        ok: true;
        startRow: number;
        endRow: number;
        kept: number;
        collapsed: number[];
        label: string;
      }
    | { ok: false; message: string };
  /** Group detail columns. A text label on the left and a year-total formula on the right stay outside. */
  groupColumns: (
    startColumn: number,
    endColumn: number,
  ) =>
    | {
        ok: true;
        startColumn: number;
        endColumn: number;
        keptTotal: boolean;
        keptLabel: boolean;
        already: boolean;
      }
    | { ok: false; message: string };
  /** Keep one 0-based detail column visible and collapse the other columns in its group. */
  showOnlyColumn: (column: number) =>
    | {
        ok: true;
        startColumn: number;
        endColumn: number;
        kept: number;
        collapsed: number[];
        label: string;
      }
    | { ok: false; message: string };
  insertCheckbox: () => void;
  /** Undefined once the browser downloads it; on the desktop, the saved path or null if cancelled. */
  exportAs: (format: "xlsx" | "csv" | "tsv") => Promise<string | null | void>;
  /** Set the name comments are signed with on this device; absent when a signed-in account names them. */
  setAuthor?: (name: string) => void;
  /** The name saved with new comments ("" when none is set). */
  signature?: () => string;
  /** Steps in the workbook's undo history. */
  undoCount: () => number;
}

export interface PanelValues {
  range: string;
  sheetId: string;
  title: string;
  chartType?: ChartDefinition["type"];
  rows?: number[];
  columns?: number[];
  value?: number;
  aggregate?: PivotDefinition["aggregate"];
  filterColumn?: number;
  filterValue?: string;
}
