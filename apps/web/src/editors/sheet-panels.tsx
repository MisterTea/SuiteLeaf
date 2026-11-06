import type { RefObject } from "react";
import { SetRangeValuesCommand } from "@univerjs/sheets";
import { localTableBlocked, localTableValues, type SheetFile } from "@suiteleaf/core";
import SheetCleanup from "./sheet-cleanup-ui";
import { SheetSpelling } from "./grid-spelling-ui";
import { SheetLanguageField } from "./sheet-language";
import { proofingLanguage, type ProofingLanguage } from "./proofing-language";
import SheetRowGroups, { type SheetRowGroupsHandle } from "./sheet-row-groups-ui";
import SheetColumnGroups, { type SheetColumnGroupsHandle } from "./sheet-column-groups-ui";
import SheetFeatures from "./sheet-features";
import SheetList from "./sheet-list";
import SheetPrint, { type SheetPrintHandle } from "./sheet-print-ui";
import NamedRanges, { type NamedRangesHandle } from "./named-ranges-ui";
import { SheetAccessNote } from "./sheet-access-note";
import { SheetTableNote } from "./sheet-table-note";
import { SheetCellFields } from "./sheet-cell-fields";
import { SheetCostNote } from "./sheet-cost-note";
import { SheetAuditNote } from "./sheet-audit-note";
import {
  applySheetQuery,
  checkSheetQuery,
  forgetSheetSchedule,
  rememberSheetSchedule,
  rememberSheetStep,
  savedSheetSchedule,
  savedSheetStep,
  SheetQueryPanel,
  type SheetQueryResult,
} from "./sheet-query-panel";
import { parseCellAddress, seekOnSheet, SheetGoalPanel } from "./sheet-goal-panel";
import { solveOnSheet } from "./sheet-solver";

/** Dialogs and helpers that act on the grid once Univer is ready. */
export function SheetToolDialogs({
  ready,
  api,
  engine,
  book,
  host,
  file,
  content,
  persist,
  printSheet,
  onError,
  proofing,
  names,
  printing,
  cleanup,
  spelling,
  rowGroups,
  columnGroups,
  tabSettings,
  sheetList,
}: {
  ready: boolean;
  api: RefObject<any>;
  engine: RefObject<any>;
  book: RefObject<any>;
  host: RefObject<HTMLDivElement | null>;
  file: SheetFile;
  content: RefObject<SheetFile["content"]>;
  persist: RefObject<() => void>;
  printSheet: RefObject<() => Promise<void>>;
  onError: (s: string) => void;
  proofing: ProofingLanguage;
  names: RefObject<NamedRangesHandle | null>;
  printing: RefObject<SheetPrintHandle | null>;
  cleanup: RefObject<{ trim: () => void; duplicates: () => void; split: () => void } | null>;
  spelling: RefObject<{ open: () => void } | null>;
  rowGroups: RefObject<SheetRowGroupsHandle | null>;
  columnGroups: RefObject<SheetColumnGroupsHandle | null>;
  tabSettings: RefObject<{ openTabs: () => void; openCommentName: () => void } | null>;
  sheetList: RefObject<{ open: () => void } | null>;
}) {
  return (
    <>
    {ready && api.current && engine.current ? (
      <NamedRanges
        ref={names}
        api={api.current}
        engine={engine.current}
        persist={() => persist.current()}
      />
    ) : null}
    {ready && api.current && engine.current ? (
      <SheetPrint
        ref={printing}
        api={api.current}
        engine={engine.current}
        content={content}
        persist={() => persist.current()}
        onPrint={() => printSheet.current()}
      />
    ) : null}
    {ready && api.current && engine.current ? (
      <SheetCleanup
        ref={cleanup}
        api={api.current}
        engine={engine.current}
        persist={() => persist.current()}
        onError={onError}
      />
    ) : null}
    {ready ? (
      <SheetSpelling
        ref={spelling}
        bookRef={book}
        hostRef={host}
        engineRef={engine}
        fileId={file.id}
        ready={ready}
        language={proofing}
        persist={() => persist.current()}
      />
    ) : null}
    {ready && api.current && engine.current ? (
      <SheetRowGroups
        ref={rowGroups}
        api={api.current}
        engine={engine.current}
        persist={() => persist.current()}
      />
    ) : null}
    {ready && api.current && engine.current ? (
      <SheetColumnGroups
        ref={columnGroups}
        api={api.current}
        engine={engine.current}
        persist={() => persist.current()}
      />
    ) : null}
    {ready && api.current ? (
      <SheetFeatures
        ref={tabSettings}
        api={api.current}
        persist={() => persist.current()}
        onError={onError}
      />
    ) : null}
    {ready && api.current ? (
      <SheetList
        ref={sheetList}
        api={api.current}
        persist={() => persist.current()}
        onError={onError}
      />
    ) : null}
    </>
  );
}

/** Notes and side panels the toolbar opens: cost, audit, language, accessibility, query, and goal seek. */
export function SheetSidePanels({
  setAuditOpen,
  costOpen,
  auditOpen,
  languageOpen,
  sheetAccessOpen,
  queryOpen,
  goalOpen,
  setQueryOpen,
  content,
  book,
  api,
  persist,
  readOnly,
  proofing,
  setProofing,
}: {
  setAuditOpen?: (open: boolean) => void;
  costOpen: boolean;
  auditOpen: boolean;
  languageOpen: boolean;
  sheetAccessOpen: boolean;
  queryOpen: boolean;
  goalOpen: boolean;
  setQueryOpen: (open: boolean) => void;
  content: RefObject<SheetFile["content"]>;
  book: RefObject<any>;
  api: RefObject<any>;
  persist: RefObject<() => void>;
  readOnly: boolean;
  proofing: ProofingLanguage;
  setProofing: (language: ProofingLanguage) => void;
}) {
  return (
    <>
    {costOpen ? (
      <SheetCostNote content={content.current} onOpenQuery={() => setQueryOpen(true)} />
    ) : null}
    {auditOpen ? <SheetAuditNote content={content.current} onClose={() => setAuditOpen?.(false)} /> : null}
    {languageOpen ? (
      <SheetLanguageField
        language={proofing}
        onChange={(language) => {
          content.current.proofingLanguage = language;
          setProofing(language);
          persist.current();
        }}
      />
    ) : null}
    <SheetTableNote tables={content.current.tables ?? []} />
    {sheetAccessOpen ? (
      <>
        <SheetAccessNote
          content={content.current}
          onSelect={(sheetId, column, row = 0) => {
            const workbook = book.current as
              | {
                  getSheetBySheetId?: (id: string) => { getRange: (row: number, column: number, rows: number, columns: number) => { activate: () => void } } | null;
                }
              | null;
            workbook?.getSheetBySheetId?.(sheetId)?.getRange(row, column, 1, 1).activate();
          }}
        />
        <SheetCellFields
          language={proofingLanguage(content.current.proofingLanguage)}
          sheets={content.current.workbook.sheetOrder.map((id) => {
            const sheet = content.current.workbook.sheets[id];
            return {
              id,
              name: sheet?.name?.trim() || "Sheet",
              grid: sheet?.cellData ?? {},
            };
          })}
          disabled={readOnly}
          onEdit={(row, column, value, sheetId) => {
            const target = sheetId || content.current.workbook.sheetOrder[0];
            void api.current?.executeCommand(SetRangeValuesCommand.id, {
              ...(target ? { subUnitId: target } : {}),
              range: {
                startRow: row,
                endRow: row,
                startColumn: column,
                endColumn: column,
              },
              value: { v: value, p: null },
            });
          }}
        />
      </>
    ) : null}
    {queryOpen ? (
      <SheetQueryPanel
        disabled={readOnly}
        initial={savedSheetStep(content.current.queries)}
        schedule={savedSheetSchedule(content.current.queries)}
        onRememberSchedule={(minutes, source) => {
          content.current.queries = rememberSheetSchedule(content.current.queries, minutes, source);
          persist.current();
        }}
        onForgetSchedule={() => {
          content.current.queries = forgetSheetSchedule(content.current.queries);
          persist.current();
        }}
        onCheck={(step) => {
          const sheet = book.current?.getActiveSheet?.();
          if (!sheet) return "The spreadsheet is not open.";
          return checkSheetQuery(sheet, step);
        }}
        onLocalTable={(rows) => {
          const sheet = book.current?.getActiveSheet?.();
          const cell = book.current?.getActiveCell?.();
          const values = localTableValues(rows);
          if (!sheet || !cell || values.length === 0 || values[0].length === 0) {
            return "The spreadsheet is not open.";
          }
          const height = values.length;
          const width = values[0].length;
          const existing = sheet.getRange(cell.getRow(), cell.getColumn(), height, width).getRawValues?.() ?? [];
          if (localTableBlocked(existing)) return "A cell already has a value.";
          sheet.getRange(cell.getRow(), cell.getColumn(), height, width).setValues(values);
          persist.current();
          return height === 2 ? "The table has 1 row." : `The table has ${height - 1} rows.`;
        }}
        onApply={(step, previous) => {
          const sheet = book.current?.getActiveSheet?.();
          if (!sheet)
            return {
              placement: previous,
              message: "The spreadsheet is not open.",
              changed: false,
            } satisfies SheetQueryResult;
          try {
            const result = applySheetQuery(sheet, step, previous, new Date().toISOString());
            if (result.changed) {
              content.current.queries = rememberSheetStep(content.current.queries, step);
              persist.current();
            }
            return result;
          } catch (caught) {
            return {
              placement: previous,
              message: caught instanceof Error ? caught.message : String(caught),
              changed: false,
            };
          }
        }}
      />
    ) : null}
    {goalOpen ? (
      <SheetGoalPanel
        disabled={readOnly}
        onSeek={async ({ formula, target, low, high, shouldStop }) => {
          const address = parseCellAddress(formula);
          const sheet = book.current?.getActiveSheet?.();
          const active = book.current?.getActiveCell?.();
          if (!address) return { message: "Name the formula cell, such as B2.", wrote: false };
          if (!sheet || !active) return { message: "Select the input cell.", wrote: false };
          try {
            const result = await seekOnSheet({
              input: { row: active.getRow(), column: active.getColumn() },
              formula: address,
              target,
              low,
              high,
              read: (cell) => {
                const range = sheet.getRange(cell.row, cell.column, 1, 1);
                const raw = range.getFormulas?.()?.[0]?.[0];
                return {
                  formula: typeof raw === "string" ? raw : "",
                  value: range.getValues?.()?.[0]?.[0],
                };
              },
              write: (cell, value) => {
                sheet.getRange(cell.row, cell.column, 1, 1).setValues([[value]]);
              },
              calculate: async () => {
                await api.current?.getFormula()?.onCalculationResultApplied(10000);
              },
              shouldStop,
            });
            if (result.wrote) persist.current();
            return result;
          } catch (caught) {
            return {
              message: caught instanceof Error ? caught.message : String(caught),
              wrote: false,
            };
          }
        }}
        onSolve={async ({ formula, second, third, target, low, high, secondLow, secondHigh, thirdLow, thirdHigh, atMost, shouldStop }) => {
          const address = parseCellAddress(formula);
          const other = parseCellAddress(second);
          const extra = third ? parseCellAddress(third) : null;
          const sheet = book.current?.getActiveSheet?.();
          const active = book.current?.getActiveCell?.();
          if (third && !extra) return { message: "Name the third input, such as D2.", wrote: false };
          if (!address || !other) return { message: "Name the formula cell, such as B2.", wrote: false };
          if (!sheet || !active) return { message: "Select the input cell.", wrote: false };
          const read = (cell: { row: number; column: number }) => {
            const range = sheet.getRange(cell.row, cell.column, 1, 1);
            const raw = range.getFormulas?.()?.[0]?.[0];
            return {
              formula: typeof raw === "string" ? raw : "",
              value: range.getValues?.()?.[0]?.[0],
            };
          };
          try {
            const result = await solveOnSheet({
              inputs: extra
                ? [{ row: active.getRow(), column: active.getColumn() }, other, extra]
                : [{ row: active.getRow(), column: active.getColumn() }, other],
              formula: address,
              target,
              lows: extra ? [low, secondLow, thirdLow ?? secondLow] : [low, secondLow],
              highs: extra ? [high, secondHigh, thirdHigh ?? secondHigh] : [high, secondHigh],
              atMost,
              read,
              write: (cell, value) => {
                sheet.getRange(cell.row, cell.column, 1, 1).setValues([[value]]);
              },
              calculate: async () => {
                await api.current?.getFormula()?.onCalculationResultApplied(10000);
              },
              shouldStop,
            });
            if (result.wrote) persist.current();
            return result;
          } catch {
            return { message: "The formula could not be calculated. The inputs were put back.", wrote: false };
          }
        }}
      />
    ) : null}
    </>
  );
}
