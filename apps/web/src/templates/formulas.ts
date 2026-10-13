/** Preview-only formulas for template thumbnails. The editor calculates for real. */
export interface PreviewCell {
  v?: string | number | boolean | null;
  f?: string | null;
  s?: {
    n?: { pattern?: string };
    bl?: number;
    bg?: { rgb?: string };
    fs?: number;
    ht?: number;
  } | null;
}

export interface GridCell {
  text: string;
  bold: boolean;
  fill?: string;
  fontSize?: number;
  align: "left" | "right";
}

type Value = number | string | null;
type CellData = Record<string, Record<string, PreviewCell | null>>;

export function formatCellNumber(n: number, pattern?: string): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (!pattern || pattern === "General") {
    const rounded = Math.round(n * 100) / 100;
    return String(rounded);
  }
  if (pattern.includes("%")) {
    const digits = pattern.includes("0.00") ? 2 : pattern.includes("0.0") ? 1 : 0;
    return `${(n * 100).toFixed(digits)}%`;
  }
  const currency = pattern.includes("$");
  const fraction = Math.max(0, (/\.0+/.exec(pattern)?.[0].length ?? 1) - 1);
  const body = n.toLocaleString("en-US", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  });
  return currency ? `$${body}` : body;
}

function num(v: Value): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: Value): boolean {
  if (typeof v === "number") return v !== 0;
  return v !== null && v !== "";
}

class Parser {
  private i = 0;
  constructor(
    private readonly source: string,
    private readonly at: (row: number, column: number) => Value,
  ) {}
  parse(): Value {
    this.skip();
    const value = this.comparison();
    this.skip();
    if (this.i < this.source.length) throw new Error("Unexpected formula text");
    return value;
  }
  private peek() {
    return this.source[this.i] ?? "";
  }
  private skip() {
    while (this.peek() === " ") this.i++;
  }
  private comparison(): Value {
    const left = this.additive();
    this.skip();
    const op = this.source.slice(this.i, this.i + 2);
    const one = this.peek();
    if (op === "<>" || op === "<=" || op === ">=") {
      this.i += 2;
      return this.compare(left, this.additive(), op) ? 1 : 0;
    }
    if (one === "=" || one === "<" || one === ">") {
      this.i++;
      return this.compare(left, this.additive(), one) ? 1 : 0;
    }
    return left;
  }
  private compare(left: Value, right: Value, op: string): boolean {
    if (typeof left === "string" || typeof right === "string") {
      const order = String(left ?? "").localeCompare(String(right ?? ""));
      if (op === "=") return order === 0;
      if (op === "<>") return order !== 0;
      if (op === "<") return order < 0;
      if (op === ">") return order > 0;
      if (op === "<=") return order <= 0;
      return order >= 0;
    }
    const a = num(left),
      b = num(right);
    if (op === "=") return a === b;
    if (op === "<>") return a !== b;
    if (op === "<") return a < b;
    if (op === ">") return a > b;
    if (op === "<=") return a <= b;
    return a >= b;
  }
  private additive(): Value {
    let value = this.term();
    for (;;) {
      this.skip();
      const op = this.peek();
      if (op !== "+" && op !== "-") return value;
      this.i++;
      const next = num(this.term());
      const current = num(value);
      value = op === "+" ? current + next : current - next;
    }
  }
  private term(): Value {
    let value = this.factor();
    for (;;) {
      this.skip();
      const op = this.peek();
      if (op !== "*" && op !== "/") return value;
      this.i++;
      const next = num(this.factor());
      const current = num(value);
      if (op === "*") value = current * next;
      else if (next === 0) throw new Error("#DIV/0!");
      else value = current / next;
    }
  }
  private factor(): Value {
    this.skip();
    const ch = this.peek();
    if (ch === "+") {
      this.i++;
      return this.factor();
    }
    if (ch === "-") {
      this.i++;
      return -num(this.factor());
    }
    if (ch === "(") {
      this.i++;
      const value = this.comparison();
      this.skip();
      if (this.peek() !== ")") throw new Error("Expected )");
      this.i++;
      return value;
    }
    if (ch === '"') return this.string();
    if (/[0-9.]/.test(ch)) return this.number();
    const name = this.ident();
    this.skip();
    if (this.peek() === "(") return this.call(name);
    return this.cell(name);
  }
  private string(): string {
    this.i++;
    let out = "";
    while (this.i < this.source.length && this.peek() !== '"') {
      out += this.peek();
      this.i++;
    }
    if (this.peek() !== '"') throw new Error("Expected \"");
    this.i++;
    return out;
  }
  private number(): number {
    const start = this.i;
    while (/[0-9.]/.test(this.peek())) this.i++;
    const n = Number(this.source.slice(start, this.i));
    if (!Number.isFinite(n)) throw new Error("Bad number");
    return n;
  }
  private ident(): string {
    const start = this.i;
    while (/[A-Za-z]/.test(this.peek())) this.i++;
    if (this.i === start) throw new Error("Expected a name");
    return this.source.slice(start, this.i).toUpperCase();
  }
  private cell(label: string): Value {
    const column = columnIndex(label);
    let row = "";
    while (/[0-9]/.test(this.peek())) {
      row += this.peek();
      this.i++;
    }
    if (!row) throw new Error("Expected a cell");
    return this.at(Number(row) - 1, column);
  }
  private call(name: string): Value {
    this.i++;
    if (name === "SUM") {
      const values = this.rangeList();
      this.close();
      return values.reduce<number>((sum, v) => sum + num(v), 0);
    }
    if (name === "IF") {
      const cond = this.comparison();
      this.comma();
      const yes = this.comparison();
      this.comma();
      const no = this.comparison();
      this.close();
      return truthy(cond) ? yes : no;
    }
    throw new Error(`Unsupported ${name}`);
  }
  private rangeList(): Value[] {
    const values = this.range();
    this.skip();
    while (this.peek() === ",") {
      this.i++;
      values.push(...this.range());
      this.skip();
    }
    return values;
  }
  private range(): Value[] {
    const start = this.anchor();
    this.skip();
    if (this.peek() !== ":") return [this.at(start.row, start.column)];
    this.i++;
    const end = this.anchor();
    const values: Value[] = [];
    for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++)
      for (
        let c = Math.min(start.column, end.column);
        c <= Math.max(start.column, end.column);
        c++
      )
        values.push(this.at(r, c));
    return values;
  }
  private anchor() {
    this.skip();
    if (this.peek() === "$") this.i++;
    const label = this.ident();
    if (this.peek() === "$") this.i++;
    let row = "";
    while (/[0-9]/.test(this.peek())) {
      row += this.peek();
      this.i++;
    }
    if (!row) throw new Error("Expected a cell");
    return { row: Number(row) - 1, column: columnIndex(label) };
  }
  private comma() {
    this.skip();
    if (this.peek() !== ",") throw new Error("Expected ,");
    this.i++;
  }
  private close() {
    this.skip();
    if (this.peek() !== ")") throw new Error("Expected )");
    this.i++;
  }
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Values a template preview can show, including formula results. */
export function previewGrid(cellData: CellData | undefined): GridCell[][] {
  const data = cellData ?? {};
  const rows = Object.keys(data)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  if (!rows.length) return [];
  const maxRow = Math.max(...rows);
  let maxColumn = 0;
  for (const row of rows)
    for (const column of Object.keys(data[row] ?? {}))
      maxColumn = Math.max(maxColumn, Number(column));
  const cache = new Map<string, Value>();
  const visiting = new Set<string>();
  const at = (row: number, column: number): Value => {
    const key = `${row},${column}`;
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key)) return null;
    visiting.add(key);
    const cell = data[row]?.[column];
    let value: Value = null;
    if (cell?.f) {
      try {
        const body = cell.f.startsWith("=") ? cell.f.slice(1) : cell.f;
        value = new Parser(body, at).parse();
      } catch {
        value =
          typeof cell.v === "number" || typeof cell.v === "string" ? cell.v : null;
      }
    } else if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "")
      value = typeof cell.v === "boolean" ? (cell.v ? 1 : 0) : cell.v;
    visiting.delete(key);
    cache.set(key, value);
    return value;
  };
  const grid: GridCell[][] = [];
  for (let row = 0; row <= maxRow; row++) {
    const line: GridCell[] = [];
    for (let column = 0; column <= maxColumn; column++) {
      const cell = data[row]?.[column];
      const value = at(row, column);
      const pattern = cell?.s && typeof cell.s === "object" ? cell.s.n?.pattern : undefined;
      const text =
        value === null || value === ""
          ? ""
          : typeof value === "number"
            ? formatCellNumber(value, pattern)
            : value;
      const style = cell?.s && typeof cell.s === "object" ? cell.s : undefined;
      line.push({
        text,
        bold: style?.bl === 1,
        fill: style?.bg?.rgb,
        fontSize: style?.fs,
        align: style?.ht === 3 || typeof value === "number" ? "right" : "left",
      });
    }
    grid.push(line);
  }
  return grid;
}
