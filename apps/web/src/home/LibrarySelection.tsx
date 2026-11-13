import { Download, FolderInput, Link2, Trash2, X } from "lucide-react";
import { mimeFor, nativeFilename, serializeFile, type FileRecord } from "@suiteleaf/core";
import { exportBinary, exportText } from "../storage";

export function SelectionCheckbox({
  label, checked, mixed = false, onChange, disabled,
}: {
  label: string;
  checked: boolean;
  mixed?: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <input
      className="library-selection-checkbox"
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(input) => { if (input) input.indeterminate = mixed; }}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

export function LibrarySelectionBar({
  count, busy, onClear, onDownload, onMove, onTrash, onCopyLinks,
}: {
  count: number;
  busy: boolean;
  onClear: () => void;
  onDownload: () => void;
  onMove?: () => void;
  onTrash: () => void;
  onCopyLinks: () => void;
}) {
  return (
    <div className="library-selection-bar" role="group" aria-label="Selection actions">
      <button type="button" title="Clear selection" aria-label="Clear selection" disabled={busy} onClick={onClear}>
        <X size={18} aria-hidden="true" />
      </button>
      <span role="status">{count} selected</span>
      <button type="button" title="Download selection" aria-label="Download selection" disabled={busy} onClick={onDownload}>
        <Download size={18} aria-hidden="true" />
      </button>
      {onMove ? (
        <button type="button" title="Move selection" aria-label="Move selection" disabled={busy} onClick={onMove}>
          <FolderInput size={18} aria-hidden="true" />
        </button>
      ) : null}
      <button type="button" title="Move selection to Trash" aria-label="Move selection to Trash" disabled={busy} onClick={onTrash}>
        <Trash2 size={18} aria-hidden="true" />
      </button>
      <button type="button" title="Copy links to selection" aria-label="Copy links to selection" disabled={busy} onClick={onCopyLinks}>
        <Link2 size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export async function downloadLibrarySelection(records: FileRecord[]) {
  if (records.length === 1) {
    const { file } = records[0];
    await exportText(nativeFilename(file), serializeFile(file), mimeFor(file.kind));
    return;
  }
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Set<string>();
  for (const { file } of records) {
    const original = nativeFilename(file);
    const dot = original.lastIndexOf(".");
    let name = original;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      name = `${original.slice(0, dot)} (${i})${original.slice(dot)}`;
    }
    used.add(name.toLowerCase());
    zip.file(name, serializeFile(file));
  }
  await exportBinary("SuiteDrive selection.zip", await zip.generateAsync({ type: "uint8array" }), "application/zip");
}
