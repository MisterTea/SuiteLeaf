/** Dropdown lists: tidy existing values, chips, renames, and spaced matches. */

export type DropdownOption = {
  /** Stays put when the label changes, so cells holding the old label can follow. */
  id: string;
  label: string;
  /** Chip background, #rrggbb. Text color is chosen for contrast. */
  color: string;
};

export const DROPDOWN_COLORS = [
  { name: "Green", value: "#b7e1cd" },
  { name: "Amber", value: "#ffe599" },
  { name: "Grey", value: "#d9d9d9" },
  { name: "Blue", value: "#c9daf8" },
  { name: "Red", value: "#f4cccc" },
  { name: "Purple", value: "#d9d2e9" },
] as const;

export type CellAddress = { row: number; column: number; value: unknown };

const CUSTOM_RENDER = 2;

export function newOptionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `opt-${Math.random().toString(36).slice(2)}`;
}

export function cellText(value: unknown): string {
  if (value == null || typeof value === "boolean" || typeof value === "object")
    return "";
  return String(value);
}

/** Trimmed text, or "" when the cell is blank. */
export function trimmedText(value: unknown): string {
  return cellText(value).trim();
}

function capitalLetters(label: string): number {
  return [...label].filter((c) => c >= "A" && c <= "Z").length;
}

/**
 * Distinct values from a selection: trim, drop blanks, and group
 * case-insensitively. The label kept for a group is the spelling that
 * appears most often; a tie prefers the spelling with more capitals, then
 * the one seen first.
 */
export function optionsFromValues(values: unknown[]): DropdownOption[] {
  type Group = { counts: Map<string, number>; order: string[] };
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const raw of values) {
    const text = trimmedText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    let group = byKey.get(key);
    if (!group) {
      group = { counts: new Map(), order: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.counts.set(text, (group.counts.get(text) ?? 0) + 1);
    if (!group.order.includes(text)) group.order.push(text);
  }
  return groups.map((group, index) => {
    let label = group.order[0];
    let count = -1;
    let caps = -1;
    for (const spelling of group.order) {
      const n = group.counts.get(spelling) ?? 0;
      const c = capitalLetters(spelling);
      if (n > count || (n === count && c > caps)) {
        label = spelling;
        count = n;
        caps = c;
      }
    }
    return {
      id: `opt-${index}`,
      label,
      color: DROPDOWN_COLORS[index % DROPDOWN_COLORS.length].value,
    };
  });
}

/** A formula that points at cells, such as =Statuses!$A$2:$A$5. */
export function isRangeFormula(formula1: string | undefined): boolean {
  const raw = String(formula1 ?? "").trim();
  if (!raw.startsWith("=")) return false;
  const body = raw.slice(1).trim();
  if (!body || body.startsWith("[") || body.startsWith('"') || body.includes("("))
    return false;
  return /[A-Za-z]/.test(body);
}

/** JSON list (Univer) or a comma-separated list (Excel). */
export function parseList(formula1: string | undefined): string[] {
  const raw = String(formula1 ?? "").trim();
  if (!raw || isRangeFormula(raw)) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string"))
        return parsed.map((item) => item.trim()).filter(Boolean);
    } catch {
      /* Fall through to comma-separated text. */
    }
  }
  return raw
    .replace(/^=/, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function optionsFromRule(
  formula1: string | undefined,
  formula2: string | undefined,
): DropdownOption[] {
  const colors = String(formula2 ?? "").split(",");
  return parseList(formula1).map((label, index) => ({
    id: `opt-${index}`,
    label,
    color: /^#[\da-f]{6}$/i.test(colors[index] ?? "")
      ? colors[index]
      : DROPDOWN_COLORS[index % DROPDOWN_COLORS.length].value,
  }));
}

/** The option label this cell should show, ignoring case and surrounding spaces. */
export function canonicalOption(
  value: unknown,
  options: { label: string }[],
): string | null {
  const text = trimmedText(value);
  if (!text) return null;
  const found = options.find(
    (option) => option.label.trim().toLowerCase() === text.toLowerCase(),
  );
  return found ? found.label : null;
}

export function isRejectStyle(errorStyle: unknown): boolean {
  const value = String(errorStyle ?? "").trim().toLowerCase();
  return value === "" || value === "1" || value === "stop";
}

export function allowedOptionsMessage(labels: string[]): string {
  if (labels.length === 0) return "Choose a value from the list.";
  if (labels.length === 1) return `Choose ${labels[0]}.`;
  if (labels.length === 2) return `Choose ${labels[0]} or ${labels[1]}.`;
  return `Choose ${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}.`;
}

export function listRuleFields(options: DropdownOption[], reject: boolean) {
  const labels = options.map((option) => option.label);
  return {
    formula1: JSON.stringify(labels),
    formula2: options.map((option) => option.color).join(","),
    renderMode: CUSTOM_RENDER,
    errorStyle: reject ? 1 : 2,
    showErrorMessage: true,
    showDropDown: true,
    allowBlank: true,
    error: allowedOptionsMessage(labels),
    type: "list" as const,
  };
}

export function renamedOptions(
  before: DropdownOption[],
  after: DropdownOption[],
): { from: string; to: string }[] {
  const next = new Map(after.map((option) => [option.id, option.label]));
  return before.flatMap((option) => {
    const label = next.get(option.id);
    if (!label || label === option.label) return [];
    return [{ from: option.label, to: label }];
  });
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = prev[j];
      prev[j] =
        a[i - 1] === b[j - 1]
          ? diagonal
          : 1 + Math.min(diagonal, prev[j], prev[j - 1]);
      diagonal = saved;
    }
  }
  return prev[b.length];
}

/** The option a leftover value most likely meant, or the most common one when nothing is close. */
export function suggestOption(
  value: string,
  options: string[],
  popular?: string,
): string | null {
  const labels = options.map((option) => option.trim()).filter(Boolean);
  if (!labels.length) return null;
  const needle = value.trim().toLowerCase();
  if (!needle) return popular && labels.includes(popular) ? popular : labels[0];
  let best = labels[0];
  let bestScore = -1;
  for (const label of labels) {
    const hay = label.toLowerCase();
    let score: number;
    if (hay === needle) score = 1;
    else if (hay.startsWith(needle) || needle.startsWith(hay)) score = 0.85;
    else if (hay.includes(needle) || needle.includes(hay)) score = 0.7;
    else {
      const distance = levenshtein(needle, hay);
      score = 1 - distance / Math.max(needle.length, hay.length);
    }
    if (score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  if (bestScore >= 0.45) return best;
  return popular && labels.includes(popular) ? popular : best;
}

export function mostCommonLabel(
  values: unknown[],
  options: { label: string }[],
): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    const hit = canonicalOption(value, options);
    if (!hit) continue;
    counts.set(hit, (counts.get(hit) ?? 0) + 1);
  }
  let best: string | undefined;
  let count = 0;
  for (const [label, n] of counts) {
    if (n > count) {
      best = label;
      count = n;
    }
  }
  return best;
}

export function mismatchNotice(count: number): string {
  return count === 1
    ? "1 cell doesn't match the list"
    : `${count} cells don't match the list`;
}

export type Mismatch = CellAddress & { suggestion: string | null };

export function findMismatches(
  cells: CellAddress[],
  options: DropdownOption[],
  popular?: string,
  multiple = false,
): Mismatch[] {
  const labels = options.map((option) => option.label);
  return cells.flatMap((cell) => {
    if (!trimmedText(cell.value)) return [];
    if (!multiple) {
      if (canonicalOption(cell.value, options)) return [];
      return [
        {
          ...cell,
          suggestion: suggestOption(cellText(cell.value), labels, popular),
        },
      ];
    }
    const tokens = dropdownTokens(cell.value);
    const bad = tokens.find((token) => !canonicalOption(token, options));
    if (!bad) return [];
    return [
      {
        ...cell,
        suggestion: suggestOption(bad, labels, popular),
      },
    ];
  });
}

/** Tokens in a multi-select cell: a JSON list or comma-separated labels. */
export function dropdownTokens(value: unknown): string[] {
  const text = cellText(value).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string"))
        return parsed.map((item) => item.trim()).filter(Boolean);
    } catch {
      /* A comma-separated list is the Excel-visible form. */
    }
  }
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function rejectionMessage(rejected: string[], labels: string[]): string {
  const unique = [...new Set(rejected.map((item) => item.trim()).filter(Boolean))];
  const lead =
    unique.length === 0
      ? ""
      : unique.length === 1
        ? `${unique[0]} isn't an option. `
        : `${unique.join(", ")} aren't options. `;
  return `${lead}${allowedOptionsMessage(labels)}`;
}

/**
 * Value to store after a rename and a space/case tidy.
 * Undefined means the cell already holds the right text.
 * A multi-select cell is several labels joined with a comma.
 */
export function storedLabel(
  value: unknown,
  options: DropdownOption[],
  renames: { from: string; to: string }[],
  multiple = false,
): string | undefined {
  if (multiple) {
    const tokens = dropdownTokens(value);
    if (!tokens.length) return undefined;
    const next: string[] = [];
    for (const token of tokens) {
      const renamed = renames.find(
        (rename) => rename.from.trim().toLowerCase() === token.trim().toLowerCase(),
      );
      const label = renamed ? renamed.to : canonicalOption(token, options);
      if (!label) return undefined;
      if (!next.includes(label)) next.push(label);
    }
    const joined = next.join(", ");
    return joined === cellText(value) ? undefined : joined;
  }
  const text = cellText(value);
  if (!trimmedText(text)) return undefined;
  const renamed = renames.find(
    (rename) => rename.from.trim().toLowerCase() === text.trim().toLowerCase(),
  );
  const next = renamed ? renamed.to : canonicalOption(text, options);
  if (!next || next === text) return undefined;
  return next;
}

function channel(hex: string, start: number): number {
  const parsed = Number.parseInt(hex.slice(start, start + 2), 16);
  const value = parsed / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  );
}

export function contrastRatio(background: string, foreground: string): number {
  const lighter = Math.max(luminance(background), luminance(foreground));
  const darker = Math.min(luminance(background), luminance(foreground));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Black or white, whichever clears 4.5:1 on this chip. Callers never pick a text color. */
export function chipTextColor(background: string): "#111111" | "#ffffff" {
  const black = contrastRatio(background, "#111111");
  const white = contrastRatio(background, "#ffffff");
  if (black >= 4.5 && white >= 4.5) return black >= white ? "#111111" : "#ffffff";
  if (black >= 4.5) return "#111111";
  if (white >= 4.5) return "#ffffff";
  return black >= white ? "#111111" : "#ffffff";
}

export function filteredOptions(options: DropdownOption[], query: string): DropdownOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}

type Range = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

function isCellRecord(value: unknown): value is { v?: unknown; f?: string; s?: unknown; t?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return "v" in value || "f" in value || "p" in value || "s" in value || "t" in value;
}

export type DropdownRuleHit = {
  options: DropdownOption[];
  multiple?: boolean;
  /** When false, an unknown token is left in the cell. */
  reject?: boolean;
};

export type DropdownRejection = {
  row: number;
  column: number;
  rejected: string[];
  labels: string[];
};

function asHit(hit: DropdownOption[] | DropdownRuleHit): DropdownRuleHit {
  return Array.isArray(hit) ? { options: hit, reject: true } : hit;
}

function paintCell(
  cell: { v?: unknown; f?: string; s?: unknown; t?: number },
  hit: DropdownOption[] | DropdownRuleHit,
  report?: (rejected: string[]) => void,
): boolean {
  if (cell.f) return false;
  const rule = asHit(hit);
  if (rule.multiple) {
    const tokens = dropdownTokens(cell.v);
    if (!tokens.length) return false;
    const kept: string[] = [];
    const rejected: string[] = [];
    for (const token of tokens) {
      const canon = canonicalOption(token, rule.options);
      if (canon) {
        if (!kept.includes(canon)) kept.push(canon);
      } else rejected.push(token);
    }
    if (rejected.length) report?.(rejected);
    if (rejected.length && kept.length === 0) return false;
    if (rejected.length && rule.reject === false) return false;
    const next = kept.join(", ");
    if (!next || next === cell.v) return false;
    cell.v = next;
    cell.t = 1;
    return true;
  }
  const next = canonicalOption(cell.v, rule.options);
  if (!next || next === cell.v) return false;
  cell.v = next;
  cell.t = 1;
  return true;
}

/**
 * Rewrite a set-range-values command so "Confirmed " lands as "Confirmed"
 * and picks up that option's chip. Invalid text is left for the red corner.
 */
export function rewriteListValues(
  params: { range?: Range; value?: unknown },
  optionsAt: (
    row: number,
    column: number,
  ) => DropdownOption[] | DropdownRuleHit | null,
  onReject?: (rejection: DropdownRejection) => void,
): boolean {
  const { range, value } = params;
  if (value == null) return false;
  let changed = false;
  const paint = (
    cell: { v?: unknown; f?: string; s?: unknown; t?: number },
    hit: DropdownOption[] | DropdownRuleHit,
    row: number,
    column: number,
  ) => {
    const rule = asHit(hit);
    return paintCell(cell, rule, (rejected) =>
      onReject?.({
        row,
        column,
        rejected,
        labels: rule.options.map((option) => option.label),
      }),
    );
  };
  if (Array.isArray(value)) {
    if (!range) return false;
    value.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, columnIndex) => {
        if (!isCellRecord(cell)) return;
        const hit = optionsAt(
          range.startRow + rowIndex,
          range.startColumn + columnIndex,
        );
        if (hit && paint(cell, hit, range.startRow + rowIndex, range.startColumn + columnIndex))
          changed = true;
      });
    });
    return changed;
  }
  if (isCellRecord(value)) {
    if (!range || range.startRow !== range.endRow || range.startColumn !== range.endColumn)
      return false;
    const hit = optionsAt(range.startRow, range.startColumn);
    return Boolean(hit && paint(value, hit, range.startRow, range.startColumn));
  }
  if (typeof value === "object") {
    for (const [rowKey, row] of Object.entries(value as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      for (const [columnKey, cell] of Object.entries(row as Record<string, unknown>)) {
        if (!isCellRecord(cell)) continue;
        const rowIndex = Number(rowKey);
        const columnIndex = Number(columnKey);
        const hit = optionsAt(rowIndex, columnIndex);
        if (hit && paint(cell, hit, rowIndex, columnIndex)) changed = true;
      }
    }
  }
  return changed;
}
