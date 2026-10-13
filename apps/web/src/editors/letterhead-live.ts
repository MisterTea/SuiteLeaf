import {
  edgeDistanceError,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

/**
 * Header and footer distances are drawn while Page setup is open.
 * Every other field, including the margins, stays on the saved page until
 * Apply. A distance Page setup would refuse is not drawn.
 */
export function liveEdgeDistances(
  saved: PageSettings,
  draft: PageSettings,
): PageSettings {
  const headerFromEdge =
    edgeDistanceError("header", draft.headerFromEdge) == null
      ? draft.headerFromEdge
      : saved.headerFromEdge;
  const footerFromEdge =
    edgeDistanceError("footer", draft.footerFromEdge) == null
      ? draft.footerFromEdge
      : saved.footerFromEdge;
  if (
    headerFromEdge === saved.headerFromEdge &&
    footerFromEdge === saved.footerFromEdge
  )
    return saved;
  return { ...saved, headerFromEdge, footerFromEdge };
}

export const letterheadLiveEvent = "suiteleaf-letterhead-live";

/** Distances for the open dialog. Null means draw the saved page again. */
export function publishLiveEdges(
  root: HTMLElement,
  settings: PageSettings | null,
): void {
  const next = settings
    ? `${settings.headerFromEdge},${settings.footerFromEdge}`
    : "";
  if ((root.dataset.letterheadLive ?? "") === next) return;
  if (next) root.dataset.letterheadLive = next;
  else delete root.dataset.letterheadLive;
  root.dispatchEvent(new Event(letterheadLiveEvent));
}

export function readLiveEdges(root: HTMLElement): {
  headerFromEdge: number;
  footerFromEdge: number;
} | null {
  const raw = root.dataset.letterheadLive;
  if (!raw) return null;
  const [headerFromEdge, footerFromEdge] = raw.split(",").map(Number);
  if (!Number.isFinite(headerFromEdge) || !Number.isFinite(footerFromEdge))
    return null;
  return { headerFromEdge, footerFromEdge };
}
