/** Insert › Function, docked argument help, and one-click summaries. */

export type FunctionCategory =
  | "Math"
  | "Statistical"
  | "Logical"
  | "Text"
  | "Date"
  | "Lookup";

export type FunctionArg = {
  name: string;
  detail: string;
  example: string;
};

export type FunctionEntry = {
  name: string;
  category: FunctionCategory;
  description: string;
  /** Extra search phrases that are not part of the sentence people read. */
  find?: string;
  args: FunctionArg[];
  example: string;
};

export type FunctionHelp = {
  name: string;
  description: string;
  args: FunctionArg[];
  example: string;
};

export type GridRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

export type AggregateName = "SUM" | "AVERAGE" | "MIN" | "MAX" | "COUNT";

const arg = (name: string, detail: string, example: string): FunctionArg => ({
  name,
  detail,
  example,
});

const COMMON_NAMES = [
  "SUM",
  "AVERAGE",
  "COUNT",
  "COUNTIF",
  "IF",
  "MIN",
  "MAX",
  "ROUND",
  "VLOOKUP",
  "XLOOKUP",
] as const;

export const FUNCTION_CATEGORIES: FunctionCategory[] = [
  "Math",
  "Statistical",
  "Logical",
  "Text",
  "Date",
  "Lookup",
];

const CATALOG: FunctionEntry[] = [
  {
    name: "SUM",
    category: "Math",
    description: "Adds numbers and ranges.",
    args: [arg("number", "A number or range to add.", "A1:A10")],
    example: "SUM(A1:A10)",
  },
  {
    name: "ROUND",
    category: "Math",
    description: "Rounds a number to a given number of digits.",
    args: [
      arg("number", "The number to round.", "1.26"),
      arg("num_digits", "How many digits to keep.", "1"),
    ],
    example: "ROUND(1.26, 1)",
  },
  {
    name: "ABS",
    category: "Math",
    description: "Returns the absolute value of a number.",
    args: [arg("number", "The number whose size you want.", "-4")],
    example: "ABS(-4)",
  },
  {
    name: "INT",
    category: "Math",
    description: "Rounds a number down to the nearest integer.",
    args: [arg("number", "The number to round down.", "8.9")],
    example: "INT(8.9)",
  },
  {
    name: "MOD",
    category: "Math",
    description: "Returns the remainder after division.",
    args: [
      arg("number", "The number to divide.", "10"),
      arg("divisor", "The number to divide by.", "3"),
    ],
    example: "MOD(10, 3)",
  },
  {
    name: "POWER",
    category: "Math",
    description: "Raises a number to a power.",
    args: [
      arg("number", "The base number.", "2"),
      arg("power", "The exponent.", "3"),
    ],
    example: "POWER(2, 3)",
  },
  {
    name: "SQRT",
    category: "Math",
    description: "Returns the square root of a number.",
    args: [arg("number", "The number to take the root of.", "16")],
    example: "SQRT(16)",
  },
  {
    name: "PRODUCT",
    category: "Math",
    description: "Multiplies numbers and ranges.",
    args: [arg("number", "A number or range to multiply.", "A1:A10")],
    example: "PRODUCT(A1:A10)",
  },
  {
    name: "AVERAGE",
    category: "Statistical",
    description: "Returns the average of numbers.",
    args: [arg("number", "A number or range to average.", "B2:B29")],
    example: "AVERAGE(B2:B29)",
  },
  {
    name: "COUNT",
    category: "Statistical",
    description: "Counts cells that contain numbers.",
    args: [arg("value", "A value or range to count.", "B2:B29")],
    example: "COUNT(B2:B29)",
  },
  {
    name: "COUNTA",
    category: "Statistical",
    description: "Counts cells that are not empty.",
    args: [arg("value", "A value or range to count.", "A2:A29")],
    example: "COUNTA(A2:A29)",
  },
  {
    name: "COUNTIF",
    category: "Statistical",
    description: "Counts cells matching a condition.",
    find: "count matching",
    args: [
      arg("range", "The cells to look through.", "A1:A10"),
      arg("criterion", 'What to match, such as "Pass" or ">20".', '">20"'),
    ],
    example: 'COUNTIF(A1:A10, ">20")',
  },
  {
    name: "COUNTIFS",
    category: "Statistical",
    description: "Counts cells that match every condition.",
    args: [
      arg("criteria_range", "The cells to test.", "A2:A29"),
      arg("criterion", "The condition those cells must meet.", '">10"'),
    ],
    example: 'COUNTIFS(A2:A29, ">10")',
  },
  {
    name: "MIN",
    category: "Statistical",
    description: "Returns the smallest number.",
    args: [arg("number", "A number or range to compare.", "B2:B29")],
    example: "MIN(B2:B29)",
  },
  {
    name: "MAX",
    category: "Statistical",
    description: "Returns the largest number.",
    args: [arg("number", "A number or range to compare.", "B2:B29")],
    example: "MAX(B2:B29)",
  },
  {
    name: "MEDIAN",
    category: "Statistical",
    description: "Returns the middle number.",
    args: [arg("number", "A number or range.", "B2:B29")],
    example: "MEDIAN(B2:B29)",
  },
  {
    name: "SUMIF",
    category: "Statistical",
    description: "Adds cells that match a condition.",
    args: [
      arg("range", "The cells to test.", "D2:D29"),
      arg("criterion", "Which cells to include.", '"Pass"'),
      arg("sum_range", "The cells to add. Optional.", "C2:C29"),
    ],
    example: 'SUMIF(D2:D29, "Pass", C2:C29)',
  },
  {
    name: "IF",
    category: "Logical",
    description:
      "Returns one value if a condition is true and another if it's false",
    find: "if a condition",
    args: [
      arg("logical_expression", "The condition to test, such as B2>2000.", "A2>10"),
      arg("value_if_true", "The value to return when the condition is true.", '"Yes"'),
      arg("value_if_false", "The value to return when the condition is false.", '"No"'),
    ],
    example: 'IF(A2>10, "Yes", "No")',
  },
  {
    name: "IFS",
    category: "Logical",
    description: "Returns the value for the first test that is true.",
    args: [
      arg("logical_test", "The first condition.", "A2>10"),
      arg("value", "The value when that condition is true.", '"High"'),
    ],
    example: 'IFS(A2>10, "High", TRUE, "Low")',
  },
  {
    name: "AND",
    category: "Logical",
    description: "Returns true when every condition is true.",
    args: [arg("logical", "A condition that must be true.", "A2>10")],
    example: "AND(A2>10, B2<5)",
  },
  {
    name: "OR",
    category: "Logical",
    description: "Returns true when any condition is true.",
    args: [arg("logical", "A condition to test.", "A2>10")],
    example: "OR(A2>10, B2<5)",
  },
  {
    name: "NOT",
    category: "Logical",
    description: "Reverses true and false.",
    args: [arg("logical", "The condition to reverse.", "A2>10")],
    example: "NOT(A2>10)",
  },
  {
    name: "IFERROR",
    category: "Logical",
    description: "Returns another value when a formula is an error.",
    args: [
      arg("value", "The formula to try.", "A2/B2"),
      arg("value_if_error", "The value to return if that formula errors.", "0"),
    ],
    example: "IFERROR(A2/B2, 0)",
  },
  {
    name: "CONCATENATE",
    category: "Text",
    description: "Joins text together.",
    args: [arg("text", "A piece of text to join.", "A2")],
    example: 'CONCATENATE(A2, " ", B2)',
  },
  {
    name: "LEFT",
    category: "Text",
    description: "Returns characters from the start of text.",
    args: [
      arg("text", "The text to read.", "A2"),
      arg("num_chars", "How many characters to take.", "3"),
    ],
    example: "LEFT(A2, 3)",
  },
  {
    name: "RIGHT",
    category: "Text",
    description: "Returns characters from the end of text.",
    args: [
      arg("text", "The text to read.", "A2"),
      arg("num_chars", "How many characters to take.", "2"),
    ],
    example: "RIGHT(A2, 2)",
  },
  {
    name: "MID",
    category: "Text",
    description: "Returns characters from the middle of text.",
    args: [
      arg("text", "The text to read.", "A2"),
      arg("start", "Where to start, counting from 1.", "2"),
      arg("num_chars", "How many characters to take.", "3"),
    ],
    example: "MID(A2, 2, 3)",
  },
  {
    name: "LEN",
    category: "Text",
    description: "Counts the characters in text.",
    args: [arg("text", "The text to measure.", "A2")],
    example: "LEN(A2)",
  },
  {
    name: "TRIM",
    category: "Text",
    description: "Removes extra spaces from text.",
    args: [arg("text", "The text to tidy.", "A2")],
    example: "TRIM(A2)",
  },
  {
    name: "UPPER",
    category: "Text",
    description: "Converts text to capitals.",
    args: [arg("text", "The text to convert.", "A2")],
    example: "UPPER(A2)",
  },
  {
    name: "LOWER",
    category: "Text",
    description: "Converts text to lowercase.",
    args: [arg("text", "The text to convert.", "A2")],
    example: "LOWER(A2)",
  },
  {
    name: "TEXT",
    category: "Text",
    description: "Formats a number as text.",
    args: [
      arg("value", "The number to format.", "A2"),
      arg("format", "The format to apply.", '"0.00"'),
    ],
    example: 'TEXT(A2, "0.00")',
  },
  {
    name: "TODAY",
    category: "Date",
    description: "Returns today's date.",
    args: [],
    example: "TODAY()",
  },
  {
    name: "NOW",
    category: "Date",
    description: "Returns the current date and time.",
    args: [],
    example: "NOW()",
  },
  {
    name: "DATE",
    category: "Date",
    description: "Builds a date from a year, month, and day.",
    args: [
      arg("year", "The year.", "2026"),
      arg("month", "The month, from 1 to 12.", "10"),
      arg("day", "The day of the month.", "12"),
    ],
    example: "DATE(2026, 10, 12)",
  },
  {
    name: "YEAR",
    category: "Date",
    description: "Returns the year of a date.",
    args: [arg("date", "The date to read.", "A2")],
    example: "YEAR(A2)",
  },
  {
    name: "MONTH",
    category: "Date",
    description: "Returns the month of a date.",
    args: [arg("date", "The date to read.", "A2")],
    example: "MONTH(A2)",
  },
  {
    name: "DAY",
    category: "Date",
    description: "Returns the day of a date.",
    args: [arg("date", "The date to read.", "A2")],
    example: "DAY(A2)",
  },
  {
    name: "VLOOKUP",
    category: "Lookup",
    description:
      "Looks up a value in the first column of a range and returns a value from another column.",
    find: "look up a value",
    args: [
      arg("lookup_value", "The value to search for.", "A2"),
      arg("table", "The range whose first column is searched.", "A2:C29"),
      arg("col_index", "Which column to return, counting from 1.", "2"),
      arg("range_lookup", "FALSE finds an exact match.", "FALSE"),
    ],
    example: "VLOOKUP(A2, A2:C29, 2, FALSE)",
  },
  {
    name: "HLOOKUP",
    category: "Lookup",
    description: "Looks up a value in the first row of a range.",
    find: "look up a value",
    args: [
      arg("lookup_value", "The value to search for.", "B1"),
      arg("table", "The range whose first row is searched.", "A1:F3"),
      arg("row_index", "Which row to return, counting from 1.", "2"),
    ],
    example: "HLOOKUP(B1, A1:F3, 2, FALSE)",
  },
  {
    name: "XLOOKUP",
    category: "Lookup",
    description: "Looks up a value and returns a matching result from another range.",
    find: "look up a value",
    args: [
      arg("lookup_value", "The value to search for.", '"Ann"'),
      arg("lookup_array", "The range to search.", "A2:A10"),
      arg("return_array", "The range to return a value from.", "B2:B10"),
    ],
    example: 'XLOOKUP("Ann", A2:A10, B2:B10)',
  },
  {
    name: "INDEX",
    category: "Lookup",
    description: "Returns the cell at a row and column inside a range.",
    args: [
      arg("array", "The range to read.", "A2:C29"),
      arg("row", "The row to return, counting from 1.", "1"),
      arg("column", "The column to return, counting from 1.", "2"),
    ],
    example: "INDEX(A2:C29, 1, 2)",
  },
  {
    name: "MATCH",
    category: "Lookup",
    description: "Returns the position of a value in a range.",
    args: [
      arg("lookup_value", "The value to find.", "A2"),
      arg("lookup_array", "The range to search.", "A2:A29"),
      arg("match_type", "0 finds an exact match.", "0"),
    ],
    example: "MATCH(A2, A2:A29, 0)",
  },
];

const byName = new Map(CATALOG.map((entry) => [entry.name, entry]));

export const COMMON_FUNCTIONS: FunctionEntry[] = COMMON_NAMES.map(
  (name) => byName.get(name)!,
);

export function functionsIn(category: FunctionCategory): FunctionEntry[] {
  return CATALOG.filter((entry) => entry.category === category);
}

export function functionCatalog(): FunctionEntry[] {
  return CATALOG;
}

export function functionByName(name: string): FunctionEntry | undefined {
  return byName.get(name.toUpperCase());
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "and",
  "or",
  "for",
  "from",
  "in",
  "on",
  "by",
  "with",
]);

function words(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOP.has(word));
}

function hasWord(text: string, word: string) {
  return new RegExp(`\\b${word}\\b`).test(text);
}

/** Search names and descriptions. An empty query returns nothing. */
export function searchFunctions(query: string, limit = 8): FunctionEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = words(q);
  const ranked = CATALOG.map((entry) => {
    const name = entry.name.toLowerCase();
    const description = entry.description.toLowerCase();
    const blob = `${name} ${description} ${entry.find ?? ""} ${entry.example}`.toLowerCase();
    let score = 0;
    if (name === q) score += 200;
    if (description.includes(q) || (entry.find ?? "").toLowerCase().includes(q))
      score += 80;
    if (blob.includes(q)) score += 40;
    for (const token of tokens) {
      if (name === token) score += 100;
      else if (name.startsWith(token)) score += 35;
      else if (name.includes(token)) score += 18;
      if (hasWord(description, token)) score += 14;
      else if (description.includes(token)) score += 6;
    }
    return { entry, score };
  })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name),
    );
  return ranked.slice(0, limit).map((item) => item.entry);
}

type UniverArg = { name?: string; detail?: string; example?: string };
export type UniverFunctionInfo = {
  description?: string;
  abstract?: string;
  functionParameter?: UniverArg[];
};

function fallbackArgs(info?: UniverFunctionInfo): FunctionArg[] {
  const params = (info?.functionParameter ?? []).filter((item) => item.name?.trim());
  if (!params.length)
    return [arg("value", "A value this function uses.", "A1")];
  return params.map((item) =>
    arg(
      item.name!.trim(),
      item.detail?.trim() || "A value this function uses.",
      item.example?.trim() || item.name!.trim(),
    ),
  );
}

/** A description, arguments, and an example. Never a blank field. */
export function helpFor(name: string, info?: UniverFunctionInfo): FunctionHelp {
  const curated = functionByName(name);
  if (curated)
    return {
      name: curated.name,
      description: curated.description,
      args: curated.args,
      example: curated.example,
    };
  const upper = name.toUpperCase();
  const args = fallbackArgs(info);
  const description =
    info?.description?.trim() ||
    info?.abstract?.trim() ||
    `Calculates a result with ${upper}.`;
  const example = info?.functionParameter?.some((item) => item.example?.trim())
    ? `${upper}(${args.map((item) => item.example).join(", ")})`
    : `${upper}(${args.map((item) => item.example).join(", ")})`;
  return { name: upper, description, args, example };
}

export function argumentAt(help: FunctionHelp, index: number): FunctionArg | undefined {
  if (!help.args.length) return undefined;
  return help.args[Math.min(Math.max(index, 0), help.args.length - 1)];
}

/**
 * The function call surrounding the caret, and which argument is being typed.
 * Commas inside strings, and inside parentheses that are not this call, do not count.
 */
export function formulaHelpAt(
  text: string,
  caret: number,
): { name: string; argIndex: number } | null {
  if (!text.startsWith("=")) return null;
  const limit = Math.max(0, Math.min(caret, text.length));
  let i = 0;
  let quote = false;
  let depth = 0;
  let pending = "";
  const stack: { name: string; arg: number; open: number }[] = [];
  let closed: { name: string; arg: number } | null = null;
  while (i < limit) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') {
        i += 2;
        continue;
      }
      if (c === '"') quote = false;
      i++;
      continue;
    }
    if (c === '"') {
      quote = true;
      pending = "";
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      i++;
      while (i < limit && /[A-Za-z0-9_.]/.test(text[i])) i++;
      pending = text.slice(start, i).toUpperCase();
      continue;
    }
    if (c === "(") {
      depth++;
      if (pending) stack.push({ name: pending, arg: 0, open: depth });
      pending = "";
      i++;
      continue;
    }
    if (c === ")") {
      const top = stack[stack.length - 1];
      if (top && top.open === depth) closed = stack.pop() ?? null;
      depth = Math.max(0, depth - 1);
      pending = "";
      i++;
      continue;
    }
    if (c === ",") {
      const top = stack[stack.length - 1];
      if (top && top.open === depth) top.arg++;
      pending = "";
      i++;
      continue;
    }
    if (c !== " " && c !== "\n" && c !== "\t") pending = "";
    i++;
  }
  const current = stack[stack.length - 1];
  if (current) return { name: current.name, argIndex: current.arg };
  if (closed && text[limit - 1] === ")")
    return { name: closed.name, argIndex: closed.arg };
  return null;
}

export function columnLetters(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function formulaRange(range: GridRange): string {
  const start = `${columnLetters(range.startColumn)}${range.startRow + 1}`;
  const end = `${columnLetters(range.endColumn)}${range.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

export function selectionStatistics(values: unknown[][]): {
  sum: number;
  average: number;
  min: number;
  max: number;
  count: number;
} | null {
  const nums = values
    .flat()
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return null;
  const sum = nums.reduce((total, value) => total + value, 0);
  return {
    sum,
    average: sum / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    count: nums.length,
  };
}

export function formatStat(value: number): string {
  const whole = Math.abs(value - Math.round(value)) < 1e-6;
  const shown = whole ? Math.round(value) : value;
  return shown.toLocaleString("en-US", { maximumFractionDigits: whole ? 0 : 2 });
}

export type AggregateSide = "below" | "right";

/** A single row of several cells gets a formula on its right. Anything taller goes below. */
export function aggregateSide(range: GridRange): AggregateSide {
  const height = range.endRow - range.startRow + 1;
  const width = range.endColumn - range.startColumn + 1;
  return height === 1 && width > 1 ? "right" : "below";
}

export function emptyAggregateCell(
  range: GridRange,
  isEmpty: (row: number, column: number) => boolean,
  limit = 40,
): { side: AggregateSide; row: number; column: number } | null {
  const side = aggregateSide(range);
  const row0 = side === "below" ? range.endRow + 1 : range.startRow;
  const column0 = side === "right" ? range.endColumn + 1 : range.startColumn;
  for (let step = 0; step < limit; step++) {
    const row = side === "below" ? row0 + step : row0;
    const column = side === "right" ? column0 + step : column0;
    if (row < 0 || column < 0) continue;
    if (isEmpty(row, column)) return { side, row, column };
  }
  return null;
}

export function aggregateFormula(name: AggregateName, range: GridRange): string {
  return `=${name}(${formulaRange(range)})`;
}

/** Numbers directly above the cell, or directly to its left when nothing is above. */
export function adjacentNumberRun(
  row: number,
  column: number,
  isNumber: (row: number, column: number) => boolean,
): GridRange | null {
  if (row > 0 && isNumber(row - 1, column)) {
    let start = row - 1;
    while (start > 0 && isNumber(start - 1, column)) start--;
    return {
      startRow: start,
      endRow: row - 1,
      startColumn: column,
      endColumn: column,
    };
  }
  if (column > 0 && isNumber(row, column - 1)) {
    let start = column - 1;
    while (start > 0 && isNumber(row, start - 1)) start--;
    return {
      startRow: row,
      endRow: row,
      startColumn: start,
      endColumn: column - 1,
    };
  }
  return null;
}

export type SumPlan =
  | { kind: "edit"; text: string }
  | { kind: "write"; row: number; column: number; formula: string }
  | { kind: "skip" };

/**
 * Σ on a range writes =SUM(range) below it, or to the right of a row.
 * On one empty cell it starts =SUM( with the numbers above or to the left.
 * A cell that already has a value is left alone.
 */
export function autoSumPlan(
  range: GridRange,
  isEmpty: (row: number, column: number) => boolean,
  isNumber: (row: number, column: number) => boolean,
): SumPlan {
  const single =
    range.startRow === range.endRow && range.startColumn === range.endColumn;
  if (single) {
    if (!isEmpty(range.startRow, range.startColumn)) return { kind: "skip" };
    const run = adjacentNumberRun(range.startRow, range.startColumn, isNumber);
    return { kind: "edit", text: run ? `=SUM(${formulaRange(run)}` : "=SUM(" };
  }
  const dest = emptyAggregateCell(range, isEmpty);
  if (!dest) return { kind: "skip" };
  return {
    kind: "write",
    row: dest.row,
    column: dest.column,
    formula: aggregateFormula("SUM", range),
  };
}

const HELP_KEY = "suiteleaf_function_help";

export function helpIsCollapsed(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function setHelpCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(HELP_KEY, "collapsed");
    else localStorage.removeItem(HELP_KEY);
  } catch {
    // Preference storage can be blocked; the panel still toggles for this visit.
  }
}

type Suggestion = { name: string; desc: string };

/** Fills blank suggestion descriptions without changing their order. */
export function enrichFormulaSuggestions(service: {
  getSearchListByNameFirstLetter(text: string): Suggestion[];
  getFunctionInfo?(name: string): UniverFunctionInfo | undefined;
}) {
  const search = service.getSearchListByNameFirstLetter.bind(service);
  service.getSearchListByNameFirstLetter = (text) =>
    search(text).map((item) => {
      const curated = functionByName(item.name);
      const desc =
        curated?.description ||
        item.desc?.trim() ||
        helpFor(item.name, service.getFunctionInfo?.(item.name)).description;
      return { ...item, desc };
    });
}
