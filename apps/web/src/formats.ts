/**
 * Number & date format catalog ("More formats" toolbar group).
 *
 * Pure, UI-agnostic. The catalog maps a user-visible name to an Excel/Univer
 * compatible number-format *code*. Applying a code is delegated to the editor
 * (active-range `setNumberFormat`), so this module is unit-testable without a
 * live Univer instance. See docs/workflows-and-expected-behavior.md WF-A2-12 /
 * WF-B2-09 (apply number / date formats).
 */
export type FormatGroup = "Number" | "Percent" | "Date & time";

export interface NamedFormat {
  /** Stable id used by the UI (also the value passed to setNumberFormat). */
  id: string;
  /** User-visible label. */
  label: string;
  /** Excel/Univer number-format code applied with range.setNumberFormat(code). */
  code: string;
  group: FormatGroup;
}

/**
 * The catalog of one-click formats. Codes are Excel/Univer compatible so they
 * persist through the native `.suiteleaf` snapshot and render consistently.
 */
export const NUMBER_FORMATS: readonly NamedFormat[] = [
  { id: "general", label: "General", code: "General", group: "Number" },
  { id: "number0", label: "Number (thousands)", code: "#,##0", group: "Number" },
  { id: "number2", label: "Number (2 decimals)", code: "#,##0.00", group: "Number" },
  {
    id: "currency",
    label: "Currency",
    code: '"$"#,##0',
    group: "Number",
  },
  {
    id: "currency2",
    label: "Currency (2 decimals)",
    code: '"$"#,##0.00',
    group: "Number",
  },
  { id: "accounting", label: "Accounting", code: "#,##0.00;(#,##0.00)", group: "Number" },
  { id: "percent", label: "Percent", code: "0%", group: "Percent" },
  { id: "percent1", label: "Percent (1 decimal)", code: "0.0%", group: "Percent" },
  { id: "percent2", label: "Percent (2 decimals)", code: "0.00%", group: "Percent" },
  { id: "dateLong", label: "Date (long)", code: "mmmm d, yyyy", group: "Date & time" },
  { id: "dateShort", label: "Date (short)", code: "mm/dd/yyyy", group: "Date & time" },
  {
    id: "dateTime",
    label: "Date & time",
    code: "m/d/yyyy h:mm AM/PM",
    group: "Date & time",
  },
  { id: "time", label: "Time", code: "h:mm AM/PM", group: "Date & time" },
  { id: "time24", label: "Time (24-hour)", code: "H:mm", group: "Date & time" },
];

export function numberFormatById(id: string): NamedFormat | undefined {
  return NUMBER_FORMATS.find((f) => f.id === id);
}

/** Grouped view for rendering the dropdown. */
export function numberFormatsByGroup(): Record<FormatGroup, NamedFormat[]> {
  const out: Record<FormatGroup, NamedFormat[]> = {
    Number: [],
    Percent: [],
    "Date & time": [],
  };
  for (const f of NUMBER_FORMATS) out[f.group].push(f);
  return out;
}

/** A code is valid to apply if it is a non-empty string (Univer accepts "General"). */
export function isValidFormatCode(code: unknown): code is string {
  return typeof code === "string" && code.trim().length > 0;
}

/**
 * Apply a named format to an active range, mirroring the existing currency/
 * percent handlers: it reads the code from the catalog, applies via
 * setNumberFormat, and reports whether it was applied. The apply callback is
 * injected so this stays pure/testable; the editor wires it to
 * `book.current.getActiveSheet().getActiveRange().setNumberFormat`.
 */
export function applyNamedFormat(
  id: string,
  apply: (code: string) => void,
): { ok: boolean; code?: string } {
  const f = numberFormatById(id);
  if (!f || !isValidFormatCode(f.code)) return { ok: false };
  apply(f.code);
  return { ok: true, code: f.code };
}
