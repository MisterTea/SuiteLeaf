import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  defaultDelimitedOptions,
  delimitedCellReader,
  delimiterLabel,
  delimiters,
  identifierColumns,
  parseDelimited,
  type DelimitedOptions,
} from "./csv";
import { maxDelimitedCells, type DelimitedDraft } from "./imports";

const previewRows = 6,
  previewColumns = 20;
const columnLetter = (i: number): string =>
  (i >= 26 ? columnLetter(Math.floor(i / 26) - 1) : "") +
  String.fromCharCode(65 + (i % 26));
const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** Review a CSV/TSV import: separator, header row, and how values are typed. */
export function CsvImportDialog({
  draft,
  onDone,
}: {
  draft: DelimitedDraft;
  onDone: (options: DelimitedOptions | null) => void;
}) {
  const [options, setOptions] = useState(() =>
    defaultDelimitedOptions(draft.rows, draft.delimiter),
  );
  const set = (patch: Partial<DelimitedOptions>) =>
    setOptions((o) => ({ ...o, ...patch }));
  const parsed = useMemo(
    () =>
      options.delimiter === draft.delimiter
        ? draft
        : parseDelimited(draft.text, options.delimiter),
    [draft, options.delimiter],
  );
  const rows = parsed.rows;
  const columns = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const body = options.header ? rows.slice(1) : rows;
  const names = Array.from({ length: columns }, (_, c) =>
    options.header && rows[0]?.[c]?.trim() ? rows[0][c] : columnLetter(c),
  );
  const read = useMemo(
    () => delimitedCellReader(rows, options),
    [rows, options],
  );
  const codes = useMemo(
    () => [...identifierColumns(rows, options.header)].sort((a, b) => a - b),
    [rows, options.header],
  );
  const kinds = useMemo(
    () =>
      Array.from({ length: Math.min(columns, previewColumns) }, (_, c) => {
        const types = new Set<number>();
        rows.forEach((r, i) => {
          if (options.header && i === 0) return;
          if (r[c]) types.add(read(r[c], i, c).t);
        });
        return types.size > 1
          ? "Mixed"
          : types.has(2)
            ? "Number"
            : types.has(3)
              ? "TRUE/FALSE"
              : "Text";
      }),
    [rows, columns, read, options.header],
  );
  const error =
    "error" in parsed && parsed.error
      ? `This separator does not fit the file: ${parsed.error}`
      : !body.length
        ? "There are no data rows to import."
        : rows.length * columns > maxDelimitedCells
          ? "Imports are limited to 200,000 cells."
          : "";
  const shown = Math.min(columns, previewColumns);
  const separators = delimiters.some((d) => d.value === draft.delimiter)
    ? delimiters
    : [...delimiters, { value: draft.delimiter, label: "Other" }];
  const codeNames = new Intl.ListFormat("en", { type: "conjunction" }).format(
    codes.map((c) => names[c]),
  );
  const formulas = useMemo(
    () => rows.some((r) => r.some((v) => v.startsWith("="))),
    [rows],
  );

  return (
    <div className="modal-overlay" onClick={() => onDone(null)}>
      <section
        className="gdocs-dialog csv-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-import-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onDone(null)}
      >
        <div className="dialog-header">
          <h2 id="csv-import-title">Import {draft.name}</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Cancel import"
            onClick={() => onDone(null)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="csv-import-options">
          <label className="csv-import-separator">
            Separator
            <select
              value={options.delimiter}
              onChange={(e) => set({ delimiter: e.target.value })}
            >
              {separators.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                  {d.value === draft.delimiter ? " (detected)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={options.header}
              onChange={(e) => set({ header: e.target.checked })}
            />
            First row is a header
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={options.convert}
              onChange={(e) => set({ convert: e.target.checked })}
            />
            Convert text to numbers and TRUE/FALSE
          </label>
          {options.convert && codes.length ? (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={options.keepIdentifiers}
                onChange={(e) => set({ keepIdentifiers: e.target.checked })}
              />
              <span>
                Keep code columns as text
                <small>
                  {codeNames} {codes.length === 1 ? "has" : "have"}{" "}
                  codes with leading zeros, so every value in{" "}
                  {codes.length === 1 ? "it" : "them"} stays text.
                </small>
              </span>
            </label>
          ) : null}
        </div>
        <p className="csv-import-summary" role="status">
          {plural(body.length, "data row")} · {plural(columns, "column")} ·{" "}
          {delimiterLabel(options.delimiter).toLowerCase()}-separated
          {options.header ? ", plus a header row" : ""}
        </p>
        <div className="csv-import-preview">
          <table aria-label="Import preview">
            <thead>
              <tr>
                {names.slice(0, shown).map((name, c) => (
                  <th key={c} scope="col">
                    <span>{name}</span>
                    <small>{kinds[c]}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.slice(0, previewRows).map((r, i) => (
                <tr key={i}>
                  {Array.from({ length: shown }, (_, c) => {
                    const value = r[c] ?? "";
                    const cell = read(value, i + (options.header ? 1 : 0), c);
                    return (
                      <td key={c} className={cell.t === 2 ? "number" : ""}>
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {body.length > previewRows || columns > shown ? (
          <p className="csv-import-note">
            Showing the first {Math.min(body.length, previewRows)} rows
            {columns > shown ? ` and ${shown} columns` : ""}.
          </p>
        ) : null}
        {formulas ? (
          <p className="csv-import-note">
            Formulas are not run: text that starts with = stays text.
          </p>
        ) : null}
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-text-btn"
            onClick={() => onDone(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dialog-primary-btn"
            autoFocus
            disabled={!!error}
            onClick={() => onDone(options)}
          >
            Import
          </button>
        </div>
      </section>
    </div>
  );
}
