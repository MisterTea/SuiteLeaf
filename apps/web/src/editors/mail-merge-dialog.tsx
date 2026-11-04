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
  letterTitle,
  mergeBatch,
  mergePdfBatch,
  mergeLocale,
  mergeIssueText,
  mergeSheetChoices,
  nameColumn,
  sheetTable,
  spreadsheetChoices,
  type MergeSheet,
} from "./mail-merge";
import { readProofing } from "./doc-word-count";
import { addressFromRow, placeEnvelope, placeLabels, type PlacedAddress } from "./mail-labels";
import { EnvelopePreview, LabelSheetPreview } from "./mail-label-preview";
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
  onCreate: (files: DocFile[]) => Promise<void>;
}) {
  const [sheets, setSheets] = useState<MergeSheet[] | null>(null);
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const [merging, setMerging] = useState(false);
  const [output, setOutput] = useState<"letters" | "labels" | "envelopes" | "pdf">("letters");
  const [pdfNote, setPdfNote] = useState("");
  const [labels, setLabels] = useState<PlacedAddress[] | null>(null);
  const [envelope, setEnvelope] = useState<{ returnAddress: PlacedAddress; recipient: PlacedAddress } | null>(
    null,
  );

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
      const addresses = table.rows
        .filter((row) => row.some((cell) => cell.trim() !== ""))
        .map((row) => addressFromRow(table.headers, row));
      if (output === "labels") {
        const placed = placeLabels(addresses);
        if (!placed.ok) {
          setError(placed.message);
          setLabels(null);
        } else {
          setLabels(placed.placed);
          setEnvelope(null);
        }
        setMerging(false);
        return;
      }
      if (output === "pdf") {
        const batch = mergePdfBatch(
          template(),
          table.headers,
          table.rows,
          nameColumn(table.headers),
          mergeLocale(readProofing(template()).language),
        );
        if (!batch.ok) {
          setError(mergeIssueText(batch.issues));
          setPdfNote("");
          setMerging(false);
          return;
        }
        if (!batch.files.length) {
          setError("That spreadsheet has no rows to merge.");
          setPdfNote("");
          setMerging(false);
          return;
        }
        let saved = true;
        try {
          for (const file of batch.files) {
            const pdf = new ArrayBuffer(file.pdf.byteLength);
            new Uint8Array(pdf).set(file.pdf);
            const blob = new Blob([pdf], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${file.name}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
          }
        } catch {
          saved = false;
        }
        const names = batch.files.map((file) => `${file.name}.pdf`).join(" and ");
        setPdfNote(
          saved
            ? `Prepared ${names}. Nothing is mailed. This is not a print of the page.`
            : `Prepared ${names}. They were not saved. Nothing is mailed. This is not a print of the page.`,
        );
        setLabels(null);
        setEnvelope(null);
        setMerging(false);
        return;
      }
      if (output === "envelopes") {
        const placed = placeEnvelope([sourceTitle], addresses[0] ?? []);
        if (!placed.ok) {
          setError(placed.message);
          setEnvelope(null);
        } else {
          setEnvelope({ returnAddress: placed.returnAddress, recipient: placed.recipient });
          setLabels(null);
        }
        setMerging(false);
        return;
      }
      const batch = mergeBatch(
        template(),
        table.headers,
        table.rows,
        nameColumn(table.headers),
        mergeLocale(readProofing(template()).language),
      );
      if (!batch.ok) {
        setError(mergeIssueText(batch.issues));
        setMerging(false);
        return;
      }
      if (!batch.letters.length) {
        setError("That spreadsheet has no rows to merge.");
        setMerging(false);
        return;
      }
      const created = batch.letters.map((letter) => {
        const file = createFile("doc", letterTitle(sourceTitle, letter.name)) as DocFile;
        file.content = letter.content;
        return file;
      });
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
            Each row becomes its own document, named from a Name column when there is one. Nothing is emailed.
            {" {{#Plot}}...{{/Plot}}"} is kept only when Plot has text. {"{{#Plot == North}}...{{/Plot}}"} is kept when Plot is North. {"{{#each Crop}}{{.}}{{/each}}"} repeats
            each part of Crop, separated by semicolons. A blank part is skipped.
          </p>
          <fieldset className="merge-sheets">
            <legend>Output</legend>
            <div className="merge-sheet-list" role="radiogroup" aria-label="Output">
              {(
                [
                  ["letters", "Letters"],
                  ["pdf", "PDF"],
                  ["labels", "Labels"],
                  ["envelopes", "Envelopes"],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="merge-output"
                    value={value}
                    checked={output === value}
                    onChange={() => {
                      setOutput(value);
                      setLabels(null);
                      setEnvelope(null);
                      setPdfNote("");
                      setError("");
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
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
          {pdfNote ? (
            <p className="merge-note" role="status">
              {pdfNote}
            </p>
          ) : null}
          {labels ? <LabelSheetPreview placed={labels} /> : null}
          {envelope ? (
            <EnvelopePreview returnAddress={envelope.returnAddress} recipient={envelope.recipient} />
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
            {merging
              ? "Merging…"
              : output === "labels"
                ? "Place on labels"
                : output === "envelopes"
                  ? "Place on envelope"
                  : output === "pdf"
                    ? "Write PDFs"
                    : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
