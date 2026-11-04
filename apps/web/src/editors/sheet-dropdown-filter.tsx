import { chipTextColor, filteredOptions, type DropdownOption } from "./sheet-dropdowns";

export type Filter = {
  query: string;
  index: number;
  row: number;
  column: number;
  options: DropdownOption[];
  reject: boolean;
  multiple: boolean;
  message: string;
  x: number;
  y: number;
};

export function DropdownFilterList({
  filter,
  setFilterLive,
  choose,
}: {
  filter: Filter;
  setFilterLive: (next: Filter | null) => void;
  choose: (row: number, column: number, option: DropdownOption, multiple?: boolean) => Promise<void>;
}) {
  const visible = filteredOptions(filter.options, filter.query);
  return (
    <div
      className="dropdown-filter"
      role="listbox"
      aria-label="Dropdown options"
      style={{ left: filter.x, top: filter.y }}
    >
      <p>
        {filter.query
          ? `Matching “${filter.query.trim()}”`
          : filter.multiple
            ? "Enter adds one. Escape closes the list."
            : "Options"}
      </p>
      {visible.length ? (
        visible.map((option, index) => {
          const needle = filter.query.trim().toLowerCase();
          const at = option.label.toLowerCase().indexOf(needle);
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={index === filter.index}
              className={index === filter.index ? "active" : ""}
              onMouseEnter={() => setFilterLive({ ...filter, index })}
              onClick={() => void choose(filter.row, filter.column, option, filter.multiple)}
            >
              <span
                className="dropdown-chip"
                style={{
                  background: option.color,
                  color: chipTextColor(option.color),
                }}
              >
                {needle && at >= 0 ? (
                  <>
                    {option.label.slice(0, at)}
                    <strong>{option.label.slice(at, at + needle.length)}</strong>
                    {option.label.slice(at + needle.length)}
                  </>
                ) : (
                  option.label
                )}
              </span>
            </button>
          );
        })
      ) : (
        <p className="dropdown-empty">No option matches. Enter refuses it.</p>
      )}
    </div>
  );
}
