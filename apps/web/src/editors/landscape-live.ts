import type { PageSettings } from "@suiteleaf/core/document-layout";
import { letterheadLiveEvent } from "./letterhead-live";

/**
 * Orientation is drawn while Page setup is open. Paper size, margins,
 * letterhead distances, and header and footer wording are applied beside
 * this. Cancel drops the draft and the saved page returns.
 */
export function liveOrientation(
  base: PageSettings,
  draft: PageSettings,
): PageSettings {
  if (draft.landscape !== true && draft.landscape !== false) return base;
  if (draft.landscape === base.landscape) return base;
  return { ...base, landscape: draft.landscape };
}

/** Orientation for the open dialog. Null means draw the saved page again. */
export function publishLiveOrientation(
  root: HTMLElement,
  settings: PageSettings | null,
): void {
  const next =
    settings == null ? "" : settings.landscape ? "landscape" : "portrait";
  if ((root.dataset.orientLive ?? "") === next) return;
  if (next) root.dataset.orientLive = next;
  else delete root.dataset.orientLive;
  root.dispatchEvent(new Event(letterheadLiveEvent));
}

export function readLiveOrientation(
  root: HTMLElement,
): { landscape: boolean } | null {
  const raw = root.dataset.orientLive;
  if (raw !== "landscape" && raw !== "portrait") return null;
  return { landscape: raw === "landscape" };
}
