import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { CommandType, ICommandService, IUndoRedoService } from "@univerjs/core";
import { X } from "lucide-react";

import {
  mergePrint,
  printCell,
  printedPages,
  readSheetPrint,
  toggleBreak,
  writeSheetPrint,
  type PrintContent,
  type PrintedPage,
  type SheetPrintSettings,
} from "./sheet-print";

const MUTATION = "suiteleaf.mutation.set-sheet-print";
const BREAK_SIZE = 12;
const BREAK_COLOR = "#1a73e8";

type Engine = { get: (id: unknown) => any };
type PrintMutation = {
  unitId: string;
  sheetId: string;
  breaksAbove?: number[];
  repeatFirstRow?: boolean;
};

let applyPrint: (params: PrintMutation) => void = () => {};

export type SheetPrintHandle = {
  insertPageBreak: () => void;
  openPrintSettings: () => void;
};

function paintBreaks(sheet: any, rows: number[]): boolean {
  const skeleton = sheet.getSkeleton?.();
  if (!skeleton?.setGapConfig) return false;
  const rowGaps: Record<number, { size: number; color: string; stripeColor: string }> =
    {};
  for (const row of rows)
    if (row > 0)
      rowGaps[row] = { size: BREAK_SIZE, color: BREAK_COLOR, stripeColor: BREAK_COLOR };
  skeleton.setGapConfig({
    rowGaps,
    defaultBackgroundColor: BREAK_COLOR,
    defaultStripeColor: BREAK_COLOR,
  });
  try {
    sheet.refreshCanvas?.();
  } catch {
    return false;
  }
  return true;
}

function gridOf(api: any): unknown[][] {
  try {
    const values = api.getActiveWorkbook()?.getActiveSheet()?.getDataRange()?.getValues();
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}

export default function SheetPrint({
  api,
  engine,
  content,
  persist,
  onPrint,
  ref,
}: {
  api: any;
  engine: Engine;
  content: { current: PrintContent };
  persist: () => void;
  onPrint: () => Promise<void>;
  ref?: Ref<SheetPrintHandle>;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [settings, setSettings] = useState<SheetPrintSettings>({
    breaksAbove: [],
    repeatFirstRow: false,
  });
  const box = useRef<HTMLInputElement>(null);
  const contentRef = useRef(content);
  const persistRef = useRef(persist);
  contentRef.current = content;
  persistRef.current = persist;

  useEffect(() => {
    applyPrint = (params) => {
      if (!params?.sheetId) return;
      const current = readSheetPrint(contentRef.current.current, params.sheetId);
      writeSheetPrint(
        contentRef.current.current,
        params.sheetId,
        mergePrint(current, params),
      );
      persistRef.current();
    };
    const commands = engine.get(ICommandService);
    if (!commands.hasCommand(MUTATION))
      commands.registerCommand({
        id: MUTATION,
        type: CommandType.MUTATION,
        handler: (_accessor: unknown, params: PrintMutation) => {
          applyPrint(params);
          return true;
        },
      });
    return () => {
      applyPrint = () => {};
    };
  }, [engine]);

  useEffect(() => {
    const book = api.getActiveWorkbook?.();
    if (!book) return;
    const painted = { key: "", hadBreaks: false };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const sheet = book.getActiveSheet?.();
      if (!sheet) return;
      const id = sheet.getSheetId() as string;
      const next = readSheetPrint(content.current, id);
      const key = `${id}:${next.repeatFirstRow}:${next.breaksAbove.join(",")}`;
      if (painted.key === key) return;
      clearTimeout(timer);
      painted.key = key;
      setSheetId(id);
      setSettings(next);
      if (!next.breaksAbove.length && painted.hadBreaks) setNotice("");
      const needsLine = next.breaksAbove.length > 0 || painted.hadBreaks;
      painted.hadBreaks = next.breaksAbove.length > 0;
      if (!needsLine) return;
      const draw = (tries: number) => {
        if (paintBreaks(sheet, next.breaksAbove) || tries <= 0) return;
        timer = setTimeout(() => draw(tries - 1), 40);
      };
      draw(8);
    };
    sync();
    const sub = engine.get(ICommandService).onCommandExecuted(sync);
    return () => {
      clearTimeout(timer);
      sub.dispose();
    };
  }, [api, engine, content]);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  const commit = (patch: { breaksAbove?: number[]; repeatFirstRow?: boolean }, undoable: boolean) => {
    const book = api.getActiveWorkbook?.();
    const sheet = book?.getActiveSheet?.();
    if (!book || !sheet) return;
    const id = sheet.getSheetId() as string;
    const unitId = book.getId() as string;
    const current = readSheetPrint(content.current, id);
    const next = mergePrint(current, patch);
    const params = { unitId, sheetId: id, ...patch };
    engine.get(ICommandService).syncExecuteCommand(MUTATION, params);
    if (!undoable) return;
    const undoPatch: PrintMutation = {
      unitId,
      sheetId: id,
      breaksAbove: current.breaksAbove,
    };
    const redoPatch: PrintMutation = {
      unitId,
      sheetId: id,
      breaksAbove: next.breaksAbove,
    };
    engine.get(IUndoRedoService).pushUndoRedo({
      unitID: unitId,
      undoMutations: [{ id: MUTATION, params: undoPatch }],
      redoMutations: [{ id: MUTATION, params: redoPatch }],
    });
  };

  useImperativeHandle(ref, () => ({
    insertPageBreak() {
      const book = api.getActiveWorkbook?.();
      const sheet = book?.getActiveSheet?.();
      const row = book?.getActiveRange?.()?.getRange?.()?.startRow ?? 0;
      if (!sheet) return;
      if (row < 1) {
        setNotice("Select a row below row 1. The break goes above that row, and the row stays as it is.");
        return;
      }
      const current = readSheetPrint(content.current, sheet.getSheetId());
      const step = toggleBreak(current.breaksAbove, row);
      commit({ breaksAbove: step.breaks }, true);
      setNotice(
        step.added
          ? `Page break above row ${row + 1}. That row starts the next printed page.`
          : `Removed the page break above row ${row + 1}.`,
      );
    },
    openPrintSettings() {
      setNotice("");
      setOpen(true);
    },
  }));

  const grid = open ? gridOf(api) : [];
  const pages: PrintedPage[] = open ? printedPages(grid, settings) : [];
  const several = pages.length > 1;

  return (
    <>
      <div
        className="sheet-print-marker"
        data-page-breaks={settings.breaksAbove.join(" ")}
        data-repeat-row={settings.repeatFirstRow ? "1" : "0"}
        hidden
      />
      {notice ? (
        <div className="sheet-notice print-break-notice" role="status">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      {open ? (
        <aside className="print-settings" aria-label="Print settings">
          <header>
            <h2>Print settings</h2>
            <button
              type="button"
              aria-label="Close print settings"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <label className="print-repeat-option">
            <input
              ref={box}
              type="checkbox"
              checked={settings.repeatFirstRow}
              onChange={(event) =>
                commit({ repeatFirstRow: event.target.checked }, false)
              }
            />
            Repeat row 1 on each page
          </label>
          <p className="print-settings-note">
            Prints row 1 on every page. It does not freeze the row on screen.
          </p>
          <div className="print-preview" aria-label="Print preview">
            {several ? null : (
              <p className="print-flow">One page. The sheet prints as a single flow.</p>
            )}
            {pages.map((page, index) => {
              const bare = index > 0 && page.rows[0]?.source !== 0;
              return (
                <article className="print-page" data-page={index + 1} key={index}>
                  <h3>Page {index + 1}</h3>
                  {bare ? (
                    <p className="print-page-warning">No column names on this page.</p>
                  ) : null}
                  <table>
                    <tbody>
                      {page.rows.map((row, rowIndex) => (
                        <tr
                          key={`${row.source}-${row.repeated}-${rowIndex}`}
                          className={row.source === 0 ? "print-header" : undefined}
                        >
                          {row.cells.map((cell, column) => (
                            <td key={column}>{printCell(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </article>
              );
            })}
          </div>
          <div className="print-settings-actions">
            <button type="button" onClick={() => void onPrint()}>
              Print
            </button>
          </div>
          <span className="print-sheet-id" hidden>
            {sheetId}
          </span>
        </aside>
      ) : null}
    </>
  );
}
