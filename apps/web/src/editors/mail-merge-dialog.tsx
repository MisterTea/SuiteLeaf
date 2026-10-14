import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  createFile,
  parseFile,
  type DocFile,
  type JsonNode,
} from "@suiteleaf/core";
import { drive, getSession } from "../node-client";
import { storage } from "../storage";
import {
  mergeLetters,
  mergeSheetChoices,
  mergedDocumentTitle,
  missingColumnMessage,
  sheetTable,
  spreadsheetChoices,
  type MergeSheet,
} from "./mail-merge";
import "./mail-merge.css";

function problem(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not merge those letters.";
}

async function workbookOf(sheet: MergeSheet) {
  if (sheet.source === "library") {
    const record = await storage.get(sheet.id);
    if (
      !record ||
      record.file.kind !== "sheet" ||
      record.drive ||
      record.trashedAt
    ) {
      throw new Error("That spreadsheet is no longer in this library.");
    }
    return record.file.content.workbook;
  }
  const { text } = await drive.read(sheet.id);
  const file = parseFile(text, "sheet");
  if (file.kind !== "sheet") throw new Error("That file is not a spreadsheet.");
  return file.content.workbook;
}

/** Pick a spreadsheet on this computer or in SuiteDrive and write one letter per row. */
export function MailMergeDialog({
  template,
  sourceTitle,
  onClose,
  onCreate,
}: {
  template: () => JsonNode;
  sourceTitle: string;
  onClose: () => void;
  onCreate: (file: DocFile) => Promise<void>;
}) {
  const [sheets, setSheets] = useState<MergeSheet[] | null>(null);
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      let local: { id: string; title: string }[] = [];
      let remote: { id: string; name: string; parentName: string }[] = [];
      let note = "";
      try {
        local = spreadsheetChoices(await storage.list());
      } catch (reason) {
        note = problem(reason);
      }
      if (getSession()) {
        try {
          remote = await drive.spreadsheets();
        } catch (reason) {
          if (!note) note = problem(reason);
        }
      }
      if (cancel) return;
      setSheets(mergeSheetChoices(local, remote));
      if (note) setError(note);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const merge = async () => {
    const sheet = sheets?.find((row) => row.key === pick);
    if (!sheet || merging) return;
    setMerging(true);
    setError("");
    try {
      const table = sheetTable(await workbookOf(sheet));
      const result = mergeLetters(template(), table.headers, table.rows);
      if (!result.ok) {
        setError(missingColumnMessage(result.missing));
        setMerging(false);
        return;
      }
      const created = createFile(
        "doc",
        mergedDocumentTitle(sourceTitle),
      ) as DocFile;
      created.content = result.content;
      await onCreate(created);
      onClose();
    } catch (reason) {
      setError(problem(reason));
      setMerging(false);
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
        aria-label="Merge from a spreadsheet"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="dialog-header">
          <h2>Merge from a spreadsheet</h2>
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
            Each row becomes a letter on its own page. Nothing is emailed.
          </p>
          {sheets === null ? (
            <p className="merge-empty">Looking for spreadsheets…</p>
          ) : sheets.length === 0 ? (
            <p className="merge-empty">
              There are no spreadsheets to merge from.
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
                  <label key={sheet.key}>
                    <input
                      type="radio"
                      name="merge-spreadsheet"
                      value={sheet.key}
                      checked={pick === sheet.key}
                      onChange={() => {
                        setPick(sheet.key);
                        setError("");
                      }}
                    />
                    <span className="merge-sheet-text">
                      <span className="merge-sheet-title">{sheet.title}</span>
                      <span className="merge-sheet-place">{sheet.place}</span>
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
            disabled={!pick || merging || sheets === null}
            onClick={() => void merge()}
          >
            {merging ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
