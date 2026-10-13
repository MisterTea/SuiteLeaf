import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { CellValue } from "../analysis";
import {
  detectHeaderRow,
  rangeSpan,
  sortColumnLabels,
  type GridRange,
  type SortRule,
} from "../sort-range";

/** Data › Sort range: Sheets' "Advanced range sorting options" dialog. */
export default function SortRangeDialog({
  range,
  values,
  onSort,
  onClose,
}: {
  range: GridRange;
  values: CellValue[][];
  onSort: (rules: SortRule[], hasHeader: boolean) => void;
  onClose: () => void;
}) {
  const [hasHeader, setHasHeader] = useState(() => detectHeaderRow(values));
  const [rules, setRules] = useState<SortRule[]>([
    { column: 0, ascending: true },
  ]);
  const labels = sortColumnLabels(values, range, hasHeader);
  const span = rangeSpan(range);
  const update = (i: number, change: Partial<SortRule>) =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSort(rules, hasHeader);
  };
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // The menu that opened the dialog hands focus back to its trigger as it closes.
    const keep = (e: FocusEvent) => {
      if (!form.current?.contains(e.target as Node))
        form.current?.querySelector<HTMLElement>("[type=submit]")?.focus();
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("focusin", keep);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("focusin", keep);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        ref={form}
        className="gdocs-dialog sort-range-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Sort range from ${span}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="dialog-header">
          <h2>Sort range from {span}</h2>
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
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
            />
            Data has header row
          </label>
          {rules.map((rule, i) => (
            <div className="sort-rule" key={i}>
              <label>
                <span>{i ? "then by" : "Sort by"}</span>
                <select
                  value={rule.column}
                  onChange={(e) => update(i, { column: +e.target.value })}
                >
                  {labels.map((label, c) => (
                    <option key={c} value={c}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="sort-order"
                role="radiogroup"
                aria-label={`${i ? "Then by" : "Sort"} order`}
              >
                {[true, false].map((ascending) => (
                  <label key={String(ascending)}>
                    <input
                      type="radio"
                      name={`sort-order-${i}`}
                      checked={rule.ascending === ascending}
                      onChange={() => update(i, { ascending })}
                    />
                    {ascending ? "A → Z" : "Z → A"}
                  </label>
                ))}
              </div>
              {i ? (
                <button
                  type="button"
                  className="dialog-close-btn"
                  aria-label={`Remove sort column ${i + 1}`}
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
          ))}
          {rules.length < labels.length ? (
            <button
              type="button"
              className="dialog-text-btn sort-add-rule"
              onClick={() =>
                setRules([
                  ...rules,
                  {
                    column: labels.findIndex(
                      (_, c) => !rules.some((r) => r.column === c),
                    ),
                    ascending: true,
                  },
                ])
              }
            >
              <Plus size={14} /> Add another sort column
            </button>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn" autoFocus>
            Sort
          </button>
        </div>
      </form>
    </div>
  );
}
