import { X } from "lucide-react";
import type { SuiteFile } from "@suiteleaf/core";

function isImportFeature(warning: string): boolean {
  return (
    /^\d+ (?:footnote|endnote|table|citation|bibliography)/.test(warning) ||
    /^\d+ comment threads? imported$/.test(warning) ||
    /^\d+ suggestions? imported$/.test(warning) ||
    /^Letterhead: /.test(warning)
  );
}
function importFeatureLine(warnings: string[]): string {
  return warnings.filter(isImportFeature).join(" · ");
}
function importCompatibilityNotes(warnings: string[]): string[] {
  return warnings.filter((warning) => !isImportFeature(warning));
}
export function ImportNotes({
  info,
  onClose,
}: {
  info: NonNullable<SuiteFile["importInfo"]>;
  onClose: () => void;
}) {
  return (
    <div className="import-notes" role="region" aria-label="Import notes">
    <details>
      <summary>
        Imported {info.sourceFormat.toUpperCase()}:{" "}
        {info.sourceName}
        {importFeatureLine(info.warnings)
          ? ` · ${importFeatureLine(info.warnings)}`
          : ""}
        {importCompatibilityNotes(info.warnings).length
          ? ` · ${importCompatibilityNotes(info.warnings).length} compatibility ${importCompatibilityNotes(info.warnings).length === 1 ? "note" : "notes"}`
          : ""}
      </summary>
      {importCompatibilityNotes(info.warnings).length ? (
        <ul>
          {importCompatibilityNotes(info.warnings).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : (
        <p>
          Supported content was imported into an editable SuiteLeaf copy.
        </p>
      )}
    </details>
    <button
      type="button"
      className="import-notes-close"
      aria-label="Close import notes"
      title="Close import notes"
      onClick={onClose}
    >
      <X size={14} />
    </button>
    </div>
  );
}
