/** Zoom choices in the slide editor. Same percentages as a spreadsheet. */
const ZOOM_LEVELS = ["50%", "75%", "90%", "100%", "125%", "150%", "200%"] as const;

export type SlideZoom = (typeof ZOOM_LEVELS)[number];

/**
 * Separate from suiteleaf.doc-zoom and suiteleaf.sheet-zoom so a presentation
 * cannot change a document or a spreadsheet.
 */
const STORAGE_KEY = "suiteleaf.slide-zoom";

/**
 * Zoom for a presentation that does not have an id yet. It stays in memory
 * until that presentation receives an id, and it is never applied to a
 * different file.
 */
let unsavedZoom: SlideZoom | null = null;

export function isSlideZoom(value: string): value is SlideZoom {
  return (ZOOM_LEVELS as readonly string[]).includes(value);
}

/** A presentation with no stored zoom opens at 100%. */
export function defaultSlideZoom(): SlideZoom {
  return "100%";
}

function readStore(): Record<string, SlideZoom> {
  try {
    const raw = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const store: Record<string, SlideZoom> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (id && typeof value === "string" && isSlideZoom(value))
        store[id] = value;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, SlideZoom>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

/** Zoom for this presentation on this computer. A missing entry is 100%. */
export function slideZoom(fileId: string): SlideZoom {
  if (!fileId) return unsavedZoom ?? defaultSlideZoom();
  return readStore()[fileId] ?? defaultSlideZoom();
}

/** Remember a zoom for one presentation. Nothing is written into the deck. */
export function rememberSlideZoom(fileId: string, zoom: string) {
  if (!isSlideZoom(zoom)) return;
  if (!fileId) {
    unsavedZoom = zoom;
    return;
  }
  const store = readStore();
  store[fileId] = zoom;
  writeStore(store);
  unsavedZoom = null;
}

/** Move a zoom held in memory onto a presentation that just received an id. */
export function attachSlideZoom(fileId: string) {
  if (!fileId || unsavedZoom == null) return;
  const zoom = unsavedZoom;
  unsavedZoom = null;
  rememberSlideZoom(fileId, zoom);
}
