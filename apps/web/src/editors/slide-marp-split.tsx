import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "suiteleaf.marpSplit";
/** Narrowest either pane may become, when the row is wide enough for both. */
const MIN_PANE_PX = 280;
const STEP = 0.02;
export const EVEN_MARP_SPLIT = 0.5;

/** The slide's share of the row, kept so neither pane drops below its minimum width. */
export function clampMarpSplit(split: number, rowWidth: number) {
  const min = rowWidth > 0 ? Math.min(EVEN_MARP_SPLIT, MIN_PANE_PX / rowWidth) : 0.2;
  return Math.min(1 - min, Math.max(min, split));
}

function storedSplit(key: string) {
  try {
    const value = Number(localStorage.getItem(key));
    return value > 0 && value < 1 ? value : EVEN_MARP_SPLIT;
  } catch {
    return EVEN_MARP_SPLIT;
  }
}

/** The slide's share of the row beside the markdown, remembered in this browser once a move ends. */
export function useMarpSplit(key = STORAGE_KEY) {
  const [split, setSplit] = useState(() => storedSplit(key));
  const update = useCallback((next: number, done: boolean) => {
    setSplit(next);
    if (!done) return;
    try {
      localStorage.setItem(key, String(Math.round(next * 1000) / 1000));
    } catch {
      // The split still applies until the page closes.
    }
  }, [key]);
  return [split, update] as const;
}

/**
 * The border between the slide and its markdown. Drag it, or focus it and use
 * the arrow keys (Shift for bigger steps, Home and End for the limits). A
 * double-click shares the row evenly again.
 */
export function MarpSplitHandle({
  split,
  onSplit,
  panes = ["Slide", "markdown"],
}: {
  split: number;
  onSplit: (split: number, done: boolean) => void;
  /** What the panes on either side are called, left first. */
  panes?: [string, string];
}) {
  const drag = useRef<{ left: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const rowOf = (handle: HTMLElement) => {
    const slide = handle.previousElementSibling?.getBoundingClientRect();
    const pane = handle.nextElementSibling?.getBoundingClientRect();
    if (!slide || !pane) return null;
    return { left: slide.left, width: pane.right - slide.left };
  };
  const end = (handle: HTMLElement) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    handle.parentElement?.classList.remove("marp-resizing");
    onSplit(split, true);
  };
  const percent = Math.round(split * 100);
  return (
    <div
      className={`marp-split-handle${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${panes[0].toLowerCase()} and ${panes[1].toLowerCase()} panes`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${panes[0]} ${percent}%, ${panes[1]} ${100 - percent}%`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const row = rowOf(event.currentTarget);
        if (!row) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.parentElement?.classList.add("marp-resizing");
        drag.current = row;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const row = drag.current;
        if (!row) return;
        onSplit(clampMarpSplit((event.clientX - row.left) / row.width, row.width), false);
      }}
      onPointerUp={(event) => end(event.currentTarget)}
      onPointerCancel={(event) => end(event.currentTarget)}
      onLostPointerCapture={(event) => end(event.currentTarget)}
      onDoubleClick={() => onSplit(EVEN_MARP_SPLIT, true)}
      onKeyDown={(event) => {
        const width = rowOf(event.currentTarget)?.width ?? 0;
        const step = event.shiftKey ? STEP * 5 : STEP;
        const next =
          event.key === "ArrowLeft"
            ? split - step
            : event.key === "ArrowRight"
              ? split + step
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 1
                  : null;
        if (next === null) return;
        event.preventDefault();
        onSplit(clampMarpSplit(next, width), true);
      }}
    />
  );
}
