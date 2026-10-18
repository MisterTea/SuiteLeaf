import { useImperativeHandle, useState, type Ref } from "react";
import type { FUniver } from "@univerjs/core/facade";

type ListedSheet = {
  getSheetId(): string;
  getSheetName(): string;
  isSheetHidden(): boolean;
  showSheet(): unknown;
  activate(): unknown;
  getLastRow(): number;
  getLastColumn(): number;
  getRange(
    row: number,
    column: number,
    numRows: number,
    numColumns: number,
  ): { getDisplayValue(): string };
};

/** The first stored cell that actually shows something, reading left to right. */
function sheetSummary(sheet: ListedSheet) {
  try {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    for (let row = 0; row <= lastRow; row++) {
      for (let column = 0; column <= lastColumn; column++) {
        const text = sheet
          .getRange(row, column, 1, 1)
          .getDisplayValue()
          .replace(/[\r\n]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) return text;
      }
    }
  } catch {
    return "Empty";
  }
  return "Empty";
}

/**
 * A table of contents for every worksheet, including ones hidden from the tab bar.
 * Choosing a hidden sheet shows it and leaves the other sheets visible.
 */
export default function SheetList({
  api,
  persist,
  onError,
  ref,
}: {
  ref?: Ref<{ open: () => void }>;
  api: FUniver;
  persist: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (!api.getActiveWorkbook()) return;
        setOpen(true);
      },
    }),
    [api],
  );
  const workbook = open ? api.getActiveWorkbook() : null;
  if (!workbook) return null;
  const activeId = workbook.getActiveSheet().getSheetId();
  const sheets = workbook.getSheets() as ListedSheet[];
  const choose = (sheet: ListedSheet) => {
    try {
      // Showing adds a visible sheet, so the "keep one visible" guard does not apply.
      if (sheet.isSheetHidden()) {
        sheet.showSheet();
        if (sheet.isSheetHidden())
          throw new Error(`Couldn't show ${sheet.getSheetName()}.`);
      }
      sheet.activate();
      persist();
      setOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div
      className="gdocs-modal-overlay sheet-list-overlay"
      onClick={() => setOpen(false)}
    >
      <section
        className="gdocs-dialog sheet-list-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Sheet list"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <div className="dialog-header">
          <h2>Sheet list</h2>
          <button type="button" className="dialog-text-btn" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <div className="dialog-body">
          <p className="dialog-note">
            Every worksheet, including hidden ones. The line under each name is
            the first cell with a value.
          </p>
          <ul className="sheet-list-rows">
            {sheets.map((sheet) => {
              const current = sheet.getSheetId() === activeId;
              const hidden = sheet.isSheetHidden();
              return (
                <li
                  key={sheet.getSheetId()}
                  aria-current={current ? "true" : undefined}
                >
                  <button
                    type="button"
                    autoFocus={current}
                    onClick={() => choose(sheet)}
                  >
                    <span className="sheet-list-name">{sheet.getSheetName()}</span>
                    <span className="sheet-list-summary">{sheetSummary(sheet)}</span>
                    {current || hidden ? (
                      <span className="sheet-list-marks">
                        {current ? "Current" : null}
                        {current && hidden ? " " : null}
                        {hidden ? "Hidden" : null}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
