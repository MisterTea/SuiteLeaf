import type {
  IDescriptionService,
  IEditorService,
  IShortcutService,
} from "@univerjs/preset-sheets-core";

const searchShortcut = "sheet.formula-embedding-editor.search_function.";

/** Suggested first, in this order, when they match what is typed. */
const everyday = [
  "SUM",
  "AVERAGE",
  "COUNT",
  "IF",
  "MIN",
  "MAX",
  "ROUND",
  "COUNTA",
  "SUMIF",
  "COUNTIF",
  "IFERROR",
  "VLOOKUP",
  "XLOOKUP",
  "TODAY",
  "CONCATENATE",
  "LEN",
  "AND",
  "OR",
  "ABS",
];

/** The name being typed just before the caret: "B6" in "=SUM(B2:B6", "" after ")". */
export function nameBeforeCaret(text: string) {
  return /[A-Za-z_][\w.]*$/.exec(text)?.[0] ?? "";
}

/** Whether a suggestion list made for `prefix` no longer matches the typed text. */
export function isStaleSuggestion(textBeforeCaret: string, prefix: string) {
  return nameBeforeCaret(textBeforeCaret).toUpperCase() !== prefix.toUpperCase();
}

/** Puts everyday functions first and keeps the rest in their original order. */
export function rankSuggestions<T extends { name: string }>(list: T[]) {
  const rank = (name: string) => {
    const i = everyday.indexOf(name.toUpperCase());
    return i < 0 ? everyday.length : i;
  };
  return [...list].sort((a, b) => rank(a.name) - rank(b.name));
}

export function rankFormulaSuggestions(descriptions: IDescriptionService) {
  const search = descriptions.getSearchListByNameFirstLetter.bind(descriptions);
  descriptions.getSearchListByNameFirstLetter = (text) => rankSuggestions(search(text));
}

/** The typed prefix each visible suggestion list was made for (its highlighted letters). */
function visiblePrefixes() {
  return [
    ...document.querySelectorAll(
      'ul[data-u-comp="sheets-formula-editor"] > li:first-child > span:first-child > span:first-child',
    ),
  ].map((e) => e.textContent ?? "");
}

// Univer refreshes its function suggestion list 300 ms after typing stops, yet
// Enter and Tab accept whatever list is on screen, so finishing "=SUM(C2:C6)"
// quickly after a pause on "C" would insert a suggestion. While the list no
// longer matches the typed name, Enter and Tab commit the cell as typed.
export function guardFormulaSuggestions(
  shortcuts: IShortcutService,
  editors: IEditorService,
  acceptKeys: number[],
) {
  const guarded = new WeakSet<object>();
  const stale = (editorId: string) => {
    const editor = editors.getEditor(editorId);
    const range = editor?.getSelectionRanges()[0];
    if (!editor || !range?.collapsed) return false;
    const text = editor.getDocumentData().body?.dataStream.slice(0, range.startOffset) ?? "";
    const prefixes = visiblePrefixes();
    return prefixes.length > 0 && prefixes.every((p) => isStaleSuggestion(text, p));
  };
  const guard = () => {
    for (const shortcut of shortcuts.getAllShortcuts()) {
      if (guarded.has(shortcut) || !shortcut.id.startsWith(searchShortcut)) continue;
      const { keyCode } = (shortcut.staticParameters ?? {}) as { keyCode?: number };
      if (keyCode === undefined || !acceptKeys.includes(keyCode)) continue;
      guarded.add(shortcut);
      const editorId = shortcut.id.slice(searchShortcut.length),
        precondition = shortcut.preconditions;
      shortcut.preconditions = (context) =>
        !stale(editorId) && (precondition?.(context) ?? true);
    }
  };
  const subscription = shortcuts.shortcutChanged$.subscribe(guard);
  return () => subscription.unsubscribe();
}
