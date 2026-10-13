import {
  documentPageSettings,
  pageDimensions,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { letterheadLiveEvent } from "./letterhead-live";

/**
 * Paper size is drawn while Page setup is open. Orientation, the header
 * and footer wording, and every other field stay on the saved page.
 * Live margins and letterhead distances are applied beside this.
 */
export function livePaperSize(
  base: PageSettings,
  draft: PageSettings,
): PageSettings {
  const size = draft.size === "a4" || draft.size === "letter" ? draft.size : base.size;
  if (size === base.size) return base;
  return { ...base, size };
}

function inches(px: number): string {
  const rounded = Math.round((px / 96) * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  const text = rounded.toFixed(2);
  return text.endsWith("0") ? text.slice(0, -1) : text;
}

/** The size drawn on the page, in the same inches as the sheet. */
export function paperSizeCaption(settings: PageSettings): string {
  const { width, height } = pageDimensions(settings);
  const name = settings.size === "a4" ? "A4" : "Letter";
  return `${name}, ${inches(width)} × ${inches(height)} in`;
}

const previewFrame = (() => {
  const letter = pageDimensions(
    documentPageSettings({ type: "doc", attrs: { pageSettings: { size: "letter" } } }),
  );
  const a4 = pageDimensions(
    documentPageSettings({ type: "doc", attrs: { pageSettings: { size: "a4" } } }),
  );
  return {
    width: Math.max(letter.width, a4.width),
    height: Math.max(letter.height, a4.height),
  };
})();

/**
 * One zoom for both Letter and A4, so choosing a size changes the sheet's
 * shape instead of scaling each size to the same width.
 */
export function paperPreviewZoom(
  viewportWidth: number,
  viewportHeight: number,
): number {
  const width = viewportWidth - 16;
  const height = viewportHeight - 16;
  if (!(width > 80) || !(height > 80)) return 1;
  return Math.min(1, width / previewFrame.width, height / previewFrame.height);
}

/** Paper size for the open dialog. Null means draw the saved page again. */
export function publishLivePaper(
  root: HTMLElement,
  settings: PageSettings | null,
): void {
  const next =
    settings?.size === "a4" || settings?.size === "letter" ? settings.size : "";
  if ((root.dataset.paperLive ?? "") === next) return;
  if (next) root.dataset.paperLive = next;
  else delete root.dataset.paperLive;
  root.dispatchEvent(new Event(letterheadLiveEvent));
}

export function readLivePaper(root: HTMLElement): { size: "letter" | "a4" } | null {
  const raw = root.dataset.paperLive;
  if (raw !== "letter" && raw !== "a4") return null;
  return { size: raw };
}
