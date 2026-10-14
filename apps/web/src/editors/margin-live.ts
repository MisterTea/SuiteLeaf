import {
  pageMarginError,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { liveOrientation } from "./landscape-live";
import { liveLetterheadText } from "./letterhead-text-live";
import { letterheadLiveEvent, liveEdgeDistances } from "./letterhead-live";
import { livePageNumbers } from "./page-number-live";
import { livePaperSize } from "./paper-size-live";

const marginEdges = [
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
] as const;

/**
 * Body margins are drawn while Page setup is open. Header and footer
 * distances stay on the letterhead preview: a new margin does not move them.
 * A margin Page setup would refuse stays on the saved page. Paper size,
 * orientation, header and footer wording, and the page-number switch are
 * drawn beside this.
 */
export function liveMargins(base: PageSettings, draft: PageSettings): PageSettings {
  let next: PageSettings | null = null;
  for (const edge of marginEdges) {
    if (pageMarginError(draft[edge]) != null) continue;
    if (draft[edge] === base[edge]) continue;
    next ??= { ...base };
    next[edge] = draft[edge];
  }
  return next ?? base;
}

/** What the page shows while Page setup is open. Cancel uses the saved page. */
export function livePageSettings(
  saved: PageSettings,
  draft: PageSettings,
): PageSettings {
  return livePageNumbers(
    liveLetterheadText(
      liveOrientation(
        livePaperSize(liveMargins(liveEdgeDistances(saved, draft), draft), draft),
        draft,
      ),
      draft,
    ),
    draft,
  );
}

/** Margins for the open dialog, top then right then bottom then left. */
export function publishLiveMargins(
  root: HTMLElement,
  settings: PageSettings | null,
): void {
  const next = settings
    ? [
        settings.marginTop,
        settings.marginRight,
        settings.marginBottom,
        settings.marginLeft,
      ].join(",")
    : "";
  if ((root.dataset.marginLive ?? "") === next) return;
  if (next) root.dataset.marginLive = next;
  else delete root.dataset.marginLive;
  root.dispatchEvent(new Event(letterheadLiveEvent));
}

export function readLiveMargins(root: HTMLElement): {
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
} | null {
  const raw = root.dataset.marginLive;
  if (!raw) return null;
  const [marginTop, marginRight, marginBottom, marginLeft] = raw
    .split(",")
    .map(Number);
  if (
    !Number.isFinite(marginTop) ||
    !Number.isFinite(marginRight) ||
    !Number.isFinite(marginBottom) ||
    !Number.isFinite(marginLeft)
  )
    return null;
  return { marginTop, marginRight, marginBottom, marginLeft };
}
