import { createPortal } from "react-dom";
import { isSlmediaUri, slmediaHashFromUri, type Presentation } from "@suiteleaf/core";
import { mediaBlobStore } from "../media-blob-store";

/** Video files referenced as `slmedia://` anywhere in the deck, in first-seen order. */
export function videoSlmediaHashes(
  deck: Pick<Presentation, "slideOrder" | "slides">,
): string[] {
  const hashes: string[] = [];
  const seen = new Set<string>();
  for (const id of deck.slideOrder) {
    const slide = deck.slides[id];
    if (!slide) continue;
    for (const el of slide.elements) {
      if (el.type !== "video" || !el.src || !isSlmediaUri(el.src)) continue;
      const hash = slmediaHashFromUri(el.src);
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      hashes.push(hash);
    }
  }
  return hashes;
}

export function formatByteProgress(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface VideoGateState {
  completed: number;
  total: number;
  loadedBytes: number;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onPresentAnyway: () => void;
}

/** Download every deck video that is not already in the local media cache. */
export async function downloadDeckVideos(
  deck: Pick<Presentation, "slideOrder" | "slides">,
  options: {
    itemId?: string;
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number, loadedBytes: number) => void;
  },
): Promise<{ needed: number; failed: string[] }> {
  const hashes = videoSlmediaHashes(deck);
  const result = await mediaBlobStore.downloadMissing(hashes, {
    itemId: options.itemId,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  return { needed: result.total, failed: result.failed };
}

/** Shown while Present waits for videos that are not on this device yet. */
export function VideoDownloadDialog({ gate }: { gate: VideoGateState }) {
  const done = gate.total > 0 ? Math.min(gate.completed, gate.total) : 0;
  const label = gate.error
    ? gate.error
    : `Downloading videos for the slideshow (${done} of ${gate.total})`;
  return createPortal(
    <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div
        className="gdocs-dialog node-dialog drive-opening-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Downloading videos"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-body drive-opening">
          <label>
            {label}
            <progress value={gate.error ? done : done} max={Math.max(gate.total, 1)} />
          </label>
          <p>
            {formatByteProgress(gate.loadedBytes)} saved on this device.
            {gate.error ? " You can retry, or present without the videos that failed." : ""}
          </p>
        </div>
        <div className="dialog-footer">
          {gate.error ? (
            <button type="button" className="dialog-primary-btn" onClick={gate.onRetry}>
              Retry
            </button>
          ) : null}
          {gate.error ? (
            <button type="button" className="dialog-text-btn" onClick={gate.onPresentAnyway}>
              Present anyway
            </button>
          ) : null}
          <button type="button" className="dialog-text-btn" onClick={gate.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
