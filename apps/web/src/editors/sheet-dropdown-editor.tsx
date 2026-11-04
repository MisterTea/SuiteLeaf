import type { Dispatch, RefObject, SetStateAction } from "react";
import { X } from "lucide-react";
import { parseA1Ref, type SourceCell } from "./sheet-dropdown-source";
import { DROPDOWN_COLORS, chipTextColor, newOptionId, type DropdownOption } from "./sheet-dropdowns";

export type Draft = {
  options: DropdownOption[];
  origin: DropdownOption[];
  reject: boolean;
  multiple: boolean;
  notation: string;
  source: "list" | "range";
  rangeRef: string;
};

export function DropdownEditor({
  draft,
  setDraft,
  rangeError,
  setRangeError,
  comma,
  setComma,
  addRef,
  loadRange,
  apply,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  rangeError: string;
  setRangeError: (error: string) => void;
  comma: boolean;
  setComma: (comma: boolean) => void;
  addRef: RefObject<HTMLInputElement | null>;
  loadRange: (
    rangeRef: string,
    donors: DropdownOption[],
  ) => { options: DropdownOption[]; error: string; sources: SourceCell[] };
  apply: () => void;
}) {
  return (
    <aside
      className="dropdown-panel"
      role="dialog"
      aria-label="Dropdown"
      onKeyDown={(event) => {
        if (event.key === "Escape") setDraft(null);
      }}
    >
      <header>
        <h2>Dropdown</h2>
        <button type="button" aria-label="Close" onClick={() => setDraft(null)}>
          <X size={18} />
        </button>
      </header>
      <p className="dropdown-range">{draft.notation || "Selected cells"}</p>
      <div className="dropdown-source" role="radiogroup" aria-label="Option source">
        <label>
          <input
            type="radio"
            name="dropdown-source"
            checked={draft.source === "list"}
            onChange={() => {
              setRangeError("");
              setDraft({ ...draft, source: "list" });
            }}
          />
          List
        </label>
        <label>
          <input
            type="radio"
            name="dropdown-source"
            checked={draft.source === "range"}
            onChange={() => {
              const loaded = draft.rangeRef
                ? loadRange(draft.rangeRef, draft.options)
                : { options: draft.options, error: "" };
              setRangeError(loaded.error);
              setDraft({
                ...draft,
                source: "range",
                options: loaded.options.length ? loaded.options : draft.options,
              });
            }}
          />
          From a range
        </label>
      </div>
      {draft.source === "range" ? (
        <label className="dropdown-range-field">
          Source range
          <input
            aria-label="Source range"
            value={draft.rangeRef}
            placeholder="Statuses!A2:A5"
            aria-invalid={rangeError ? true : undefined}
            onChange={(event) => {
              const rangeRef = event.target.value;
              const parsed = parseA1Ref(rangeRef);
              if (!parsed || !rangeRef.includes(":")) {
                setRangeError("");
                setDraft({ ...draft, rangeRef });
                return;
              }
              const loaded = loadRange(rangeRef, draft.options);
              setRangeError(loaded.error);
              setDraft({
                ...draft,
                rangeRef,
                options: loaded.options.length ? loaded.options : draft.options,
              });
            }}
          />
        </label>
      ) : null}
      <p className="dropdown-lead">
        {draft.source === "range"
          ? "These are the cells in that range. A blank is skipped, and a colour stays with the name when you rename a cell."
          : "Options from this selection, with spaces and capitalization tidied."}
      </p>
      <ul className="dropdown-options">
        {draft.options.map((option, index) => (
          <li key={option.id}>
            <span
              className="dropdown-chip"
              style={{
                background: option.color,
                color: chipTextColor(option.color),
              }}
            >
              {option.label.trim() || "Option"}
            </span>
            {draft.source === "list" ? (
              <input
                ref={index === draft.options.length - 1 ? addRef : undefined}
                aria-label={`Option ${index + 1}`}
                value={option.label}
                onChange={(event) => {
                  const label = event.target.value;
                  setDraft({
                    ...draft,
                    options: draft.options.map((item) =>
                      item.id === option.id ? { ...item, label } : item,
                    ),
                  });
                  setComma(false);
                }}
              />
            ) : (
              <span />
            )}
            {draft.source === "list" ? (
              <button
                type="button"
                aria-label={`Remove ${option.label || "option"}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    options: draft.options.filter((item) => item.id !== option.id),
                  })
                }
              >
                <X size={14} />
              </button>
            ) : null}
            <div className="dropdown-swatches" role="group" aria-label={`Color for ${option.label || "option"}`}>
              {DROPDOWN_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={color.value === option.color ? "selected" : ""}
                  style={{ background: color.value }}
                  aria-label={color.name}
                  aria-pressed={color.value === option.color}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      options: draft.options.map((item) =>
                        item.id === option.id ? { ...item, color: color.value } : item,
                      ),
                    })
                  }
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {draft.source === "list" ? (
        <button
          type="button"
          className="dropdown-add"
          onClick={() => {
            setDraft({
              ...draft,
              options: [
                ...draft.options,
                {
                  id: newOptionId(),
                  label: "",
                  color:
                    DROPDOWN_COLORS[draft.options.length % DROPDOWN_COLORS.length].value,
                },
              ],
            });
            requestAnimationFrame(() => addRef.current?.focus());
          }}
        >
          Add option
        </button>
      ) : null}
      <label className="dropdown-reject">
        <input
          type="checkbox"
          checked={draft.multiple}
          onChange={(event) => setDraft({ ...draft, multiple: event.target.checked })}
        />
        Allow more than one
      </label>
      <label className="dropdown-reject">
        <input
          type="checkbox"
          checked={draft.reject}
          onChange={(event) => setDraft({ ...draft, reject: event.target.checked })}
        />
        Reject other values
      </label>
      <p className="dropdown-help">
        {draft.multiple
          ? "Enter adds a choice and leaves the list open. Escape closes it."
          : draft.reject
            ? "Anything else is refused, and the message names these options."
            : "Anything else is kept and marked, with a warning that names these options."}
      </p>
      {comma && draft.source === "list" ? (
        <p className="dropdown-error" role="alert">
          Options can't include a comma. Excel's list splits on commas.
        </p>
      ) : null}
      {rangeError && draft.source === "range" ? (
        <p className="dropdown-error" role="alert">
          {rangeError}
        </p>
      ) : null}
      <button
        type="button"
        className="primary"
        onClick={apply}
        disabled={
          draft.source === "range"
            ? !draft.rangeRef.trim() || !draft.options.some((option) => option.label.trim())
            : !draft.options.some((option) => option.label.trim())
        }
      >
        Done
      </button>
    </aside>
  );
}
