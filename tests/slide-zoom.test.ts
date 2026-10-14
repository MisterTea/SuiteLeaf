import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile, type SlideFile } from "@suiteleaf/core";
import {
  documentZoom,
  rememberDocumentZoom,
} from "../apps/web/src/editors/doc-zoom";
import {
  rememberSpreadsheetZoom,
  spreadsheetZoom,
} from "../apps/web/src/editors/sheet-zoom";
import {
  attachSlideZoom,
  isSlideZoom,
  rememberSlideZoom,
  slideZoom,
} from "../apps/web/src/editors/slide-zoom";

const DOCUMENT_ZOOM_KEY = "suiteleaf.doc-zoom";
const SPREADSHEET_ZOOM_KEY = "suiteleaf.sheet-zoom";

describe("presentation zoom", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    // A previous test may have held a zoom for a file with no id.
    rememberSlideZoom("reset", "100%");
    rememberDocumentZoom("reset", "100%");
    rememberSpreadsheetZoom("reset", "100%");
    store.clear();
  });

  it("keeps 150% on deck A and leaves deck B, a document, and a spreadsheet alone", () => {
    for (const level of ["50%", "75%", "90%", "100%", "125%", "150%", "200%"]) {
      expect(isSlideZoom(level)).toBe(true);
    }
    expect(isSlideZoom("Fit")).toBe(false);

    rememberDocumentZoom("minutes", "100%");
    rememberSpreadsheetZoom("budget", "150%");
    const documentStore = localStorage.getItem(DOCUMENT_ZOOM_KEY);
    const spreadsheetStore = localStorage.getItem(SPREADSHEET_ZOOM_KEY);

    expect(slideZoom("deck-a")).toBe("100%");
    expect(slideZoom("deck-b")).toBe("100%");

    rememberSlideZoom("deck-a", "150%");

    expect(slideZoom("deck-a")).toBe("150%");
    expect(slideZoom("deck-b")).toBe("100%");
    expect(slideZoom("minutes")).toBe("100%");
    expect(slideZoom("budget")).toBe("100%");
    expect(documentZoom("minutes", 1280)).toBe("100%");
    expect(documentZoom("deck-a", 1280)).toBe("100%");
    expect(spreadsheetZoom("budget")).toBe("150%");
    expect(spreadsheetZoom("deck-a")).toBe("100%");
    expect(spreadsheetZoom("minutes")).toBe("100%");
    expect(localStorage.getItem(DOCUMENT_ZOOM_KEY)).toBe(documentStore);
    expect(localStorage.getItem(SPREADSHEET_ZOOM_KEY)).toBe(spreadsheetStore);
    expect(localStorage.getItem(DOCUMENT_ZOOM_KEY)).not.toContain("150%");
    expect(localStorage.getItem("suiteleaf.slide-zoom")).toContain("deck-a");
    expect(localStorage.getItem("suiteleaf.slide-zoom")).toContain("150%");
  });

  it("holds zoom in memory until an unsaved presentation receives an id", () => {
    rememberSlideZoom("", "150%");
    expect(slideZoom("")).toBe("150%");
    expect(slideZoom("deck-b")).toBe("100%");
    expect(documentZoom("", 1280)).toBe("100%");
    expect(spreadsheetZoom("")).toBe("100%");

    attachSlideZoom("deck-a");

    expect(slideZoom("deck-a")).toBe("150%");
    expect(slideZoom("deck-b")).toBe("100%");
    expect(slideZoom("")).toBe("100%");
    expect(documentZoom("deck-a", 1280)).toBe("100%");
    expect(spreadsheetZoom("deck-a")).toBe("100%");
  });

  it("does not write 150% into the slide text or the exported deck", () => {
    const file = createFile("slide", "Market") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    const title = slide.elements[0];
    title.content = "Market";
    const before = JSON.stringify(file);
    const box = {
      x: title.x,
      y: title.y,
      width: title.width,
      height: title.height,
    };

    rememberSlideZoom(file.id, "150%");

    expect(JSON.stringify(file)).toBe(before);
    expect(title.content).toBe("Market");
    expect({
      x: title.x,
      y: title.y,
      width: title.width,
      height: title.height,
    }).toEqual(box);
    expect(before).not.toContain("150%");
    expect(serializeFile(file)).toContain("Market");
    expect(serializeFile(file)).not.toContain("150%");
    expect(slideZoom(file.id)).toBe("150%");
    expect(documentZoom(file.id, 1280)).toBe("100%");
    expect(spreadsheetZoom(file.id)).toBe("100%");
  });
});
