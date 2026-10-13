import { columnName } from "@suiteleaf/core";
import { isReferenceStringWithEffectiveColumn } from "@univerjs/engine-formula";

/** A defined name the dialog can list, jump to, or rename. */
export type NamedRangeRecord = {
  id: string;
  name: string;
  /** Sheet-qualified reference or formula, as Univer stores it. */
  ref: string;
  hidden?: boolean;
};

const DISALLOWED = /[~!@#$%^&*()+=\-{}\[\]|:;"'<>,?\/]/;

export type NameCheck = {
  names: NamedRangeRecord[];
  /** The id being renamed, so the current spelling is not a duplicate of itself. */
  editingId?: string | null;
  sheetNames: string[];
  isFunction: (name: string) => boolean;
};

/** A name a person can type instead, when the one they tried cannot be used. */
export function suggestedName(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9_]/g, ""))
    .filter(Boolean);
  if (words.length > 1)
    return words
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join("");
  return "TotalRent";
}

/**
 * Why `name` cannot be saved, as a sentence, or null when it can.
 * A space and a cell reference each get their own reason. Other names
 * stay as they are: this function never changes the workbook.
 */
export function namedRangeError(name: string, check: NameCheck): string | null {
  if (!name.trim()) return "Enter a name, such as Rent.";
  if (/\s/.test(name))
    return `"${name.trim()}" includes a space. Names cannot include spaces. Try ${suggestedName(name)}.`;
  if (
    isReferenceStringWithEffectiveColumn(name) ||
    /^r\d*c\d*$/i.test(name)
  )
    return `${name} is a cell reference. A formula would read it as that cell, so the name would never be used. Try ${suggestedName(name)}.`;
  if (
    name.length > 255 ||
    DISALLOWED.test(name) ||
    !/^[A-Za-z_]/.test(name)
  )
    return "Start with a letter, then use letters, numbers, or underscores. For example, MonthlyRent.";
  const lower = name.toLowerCase();
  const duplicate = check.names.find(
    (item) =>
      item.id !== check.editingId && item.name.toLowerCase() === lower,
  );
  if (duplicate)
    return `${duplicate.name} is already a named range. That name was kept.`;
  if (check.sheetNames.some((sheet) => sheet.toLowerCase() === lower))
    return `${name} is already a sheet. A formula could not tell the name from the sheet. Try ${suggestedName(name)}.`;
  if (check.isFunction(name))
    return `${name} is a formula function. Using it as a name would hide that function. Try ${suggestedName(name)}.`;
  return null;
}

export function a1(range: {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}) {
  const cell = (column: number, row: number) => `${columnName(column)}${row + 1}`;
  const start = cell(range.startColumn, range.startRow);
  const end = cell(range.endColumn, range.endRow);
  return start === end ? start : `${start}:${end}`;
}

/** `Budget!$C$2:$C$13` → `C2:C13` on Budget, or `Budget!C2:C13` elsewhere. */
export function displayRef(ref: string, activeSheet = ""): string {
  let text = ref.trim().replace(/^=/, "");
  let sheet = "";
  const quoted = /^'((?:[^']|'')*)'!([\s\S]*)$/.exec(text);
  if (quoted) {
    sheet = quoted[1]!.replace(/''/g, "'");
    text = quoted[2]!;
  } else {
    const plain = /^([^'![\]]+)!([\s\S]*)$/.exec(text);
    if (plain) {
      sheet = plain[1]!;
      text = plain[2]!;
    }
  }
  const cells = text.replace(/\$/g, "");
  if (!cells) return ref;
  if (sheet && activeSheet && sheet !== activeSheet) return `${sheet}!${cells}`;
  return cells;
}
