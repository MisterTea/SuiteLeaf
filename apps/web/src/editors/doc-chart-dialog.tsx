import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { X } from "lucide-react";
import { storage } from "../storage";
import { spreadsheetChoices } from "./mail-merge";
import { chartFromSheet, sheetFromLibrary } from "./doc-chart";
import { insertLinkedChart } from "./doc-linked-chart";
import "./mail-merge.css";

function problem(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not read that spreadsheet.";
}

/** Pick a spreadsheet on this computer and chart its first sheet at the caret. */
export function InsertChartDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [sheets, setSheets] = useState<{ id: string; title: string }[] | null>(
    null,
  );
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const [inserting, setInserting] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const choices = spreadsheetChoices(await storage.list());
        if (!cancel) setSheets(choices);
      } catch (reason) {
        if (cancel) return;
        setSheets([]);
        setError(problem(reason));
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const insert = async () => {
    const chosen = sheets?.find((row) => row.id === pick);
    if (!chosen || inserting) return;
    setInserting(true);
    setError("");
    try {
      const sheet = sheetFromLibrary(await storage.get(chosen.id));
      if (!sheet) {
        setError("That spreadsheet is no longer in this library.");
        setInserting(false);
        return;
      }
      const chart = chartFromSheet(sheet);
      if (!chart.ok) {
        setError(chart.error);
        setInserting(false);
        return;
      }
      const placed = insertLinkedChart(editor, {
        sourceId: sheet.id,
        sourceTitle: sheet.title,
        labels: chart.labels,
        values: chart.values,
        missing: false,
      });
      if (!placed) {
        setError("The chart cannot go there.");
        setInserting(false);
        return;
      }
      onClose();
    } catch (reason) {
      setError(problem(reason));
      setInserting(false);
    }
  };

  return (
    <div
      className="gdocs-modal-overlay page-setup-overlay"
      onMouseDown={onClose}
    >
      <div
        className="gdocs-dialog"
        role="dialog"
        aria-label="Insert chart"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="dialog-header">
          <h2>Insert chart</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <p className="merge-note">
            Each row of the first sheet becomes a bar. The spreadsheet does not
            need a chart of its own.
          </p>
          {sheets === null ? (
            <p className="merge-empty">Looking for spreadsheets…</p>
          ) : sheets.length === 0 ? (
            <p className="merge-empty">
              There are no spreadsheets in this library.
            </p>
          ) : (
            <fieldset className="merge-sheets">
              <legend>Spreadsheets</legend>
              <div
                className="merge-sheet-list"
                role="radiogroup"
                aria-label="Spreadsheets"
              >
                {sheets.map((sheet) => (
                  <label key={sheet.id}>
                    <input
                      type="radio"
                      name="chart-spreadsheet"
                      value={sheet.id}
                      checked={pick === sheet.id}
                      onChange={() => {
                        setPick(sheet.id);
                        setError("");
                      }}
                    />
                    <span className="merge-sheet-text">
                      <span className="merge-sheet-title">{sheet.title}</span>
                      <span className="merge-sheet-place">On this computer</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error ? (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="dialog-primary-btn"
            disabled={!pick || inserting || sheets === null}
            onClick={() => void insert()}
          >
            {inserting ? "Inserting…" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}
