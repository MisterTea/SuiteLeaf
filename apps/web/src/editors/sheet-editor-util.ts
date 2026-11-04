import { checkboxForFilterLabel } from "./sheet-phone-gestures";

const FORMULA_BAR_KEY = "suiteleaf_sheets_formula_bar";
/** Formula bar visibility is a per-person preference, not part of the workbook. */
export function formulaBarVisible() {
  try {
    return localStorage.getItem(FORMULA_BAR_KEY) !== "hidden";
  } catch {
    return true;
  }
}
export function setFormulaBarVisible(visible: boolean) {
  try {
    if (visible) localStorage.removeItem(FORMULA_BAR_KEY);
    else localStorage.setItem(FORMULA_BAR_KEY, "hidden");
  } catch {
    // ignore localStorage failures
  }
}

export const shortcut = (key: string) =>
  `${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}${key}`;
export const rowVisibilityMutation =
  /^sheet\.mutation\.(set-filter-criteria|set-filter-range|re-calc-filter|remove-filter|set-row-hidden|set-row-visible|set-col-hidden|set-col-visible)$/;
/**
 * Univer's filter list toggles a value only from its small checkbox. As in Sheets and
 * Excel, clicking the value's label or count toggles it too. Rows with an expand arrow
 * (date groups) keep expanding on a label click.
 */
export function toggleFilterValueFromLabel(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  checkboxForFilterLabel(target)?.click();
}

/** Menu clicks can land before the grid's helpers have mounted. */
export function callWhenMounted<T>(ref: { current: T | null }, run: (value: T) => void) {
  if (ref.current) {
    run(ref.current);
    return;
  }
  const started = Date.now();
  const timer = window.setInterval(() => {
    if (ref.current) {
      window.clearInterval(timer);
      run(ref.current);
    } else if (Date.now() - started > 8000) window.clearInterval(timer);
  }, 50);
}
