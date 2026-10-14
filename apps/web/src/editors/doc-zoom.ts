/** Zoom choices in the document toolbar. Fit follows the window. */
const ZOOM_LEVELS = [
  "Fit",
  "50%",
  "75%",
  "90%",
  "100%",
  "125%",
  "150%",
  "200%",
] as const;

export type DocumentZoom = (typeof ZOOM_LEVELS)[number];

const STORAGE_KEY = "suiteleaf.doc-zoom";

/**
 * Zoom for a document that does not have an id yet. It stays in memory until
 * that document receives an id, and it is never applied to a different file.
 */
let unsavedZoom: DocumentZoom | null = null;

export function isDocumentZoom(value: string): value is DocumentZoom {
  return (ZOOM_LEVELS as readonly string[]).includes(value);
}

/** A file with no stored zoom. Narrow windows start at Fit; others at 100%. */
export function defaultDocumentZoom(viewportWidth?: number): DocumentZoom {
  const width =
    viewportWidth ?? (typeof window === "undefined" ? 1024 : window.innerWidth);
  return width < 700 ? "Fit" : "100%";
}

function readStore(): Record<string, DocumentZoom> {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const store: Record<string, DocumentZoom> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (id && typeof value === "string" && isDocumentZoom(value))
        store[id] = value;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, DocumentZoom>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

/** Zoom for this file on this computer. A missing entry is the default. */
export function documentZoom(
  fileId: string,
  viewportWidth?: number,
): DocumentZoom {
  if (!fileId) return unsavedZoom ?? defaultDocumentZoom(viewportWidth);
  return readStore()[fileId] ?? defaultDocumentZoom(viewportWidth);
}

/** Remember a zoom for one file. Nothing is written into the document. */
export function rememberDocumentZoom(fileId: string, zoom: string) {
  if (!isDocumentZoom(zoom)) return;
  if (!fileId) {
    unsavedZoom = zoom;
    return;
  }
  const store = readStore();
  store[fileId] = zoom;
  writeStore(store);
  unsavedZoom = null;
}

/** Move a zoom held in memory onto a document that just received an id. */
export function attachDocumentZoom(fileId: string) {
  if (!fileId || unsavedZoom == null) return;
  const zoom = unsavedZoom;
  unsavedZoom = null;
  rememberDocumentZoom(fileId, zoom);
}
