/** Command search and shortcut formatting shared by every editor. */

export type CommandView = {
  id: string;
  label: string;
  path: string[];
  shortcut?: string;
  synonyms?: string[];
  group?: string;
  /** Set when the command is listed but cannot run. */
  disabledReason?: string;
};

export type KeyEvent = {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

type ParsedShortcut = {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

const MISSING: CommandView[] = [
  {
    id: "missing/word-count",
    label: "Word count",
    path: ["Tools"],
    synonyms: ["word count", "count", "wordcount", "count words", "words"],
    disabledReason: "SuiteLeaf doesn't have word count yet.",
  },
  {
    id: "missing/remove-duplicates",
    label: "Remove duplicates",
    path: ["Data"],
    synonyms: ["remove duplicates", "dedupe", "duplicates", "unique"],
    disabledReason: "SuiteLeaf doesn't have remove duplicates yet.",
  },
  {
    id: "missing/comment",
    label: "Comment",
    path: ["Insert"],
    synonyms: ["comment", "comments"],
    disabledReason: "SuiteLeaf doesn't have comments in this app yet.",
  },
];

/** Extra words people type instead of the menu label. */
export const COMMAND_SYNONYMS: Record<string, string[]> = {
  Strikethrough: ["strike", "strikethrough", "cross out", "line through"],
  "Find and replace": ["find", "replace", "search", "find and replace"],
  Link: ["link", "hyperlink", "url", "insert link"],
  "Page setup…": [
    "page numbers",
    "page number",
    "page setup",
    "margins",
    "header",
    "footer",
    "different first page",
    "first page",
  ],
  "Cell comment": ["comment", "comments", "note", "annotation"],
  "1 row": [
    "freeze",
    "freeze row",
    "freeze rows",
    "freeze header",
    "freeze the top row",
    "freeze top row",
    "freeze panes",
  ],
  "Search the menus": [
    "search menus",
    "tool finder",
    "command palette",
    "search the menus",
  ],
  "Keyboard shortcuts": ["shortcuts", "keyboard shortcuts", "hotkeys"],
  "Create a filter": ["filter", "create a filter", "remove filter"],
  "Duplicate slide": ["dup", "duplicate", "duplicate slide", "copy slide"],
  "Delete slide": ["delete slide", "remove slide"],
  Undo: ["undo"],
  Redo: ["redo"],
};

const PENDING_REASONS: Record<string, string> = {
  "Spelling and grammar": "SuiteLeaf doesn't have spelling yet.",
  Spelling: "SuiteLeaf doesn't have spelling yet.",
  "Function: SUM": "SuiteLeaf doesn't have Insert Function yet.",
  "Function: AVERAGE": "SuiteLeaf doesn't have Insert Function yet.",
  "Text box": "SuiteLeaf doesn't have this yet.",
  Image: "SuiteLeaf doesn't have this yet.",
  Shape: "SuiteLeaf doesn't have this yet.",
  "Text: Bold": "SuiteLeaf doesn't have this yet.",
  "Text: Italic": "SuiteLeaf doesn't have this yet.",
  "Align & indent": "SuiteLeaf doesn't have this yet.",
  Cut: "SuiteLeaf doesn't have this yet.",
  Copy: "SuiteLeaf doesn't have this yet.",
  Paste: "SuiteLeaf doesn't have this yet.",
};

const PARAGRAPH_LABELS = new Set([
  "Align left",
  "Align center",
  "Align right",
  "Justify",
  "Bulleted list",
  "Numbered list",
  "Page break",
]);

export function commandGroup(path: string[], label: string, explicit?: string) {
  if (explicit) return explicit;
  if (label === "Keyboard shortcuts" || label === "Search the menus")
    return "Navigation";
  if (PARAGRAPH_LABELS.has(label)) return "Paragraphs";
  if (path[0] === "File") return "Files";
  if (path[0] === "Format") return "Text formatting";
  if (path[0] === "View" || path.includes("Freeze") || path.includes("Show"))
    return "Navigation";
  return "Editing";
}

export function pendingReason(label: string) {
  return PENDING_REASONS[label] ?? "SuiteLeaf doesn't have this yet.";
}

export function synonymsFor(label: string, extra?: string[]) {
  return [...(COMMAND_SYNONYMS[label] ?? []), ...(extra ?? [])];
}

/** True for the empty handlers left on menu items another storyboard still owns. */
export function isUnimplemented(fn: () => void) {
  try {
    const text = Function.prototype.toString.call(fn).replace(/\s+/g, "");
    return (
      text === "()=>{}" ||
      text === "()=>undefined" ||
      text === "()=>{;}" ||
      text === "function(){}"
    );
  } catch {
    return false;
  }
}

export function normalizeQuery(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9+/=]+/g, " ")
    .trim();
}

function tokensOf(value: string) {
  return normalizeQuery(value).split(" ").filter(Boolean);
}

function tokenScore(token: string, label: string, path: string, synonyms: string[]) {
  if (!token) return 0;
  let best = 0;
  const labelWords = label.split(" ").filter(Boolean);
  if (label === token || label.startsWith(token)) best = Math.max(best, 90);
  if (labelWords.some((word) => word.startsWith(token))) best = Math.max(best, 80);
  if (synonyms.some((synonym) => synonym === token || tokensOf(synonym).some((word) => word.startsWith(token))))
    best = Math.max(best, 86);
  if (path.split(" ").some((word) => word.startsWith(token))) best = Math.max(best, 55);
  const haystack = `${label} ${path} ${synonyms.join(" ")}`;
  if (haystack.includes(token)) best = Math.max(best, 30);
  return best;
}

export function commandScore(command: CommandView, query: string) {
  const q = normalizeQuery(query);
  if (!q) return 1;
  const label = normalizeQuery(command.label);
  const path = normalizeQuery(command.path.join(" "));
  const synonyms = (command.synonyms ?? []).map((synonym) => normalizeQuery(synonym));
  if (label === q || synonyms.some((synonym) => synonym === q)) return 200;
  const tokens = q.split(" ").filter(Boolean);
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(token, label, path, synonyms);
    if (!score) return 0;
    total += score;
  }
  return total + Math.max(0, 24 - label.length);
}

function coveredByRealCommand(commands: CommandView[], missing: CommandView) {
  const name = normalizeQuery(missing.label);
  return commands.some((command) => {
    const label = normalizeQuery(command.label);
    if (label.includes(name)) return true;
    return (command.synonyms ?? []).some((synonym) => {
      const text = normalizeQuery(synonym);
      return text === name || text.includes(name);
    });
  });
}

export function searchCommands(
  commands: CommandView[],
  query: string,
  recentIds: string[] = [],
) {
  const q = normalizeQuery(query);
  const missing = q
    ? MISSING.filter(
        (command) =>
          commandScore(command, q) > 0 && !coveredByRealCommand(commands, command),
      )
    : [];
  const pool = [...commands, ...missing];
  const ranked = pool
    .map((command) => ({ command, score: commandScore(command, q) }))
    .filter((entry) => entry.score > 0);
  if (!q) {
    const order = new Map(recentIds.map((id, index) => [id, index]));
    const usable = ranked.filter((entry) => !entry.command.disabledReason);
    usable.sort((a, b) => {
      const ai = order.has(a.command.id) ? order.get(a.command.id)! : 1000;
      const bi = order.has(b.command.id) ? order.get(b.command.id)! : 1000;
      if (ai !== bi) return ai - bi;
      return a.command.label.localeCompare(b.command.label);
    });
    return usable.slice(0, 8).map((entry) => entry.command);
  }
  ranked.sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label));
  return ranked.slice(0, 12).map((entry) => entry.command);
}

function parseShortcut(spec: string): ParsedShortcut {
  const parsed: ParsedShortcut = {
    key: "",
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
  };
  for (const part of spec.split("+").map((item) => item.trim()).filter(Boolean)) {
    const lower = part.toLowerCase();
    if (["mod", "cmd", "command"].includes(lower)) parsed.mod = true;
    else if (["ctrl", "control"].includes(lower)) parsed.ctrl = true;
    else if (["alt", "option", "opt"].includes(lower)) parsed.alt = true;
    else if (lower === "shift") parsed.shift = true;
    else parsed.key = shortcutKeyName(part);
  }
  // A lone Ctrl (Ctrl+Z) means the platform modifier. Ctrl+Alt+M stays Control.
  if (parsed.ctrl && !parsed.mod && !parsed.alt) {
    parsed.mod = true;
    parsed.ctrl = false;
  }
  return parsed;
}

function shortcutKeyName(part: string) {
  const lower = part.toLowerCase();
  if (lower === "esc") return "escape";
  if (lower === "return") return "enter";
  if (lower.length === 1) return lower;
  return lower;
}

function eventKeyName(event: KeyEvent) {
  const code = event.code ?? "";
  if (code === "Slash") return "/";
  if (code === "Equal") return "=";
  if (code === "Period") return ".";
  if (code === "Comma") return ",";
  if (code === "Backslash") return "\\";
  if (code === "Minus") return "-";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("F") && /^F\d+$/.test(code)) return code.toLowerCase();
  if (code === "Enter" || code === "NumpadEnter") return "enter";
  if (code === "Escape") return "escape";
  if (code === "Space") return " ";
  return event.key.toLowerCase();
}

export function eventMatchesShortcut(spec: string, event: KeyEvent, mac: boolean) {
  const parsed = parseShortcut(spec);
  if (!parsed.key || eventKeyName(event) !== parsed.key) return false;
  if (parsed.alt !== event.altKey || parsed.shift !== event.shiftKey) return false;
  if (mac) {
    if (parsed.mod !== event.metaKey || parsed.ctrl !== event.ctrlKey) return false;
  } else if ((parsed.mod || parsed.ctrl) !== event.ctrlKey || event.metaKey) return false;
  return true;
}

function prettyKey(key: string) {
  if (key === "enter") return "Enter";
  if (key === "escape") return "Esc";
  if (key === "arrowleft") return "←";
  if (key === "arrowright") return "→";
  if (key === "arrowup") return "↑";
  if (key === "arrowdown") return "↓";
  if (key === "delete") return "Delete";
  if (key === " ") return "Space";
  if (/^f\d+$/.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Platform glyphs: ⌘ ⌥ ⇧ on a Mac, Ctrl Alt Shift elsewhere. */
export function formatShortcut(spec: string, mac: boolean) {
  const parsed = parseShortcut(spec);
  const key = prettyKey(parsed.key);
  if (mac) {
    return `${parsed.ctrl ? "⌃" : ""}${parsed.mod ? "⌘" : ""}${parsed.alt ? "⌥" : ""}${parsed.shift ? "⇧" : ""}${key}`;
  }
  const parts: string[] = [];
  if (parsed.mod || parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (key) parts.push(key);
  return parts.join("+");
}

export type ShortcutRow = { label: string; shortcut: string; group: string };

export function extraShortcuts(kind: "doc" | "sheet" | "slide", mac: boolean): ShortcutRow[] {
  const common: ShortcutRow[] = [
    { label: "Save", shortcut: "Mod+S", group: "Files" },
    { label: "Search the menus", shortcut: "Alt+/", group: "Navigation" },
    { label: "Keyboard shortcuts", shortcut: "Mod+/", group: "Navigation" },
    { label: "Focus the menu bar", shortcut: "Ctrl+Alt+M", group: "Navigation" },
    { label: "Focus the menu bar", shortcut: "F10", group: "Navigation" },
  ];
  if (kind === "sheet")
    return [
      ...common,
      { label: "Start editing a cell", shortcut: "F2", group: "Formulas" },
      { label: "Toggle absolute reference", shortcut: "F4", group: "Formulas" },
      { label: "Insert SUM", shortcut: mac ? "Mod+Alt+=" : "Alt+=", group: "Formulas" },
      { label: "Confirm and move down", shortcut: "Enter", group: "Formulas" },
    ];
  if (kind === "slide")
    return [
      ...common,
      { label: "Next slide", shortcut: "ArrowRight", group: "Slideshow" },
      { label: "Previous slide", shortcut: "ArrowLeft", group: "Slideshow" },
      { label: "Black screen", shortcut: "B", group: "Slideshow" },
      { label: "White screen", shortcut: "W", group: "Slideshow" },
      { label: "Speaker notes", shortcut: "S", group: "Slideshow" },
      { label: "Exit the slideshow", shortcut: "Escape", group: "Slideshow" },
      { label: "Next thumbnail", shortcut: "ArrowDown", group: "Filmstrip" },
      { label: "Previous thumbnail", shortcut: "ArrowUp", group: "Filmstrip" },
      { label: "Move slide up", shortcut: "Mod+ArrowUp", group: "Filmstrip" },
      { label: "Move slide down", shortcut: "Mod+ArrowDown", group: "Filmstrip" },
    ];
  return common;
}

const GROUP_ORDER = [
  "Text formatting",
  "Paragraphs",
  "Editing",
  "Formulas",
  "Slideshow",
  "Filmstrip",
  "Navigation",
  "Files",
];

export function groupShortcuts(rows: ShortcutRow[]) {
  const groups = new Map<string, ShortcutRow[]>();
  for (const row of rows) {
    const list = groups.get(row.group) ?? [];
    const key = `${row.label}\0${row.shortcut}`;
    if (!list.some((item) => `${item.label}\0${item.shortcut}` === key)) list.push(row);
    groups.set(row.group, list);
  }
  return [...groups.entries()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a[0]);
    const bi = GROUP_ORDER.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/**
 * Shortcuts the palette itself should run. Editors already handle the rest
 * (Tiptap marks, Univer's grid, and the slideshow's Cmd/Ctrl+Enter).
 */
export function appHandlesShortcut(
  spec: string | undefined,
  kind: "doc" | "sheet" | "slide",
  pending: boolean,
) {
  if (!spec || pending) return false;
  const parsed = parseShortcut(spec);
  const id = [
    parsed.mod ? "mod" : "",
    parsed.ctrl ? "ctrl" : "",
    parsed.alt ? "alt" : "",
    parsed.shift ? "shift" : "",
    parsed.key,
  ]
    .filter(Boolean)
    .join("+");
  if (kind === "doc" && ["mod+shift+h", "mod+k", "mod+\\", "mod+enter"].includes(id))
    return true;
  if (kind === "sheet" && id === "mod+\\") return true;
  if (kind === "slide" && ["mod+z", "mod+y", "mod+d", "mod+m"].includes(id)) return true;
  return false;
}

export function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

const RECENT_KEY = "suiteleaf-recent-commands";

export function readRecentCommands() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string) {
  const next = [id, ...readRecentCommands().filter((item) => item !== id)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}
