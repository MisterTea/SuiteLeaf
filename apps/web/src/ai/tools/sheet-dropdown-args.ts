import { currentRequest } from "../guard";
import { canonicalOption, DROPDOWN_COLORS, dropdownTokens } from "../../editors/sheet-dropdowns";

const DROPDOWN_COLOR_ALIAS: Record<string, string> = {
  green: "#b7e1cd",
  amber: "#ffe599",
  yellow: "#ffe599",
  gold: "#ffe599",
  grey: "#d9d9d9",
  gray: "#d9d9d9",
  blue: "#c9daf8",
  red: "#f4cccc",
  purple: "#d9d2e9",
};

function knownDropdownColor(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return true;
  return Object.keys(DROPDOWN_COLOR_ALIAS).some((name) => text === name || text.includes(name));
}

export function dropdownColor(input: string | undefined, index: number): string {
  const text = input?.trim().toLowerCase() ?? "";
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  const named = Object.entries(DROPDOWN_COLOR_ALIAS).find(([name]) => text === name || (text && text.includes(name)));
  return named?.[1] ?? DROPDOWN_COLORS[index % DROPDOWN_COLORS.length].value;
}

export function dropdownColorName(hex: string): string {
  return Object.entries(DROPDOWN_COLOR_ALIAS).find(([, value]) => value === hex.toLowerCase())?.[0] ?? hex;
}

function flagOf(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (/^(true|yes|1)$/.test(text)) return true;
    if (/^(false|no|0)$/.test(text)) return false;
  }
  return undefined;
}

function cleanArg(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** "Maybe=amber" sticks a colour to a name. A plain list stays positional. */
export function namedColorMap(colors: string[] | undefined): Map<string, string> | null {
  if (!colors?.length) return null;
  const map = new Map<string, string>();
  for (const item of colors) {
    const parsed = parseRewrite(item);
    if (!parsed || !knownDropdownColor(parsed.to)) return null;
    map.set(parsed.from.trim().toLowerCase(), dropdownColor(parsed.to, map.size));
  }
  return map;
}

export function isPersonName(name: string): boolean {
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(name.trim());
}

/** "Priya Shah=Training" and "Evening=Night" from the user's own words. Colour pairs are left out. */
export function quotedPairs(): { from: string; to: string }[] {
  const found: { from: string; to: string }[] = [];
  for (const match of currentRequest().text.matchAll(/"([^"=]+)=([^"]+)"/g)) {
    const from = match[1].trim();
    const to = match[2].trim();
    if (!from || !to || knownDropdownColor(to)) continue;
    if (found.some((item) => item.from.toLowerCase() === from.toLowerCase() && item.to.toLowerCase() === to.toLowerCase())) continue;
    found.push({ from, to });
  }
  return found;
}

export function splitChoices(value: string, multiple: boolean): string[] {
  const text = value.trim();
  if (!text) return [];
  if (!multiple) return [text];
  return dropdownTokens(text.replace(/\band\b/gi, ","));
}

export function requestSentences(): string[] {
  return currentRequest().text.split(/(?<=\.)\s+/);
}

function rangeNeedles(range: string): string[] {
  const compact = range.replace(/\$/g, "").replace(/\s+/g, "");
  const body = compact.replace(/^.*!/, "");
  return [...new Set([compact, body].map((item) => item.toLowerCase()).filter((item) => item.length >= 3))];
}

function sentenceHasRange(sentence: string, range: string): boolean {
  const compact = sentence.replace(/\s+/g, "").toLowerCase();
  return rangeNeedles(range).some((needle) => compact.includes(needle));
}

function sentenceHasOptions(sentence: string, options: string[]): boolean {
  if (!options.length) return false;
  const hay = sentence.toLowerCase();
  return options.every((label) => hay.includes(label.toLowerCase()));
}

/** "Statuses ! A2 : A5" reads as Statuses!A2:A5; the words around it stay apart. */
const closeRangeGaps = (sentence: string) => sentence.replace(/\s*([!:])\s*/g, "$1");

export function sourceInSentence(sentence: string): string {
  const match = /(?<![\w!])([A-Za-z][A-Za-z0-9_]*)!(\$?[A-Za-z]{1,3}\$?\d+:\$?[A-Za-z]{1,3}\$?\d+)/.exec(closeRangeGaps(sentence));
  return match ? `${match[1]}!${match[2].replace(/\$/g, "")}` : "";
}

export function multipleInSentence(sentence: string): boolean {
  return /\bmultiple\s*[:=]?\s*true\b/i.test(sentence) || /\b(?:allow )?more than one\b/i.test(sentence);
}

export function concreteInSentence(sentence: string): string {
  const match = closeRangeGaps(sentence).match(/(?:^|[^!\w])([A-Za-z]{1,3}\d+:[A-Za-z]{1,3}\d+)/);
  return match?.[1] ?? "";
}

/** The user's sentence for this call: the range they named, or the sentence that lists these options. */
export function sentenceForCall(range: string, options: string[]): string {
  const sentences = requestSentences();
  const byRange = sentences.filter((sentence) => sentenceHasRange(sentence, range));
  const byOptions = sentences.filter((sentence) => sentenceHasOptions(sentence, options));
  if (byOptions.length && !byRange.some((sentence) => sentenceHasOptions(sentence, options)))
    return byOptions.find((sentence) => concreteInSentence(sentence)) ?? byOptions[0];
  if (byRange.length === 1) return byRange[0];
  return byOptions[0] ?? byRange[0] ?? "";
}

function splitLoose(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitLoose);
  if (value == null || value === "") return [];
  if (typeof value === "object") return [];
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) return splitLoose(parsed);
    } catch {
      /* A comma-separated list. */
    }
  }
  if (/[,;\n]|\band\b/i.test(text))
    return text
      .split(/[,;\n]|\band\b/i)
      .map((part) => part.replace(/^["']|["']$/g, "").trim())
      .filter(Boolean);
  return [text.replace(/^["']|["']$/g, "").trim()];
}

function cleanDropLabel(label: string) {
  return label.replace(/[“”"]/g, "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function peelOption(label: string): { label: string; color?: string } {
  const text = cleanDropLabel(label);
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(text);
  if (paren && knownDropdownColor(paren[2])) return { label: cleanDropLabel(paren[1]), color: paren[2].trim() };
  const inn = /^(.*?)\s+in\s+([A-Za-z]+)\s*$/i.exec(text);
  if (inn && knownDropdownColor(inn[2])) return { label: cleanDropLabel(inn[1]), color: inn[2].trim() };
  return { label: text };
}

function optionItems(value: unknown): { label: string; color?: string }[] {
  if (Array.isArray(value)) return value.flatMap(optionItems);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const label = record.label ?? record.name ?? record.option ?? record.text;
    const color = record.color ?? record.colour;
    if (typeof label === "string") return [{ label: label.trim(), ...(typeof color === "string" ? { color } : {}) }];
    return [];
  }
  if (typeof value === "string" && /^\s*[[{]/.test(value)) {
    try {
      return optionItems(JSON.parse(value));
    } catch {
      /* A comma-separated list. */
    }
  }
  return splitLoose(value).map(peelOption);
}

function splitFixes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitFixes);
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(([from, to]) =>
      typeof to === "string" || typeof to === "number" ? [`${from}=${to}`] : [],
    );
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return splitFixes(JSON.parse(text));
    } catch {
      /* A comma-separated list of from=to pairs. */
    }
  }
  return text
    .split(/,(?=\s*[^,=]+(?:=|->|→|\bto\b))/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseRewrite(item: string): { from: string; to: string } | null {
  const match = /^(.+?)\s*(?:=|->|→|:|\bto\b)\s*(.+)$/i.exec(item.trim());
  if (!match) return null;
  const from = match[1].replace(/^["']|["']$/g, "").trim();
  const to = match[2].replace(/^["']|["']$/g, "").trim();
  if (!from || !to) return null;
  return { from, to };
}

const FIX_NOISE =
  /^(every|cells?|values?|that|say|says|said|the|a|an|all|those|them|it|with|or|and|including|different|capitalisation|capitalization|extra|spaces?|spacing|spellings?|status|column)$/i;

/** "Change yes and tbc to Confirmed" or "Rename Tentative to Maybe" in the user's own words. */
export function rewritesFromRequest(options: { label: string }[]): { from: string; to: string }[] {
  const found: { from: string; to: string }[] = [];
  const re = /\b(?:change|replace|rename|map|fix|turn)\s+(.+?)\s+to\s+([^.,\n]+?)(?=\s+so\b|\s+including\b|[.,;\n]|$)/gi;
  for (const match of currentRequest().text.matchAll(re)) {
    const to = canonicalOption(match[2], options);
    if (!to) continue;
    const sources = match[1]
      .replace(
        /\b(?:every|including|different|capitalisation|capitalization|extra|spaces?|spacing|and|or|cells?|values?|that says?|spellings?)\b/gi,
        ",",
      )
      .split(/[,/]/)
      .map((part) => part.replace(/^["']|["']$/g, "").trim())
      .filter((part) => part && !FIX_NOISE.test(part) && part.split(/\s+/).length <= 4);
    for (const from of sources) {
      if (canonicalOption(from, options) === to) continue;
      found.push({ from, to });
    }
  }
  return found;
}

/** "The choices are Confirmed in green, Maybe in amber, …" when the user listed them. */
export function choicesFromRequest(): { label: string; color?: string }[] {
  const match = /\b(?:choices|options)\b[^.]*?\bare\s+([^.]+)/i.exec(currentRequest().text);
  if (!match) return [];
  return optionItems(match[1]).filter((item) => item.label);
}

/** "Set Priya Shah's status to Waitlist", or "If Priya Shah is on the roster, set her status to Waitlist". */
export function assignsFromRequest(options: { label: string }[]): { name: string; label: string }[] {
  const found: { name: string; label: string }[] = [];
  const push = (name: string, raw: string) => {
    const label = canonicalOption(raw, options);
    const who = name
      .replace(/(?:'s|\u2019s)$/i, "")
      .replace(/^(?:If|When|Once|Since|Because|And|But|So|Then)\s+/, "")
      .trim();
    if (!label || !who || found.some((item) => item.name.toLowerCase() === who.toLowerCase())) return;
    found.push({ name: who, label });
  };
  const direct = /\b[Ss]et\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)(?:'s|\u2019s)?\s+(?:[Ss]tatus\s+)?[Tt]o\s+([^.,\n]+)/g;
  for (const match of currentRequest().text.matchAll(direct)) push(match[1], match[2]);
  const roster = /\b([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)\s+is\s+on\s+the\s+(?:roster|sheet|list)\b[^.]{0,160}?\b[Ss]et\s+(?:her|his|their)\s+status\s+to\s+([^.,\n]+)/g;
  for (const match of currentRequest().text.matchAll(roster)) push(match[1], match[2]);
  return found;
}

export function normalizeDropdownArgs(args: Record<string, unknown>): Record<string, unknown> {
  const peeled = optionItems(args.options ?? args.choices ?? args.list ?? args.option);
  const options = peeled.map((item) => item.label).filter(Boolean);
  let colors = splitLoose(args.colors ?? args.colours ?? args.color ?? args.colour);
  if (!colors.length && peeled.some((item) => item.color)) colors = peeled.map((item) => item.color ?? "");
  const fixes = splitFixes(args.fixes ?? args.fix ?? args.replace ?? args.replacements ?? args.rename ?? args.renames);
  const assign = splitFixes(args.assign ?? args.assignments ?? args.people);
  const range = cleanArg(args.range ?? args.cells ?? args.column ?? args.header);
  const reject = args.reject ?? args.reject_other ?? args.rejectOther;
  const flag =
    typeof reject === "boolean"
      ? reject
      : typeof reject === "string" && /^(false|no|warn|warning|allow)$/i.test(reject.trim())
        ? false
        : reject === undefined
          ? undefined
          : true;
  const source = cleanArg(args.source ?? args.from_range ?? args.from ?? args.list_source).replace(/\s+/g, "");
  const add = cleanArg(args.add ?? args.append ?? args.extend);
  const renameSource = cleanArg(args.rename_source ?? args.renameSource);
  const insertBlank = flagOf(args.insert_blank ?? args.insertBlank ?? args.blank_row);
  const multiple = flagOf(args.multiple ?? args.allow_multiple ?? args.allowMultiple ?? args.multi);
  return {
    range,
    options,
    ...(colors.some((color) => color.trim()) ? { colors } : {}),
    ...(fixes.length ? { fixes } : {}),
    ...(assign.length ? { assign } : {}),
    ...(flag !== undefined ? { reject: flag } : {}),
    ...(source ? { source } : {}),
    ...(add ? { add } : {}),
    ...(renameSource ? { rename_source: renameSource } : {}),
    ...(insertBlank ? { insert_blank: true } : {}),
    ...(multiple ? { multiple: true } : {}),
  };
}
