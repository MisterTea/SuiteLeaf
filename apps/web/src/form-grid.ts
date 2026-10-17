/** A grid answer is one JSON object of row label to column label, stored on the question id. */

export function filledLabels(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function parsedGrid(value: string): Record<string, string> | null {
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const selected: Record<string, string> = {};
    for (const [row, column] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof column !== "string") return null;
      selected[row] = column;
    }
    return selected;
  } catch {
    return null;
  }
}

export function gridSelection(value: string): Record<string, string> {
  return parsedGrid(value) ?? {};
}

/** Keeps pairs whose row and column are on the question, in row order. */
export function encodeGridAnswer(
  rows: string[],
  columns: string[],
  selected: Record<string, string>,
): string {
  const allowed = new Set(columns);
  const stored: Record<string, string> = {};
  for (const row of rows) {
    const column = selected[row];
    if (column && allowed.has(column)) stored[row] = column;
  }
  return Object.keys(stored).length ? JSON.stringify(stored) : "";
}

export function canonicalGridAnswer(
  rows: string[],
  columns: string[],
  value: string,
): string {
  return encodeGridAnswer(rows, columns, gridSelection(value));
}

/** The existing required-question error when a required grid is missing a row. */
export function gridAnswerError(
  prompt: string,
  required: boolean,
  rows: string[],
  columns: string[],
  value: string,
): string | null {
  const selected = parsedGrid(value);
  if (!selected) return `${prompt} must be one of the columns`;
  const allowedRows = new Set(rows);
  const allowedColumns = new Set(columns);
  for (const [row, column] of Object.entries(selected)) {
    if (!allowedRows.has(row) || !allowedColumns.has(column)) {
      return `${prompt} must be one of the columns`;
    }
  }
  if (required && rows.some((row) => !allowedColumns.has(selected[row] ?? ""))) {
    return `${prompt} is required`;
  }
  return null;
}

/** One line per answered row, in the question's row order. */
export function formatGridAnswer(rows: string[], value: string): string {
  const selected = parsedGrid(value);
  if (!selected) return value.trim();
  const known = rows.filter((row) => selected[row]);
  const lines = (known.length ? known : Object.keys(selected)).map(
    (row) => `${row}: ${selected[row]}`,
  );
  return lines.join("\n");
}
