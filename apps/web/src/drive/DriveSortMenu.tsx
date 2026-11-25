import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpNarrowWide,
  Check,
} from "lucide-react";
import {
  defaultDirFor,
  sortDescription,
  type DriveSort,
  type DriveSortBy,
  type DriveSortDir,
} from "./drive-sort";

const SORT_FIELDS: { by: DriveSortBy; label: string }[] = [
  { by: "name", label: "Name" },
  { by: "date", label: "Date" },
  { by: "size", label: "File size" },
];

const SORT_DIRECTIONS: { dir: DriveSortDir; label: string }[] = [
  { dir: "asc", label: "Ascending" },
  { dir: "desc", label: "Descending" },
];

export function DriveSortMenu({
  sort,
  onChange,
  disabled = false,
}: {
  sort: DriveSort;
  onChange: (next: DriveSort) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node | null)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const description = sortDescription(sort);

  const pickField = (by: DriveSortBy) => {
    onChange(
      by === sort.by ? sort : { by, dir: defaultDirFor(by) },
    );
    setOpen(false);
  };

  const pickDir = (dir: DriveSortDir) => {
    onChange({ ...sort, dir });
    setOpen(false);
  };

  return (
    <div className="drive-sort" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="drive-sort-trigger"
        aria-label="Sort"
        title={description}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        {sort.dir === "asc" ? (
          <ArrowUpNarrowWide size={16} aria-hidden="true" />
        ) : (
          <ArrowDownWideNarrow size={16} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="drive-sort-menu" role="menu" aria-label="Sort files">
          {SORT_FIELDS.map(({ by, label }) => (
            <button
              key={by}
              type="button"
              role="menuitemradio"
              aria-checked={sort.by === by}
              className="drive-menu-item"
              onClick={() => pickField(by)}
            >
              <span className="drive-sort-check" aria-hidden="true">
                {sort.by === by ? <Check size={14} /> : null}
              </span>
              <span>{label}</span>
            </button>
          ))}
          <hr className="drive-sort-divider" />
          {SORT_DIRECTIONS.map(({ dir, label }) => (
            <button
              key={dir}
              type="button"
              role="menuitemradio"
              aria-checked={sort.dir === dir}
              className="drive-menu-item"
              onClick={() => pickDir(dir)}
            >
              <span className="drive-sort-check" aria-hidden="true">
                {sort.dir === dir ? <Check size={14} /> : null}
              </span>
              {dir === "asc" ? (
                <ArrowUp size={14} aria-hidden="true" />
              ) : (
                <ArrowDown size={14} aria-hidden="true" />
              )}
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
