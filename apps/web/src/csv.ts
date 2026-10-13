import Papa from "papaparse";

type CsvCell = { v: string | number | boolean; t: number };

/** Infer ordinary numbers without executing formulas or losing identifier precision. */
export function csvCell(value: string): CsvCell {
  if (/^(TRUE|FALSE)$/.test(value)) return { v: value === "TRUE", t: 3 };
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const number = Number(value),
      digits = value.replace(/[eE].*$/, "").replace(/\D/g, "").length;
    if (
      Number.isFinite(number) &&
      digits <= 15 &&
      (!Number.isInteger(number) || Number.isSafeInteger(number))
    )
      return { v: number, t: 2 };
  }
  return { v: value, t: 1 };
}

export const delimiters = [
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe" },
];
export const delimiterLabel = (d: string) =>
  delimiters.find((o) => o.value === d)?.label ?? "Other";

export interface DelimitedOptions {
  delimiter: string;
  /** The first row holds column names: it stays text and is not counted as data. */
  header: boolean;
  /** Recognize numbers and TRUE/FALSE; otherwise every value stays text. */
  convert: boolean;
  /** A column with any leading-zero or over-long digit code keeps all its values as text. */
  keepIdentifiers: boolean;
}

/** Parse delimited text; an empty `delimiter` auto-detects it. */
export function parseDelimited(text: string, delimiter = "") {
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
  });
  const error = parsed.errors.find((e) => e.code !== "UndetectableDelimiter");
  return {
    rows: parsed.data,
    delimiter: parsed.meta.delimiter,
    error: error?.message,
  };
}

/** Digit codes a number would corrupt: leading zeros, or more digits than a number keeps. */
const isIdentifier = (value: string) =>
  /^0\d+$/.test(value) || /^\d{16,}$/.test(value);

/** Columns whose data rows include an identifier code. */
export function identifierColumns(rows: string[][], header: boolean) {
  const columns = new Set<number>();
  for (let r = header ? 1 : 0; r < rows.length; r++)
    rows[r].forEach((v, c) => {
      if (isIdentifier(v)) columns.add(c);
    });
  return columns;
}

/** A first row of distinct, non-numeric labels followed by more rows reads as a header. */
export function guessHeader(rows: string[][]) {
  const first = rows[0] ?? [];
  return (
    rows.length > 1 &&
    first.length > 0 &&
    first.every((v) => v.trim() && csvCell(v).t === 1 && !isIdentifier(v)) &&
    new Set(first).size === first.length
  );
}

export function defaultDelimitedOptions(
  rows: string[][],
  delimiter: string,
): DelimitedOptions {
  return {
    delimiter,
    header: guessHeader(rows),
    convert: true,
    keepIdentifiers: true,
  };
}

/** Build a cell reader for `rows` that applies the import options consistently per column. */
export function delimitedCellReader(
  rows: string[][],
  options: DelimitedOptions,
) {
  const text = options.keepIdentifiers
    ? identifierColumns(rows, options.header)
    : new Set<number>();
  return (value: string, row: number, column: number): CsvCell =>
    !options.convert || (options.header && row === 0) || text.has(column)
      ? { v: value, t: 1 }
      : csvCell(value);
}

export function delimitedCellData(
  rows: string[][],
  options: DelimitedOptions,
) {
  const read = delimitedCellReader(rows, options);
  return Object.fromEntries(
    rows.map((r, i) => [
      i,
      Object.fromEntries(r.map((v, j) => [j, read(v, i, j)])),
    ]),
  );
}
