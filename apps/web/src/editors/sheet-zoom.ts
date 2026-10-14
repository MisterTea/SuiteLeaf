/** Zoom choices in the spreadsheet toolbar. There is no Fit option. */
const ZOOM_LEVELS = ["50%", "75%", "90%", "100%", "125%", "150%", "200%"] as const;

export type SpreadsheetZoom = (typeof ZOOM_LEVELS)[number];

/** Separate from suiteleaf.doc-zoom so a spreadsheet cannot change a document. */
const STORAGE_KEY = "suiteleaf.sheet-zoom";

/**
 * Zoom for a spreadsheet that does not have an id yet. It stays in memory
 * until that spreadsheet receives an id, and it is never applied to a
 * different file.
 */
let unsavedZoom: SpreadsheetZoom | null = null;

export function isSpreadsheetZoom(value: string): value is SpreadsheetZoom {
  return (ZOOM_LEVELS as readonly string[]).includes(value);
}

/** A spreadsheet with no stored zoom opens at 100%. */
export function defaultSpreadsheetZoom(): SpreadsheetZoom {
  return "100%";
}

function readStore(): Record<string, SpreadsheetZoom> {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const store: Record<string, SpreadsheetZoom> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (id && typeof value === "string" && isSpreadsheetZoom(value))
        store[id] = value;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, SpreadsheetZoom>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

/** Zoom for this spreadsheet on this computer. A missing entry is 100%. */
export function spreadsheetZoom(fileId: string): SpreadsheetZoom {
  if (!fileId) return unsavedZoom ?? defaultSpreadsheetZoom();
  return readStore()[fileId] ?? defaultSpreadsheetZoom();
}

/** Remember a zoom for one spreadsheet. Nothing is written into the cells. */
export function rememberSpreadsheetZoom(fileId: string, zoom: string) {
  if (!isSpreadsheetZoom(zoom)) return;
  if (!fileId) {
    unsavedZoom = zoom;
    return;
  }
  const store = readStore();
  store[fileId] = zoom;
  writeStore(store);
  unsavedZoom = null;
}

/** Move a zoom held in memory onto a spreadsheet that just received an id. */
export function attachSpreadsheetZoom(fileId: string) {
  if (!fileId || unsavedZoom == null) return;
  const zoom = unsavedZoom;
  unsavedZoom = null;
  rememberSpreadsheetZoom(fileId, zoom);
}
