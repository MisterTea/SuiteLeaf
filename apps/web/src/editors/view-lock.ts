/**
 * Viewers and commenters can look at a spreadsheet, but cell edits never start.
 * Filter views and (for commenters) comment replies stay available, and neither
 * is written back: the workspace already ignores onChange when the role cannot edit.
 */

export type SheetAccess = "edit" | "view" | "comment";

const BLOCKED_COMMAND = [
  "set-cell-edit-visible",
  "set-range-values",
  "set-range-bold",
  "set-range-italic",
  "set-range-stroke",
  "clear-selection",
  "set-style",
  "numfmt",
  "set-bold",
  "set-italic",
  "set-underline",
  "set-strike",
  "strikethrough",
  "set-font",
  "set-text-color",
  "set-background",
  "background-color",
  "set-border",
  "text-wrap",
  "text-align",
  "merge",
  "insert-row",
  "insert-col",
  "remove-row",
  "remove-col",
  "delete-range",
  "move-range",
  "move-rows",
  "move-cols",
  "auto-fill",
  "paste",
  "cut",
  ".undo",
  ".redo",
  "set-frozen",
  "sort",
  "split-text",
  "insert-sheet",
  "remove-sheet",
  "set-worksheet-name",
  "copy-sheet",
  "data-validation",
  "conditional",
  "checkbox",
  "set-col-width",
  "set-row-height",
  "drawing",
];

const COMMENT_WRITE = /add-comment|update-comment|delete-comment|resolve-comment/;

/** True when this Univer command would change the grid and must be cancelled. */
export function blocksSheetEdit(id: string, access: SheetAccess): boolean {
  if (access === "edit") return false;
  if (id.includes("filter")) return false;
  if (/set-(specific-)?row(s)?-(hidden|visible)/.test(id)) return false;
  if (COMMENT_WRITE.test(id)) return access !== "comment";
  return BLOCKED_COMMAND.some((marker) => id.includes(marker));
}

export interface FilterViewChoice {
  column: number;
  header: string;
  value: string;
  /** Menu label, e.g. "Bed: North". */
  label: string;
}

/**
 * The column a viewer can filter in one click: a short list of repeated labels,
 * such as North / South, rather than a column of unique names.
 */
export function filterViewChoices(rows: string[][]): FilterViewChoice[] {
  if (rows.length < 3) return [];
  const headers = rows[0].map((cell) => cell.trim());
  const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim()));
  let best: { column: number; values: string[]; score: number } | null = null;
  for (let column = 0; column < headers.length; column++) {
    const header = headers[column];
    if (!header) continue;
    const values = body
      .map((row) => (row[column] ?? "").trim())
      .filter(Boolean);
    const unique = [...new Set(values)];
    if (unique.length < 2 || unique.length > 8) continue;
    if (values.length <= unique.length) continue;
    const score = unique.length * 100 - (values.length - unique.length);
    if (!best || score < best.score)
      best = { column, values: unique, score };
  }
  if (!best) return [];
  const chosen = best;
  const header = headers[chosen.column];
  return chosen.values.map((value) => ({
    column: chosen.column,
    header,
    value,
    label: `${header}: ${value}`,
  }));
}

/** Univer filter criteria that keeps rows whose cell equals `value`. */
export function valueFilterCriteria(
  column: number,
  startColumn: number,
  value: string,
) {
  return {
    column,
    criteria: {
      colId: column - startColumn,
      filters: { filters: [value] },
    },
  };
}

const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Tab",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Escape",
  "Enter",
]);

export interface SheetKeyTarget {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  kind: "key" | "paste" | "cut" | "drop" | "beforeinput";
  inNameBox: boolean;
  inFilter: boolean;
  inComment: boolean;
  inSheet: boolean;
  inOutsideField: boolean;
  inMenu: boolean;
  access: "view" | "comment";
}

/** True when the event would type, paste, or delete in the grid or formula bar. */
export function swallowsSheetEdit(input: SheetKeyTarget): boolean {
  if (input.inNameBox || input.inFilter || input.inMenu) return false;
  if (input.access === "comment" && input.inComment) return false;
  if (input.inOutsideField) return false;
  if (!input.inSheet) return false;
  if (input.kind !== "key") return true;
  if (input.meta || input.ctrl) {
    const key = input.key.toLowerCase();
    if (key === "c" || key === "a" || key === "p" || key === "f" || key === "enter")
      return false;
    return true;
  }
  if (input.alt) return false;
  if (NAV_KEYS.has(input.key)) return false;
  return (
    input.key.length === 1 ||
    input.key === "Delete" ||
    input.key === "Backspace" ||
    input.key === "F2"
  );
}

function targetElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/** Capture-phase guard so a keystroke never opens the cell editor. */
export function attachSheetViewLock(
  locked: () => boolean,
  access: () => SheetAccess,
) {
  let commentFocus = false;
  const onPointer = (event: Event) => {
    const el = targetElement(event.target);
    commentFocus = !!el?.closest("[aria-label='Sidebar panel'], [class*='thread-comment']");
  };
  const onEvent = (event: Event) => {
    if (!locked() || access() === "edit") return;
    if (access() === "comment" && commentFocus) return;
    const el = targetElement(event.target);
    // Comment reply editors are small canvases. The grid canvas is much taller.
    if (
      access() === "comment" &&
      el instanceof HTMLCanvasElement &&
      el.height > 0 &&
      el.height < 160
    )
      return;
    const field = el?.closest("input, textarea, select, [contenteditable='true']");
    const kind: SheetKeyTarget["kind"] =
      event.type === "paste"
        ? "paste"
        : event.type === "cut"
          ? "cut"
          : event.type === "drop"
            ? "drop"
            : event.type === "beforeinput"
              ? "beforeinput"
              : "key";
    const keyEvent = event instanceof KeyboardEvent ? event : null;
    if (
      !swallowsSheetEdit({
        key: keyEvent?.key ?? "",
        meta: !!keyEvent?.metaKey,
        ctrl: !!keyEvent?.ctrlKey,
        alt: !!keyEvent?.altKey,
        kind,
        inNameBox: !!el?.closest("[data-u-comp='defined-name']"),
        inFilter: !!el?.closest(
          "[data-u-comp='sheets-filter-panel'], .filter-view-bar",
        ),
        inComment: !!el?.closest(
          "[class*='thread-comment'], [aria-label='Sidebar panel']",
        ),
        inSheet: !!el?.closest(".sheet-host"),
        inOutsideField: !!field && !field.closest(".sheet-host"),
        inMenu: !!el?.closest("[role='menu'], .menu-content"),
        access: access() === "comment" ? "comment" : "view",
      })
    )
      return;
    event.preventDefault();
    event.stopPropagation();
  };
  const types = ["keydown", "beforeinput", "paste", "cut", "drop"] as const;
  for (const type of types) window.addEventListener(type, onEvent, true);
  window.addEventListener("pointerdown", onPointer, true);
  return () => {
    for (const type of types) window.removeEventListener(type, onEvent, true);
    window.removeEventListener("pointerdown", onPointer, true);
  };
}

/** Grey the formula editor and keep the name box usable. */
export function watchFormulaBar(root: HTMLElement, locked: () => boolean) {
  const mark = () => {
    root.querySelectorAll<HTMLElement>("[data-u-comp='formula-editor']").forEach((el) => {
      if (locked()) el.dataset.viewLocked = "";
      else delete el.dataset.viewLocked;
      el.setAttribute("aria-disabled", locked() ? "true" : "false");
    });
  };
  mark();
  const observer = new MutationObserver(mark);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
