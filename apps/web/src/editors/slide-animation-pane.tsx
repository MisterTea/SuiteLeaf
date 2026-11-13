import { Play, Star, Trash2 } from "lucide-react";
import type { Presentation, Slide } from "@suiteleaf/core";
import { animationLabel } from "./slide-fade-in";
import {
  animationGroups,
  animationGroupContains,
  changeAnimationEntry,
} from "./slide-animation-editing";

export function AnimationPane({
  deck,
  slideId,
  slide,
  onChange,
  onClose,
  onSelect,
  selectedElementId,
  selectedKey,
  onSelectEntry,
  onPreview,
  readOnly = false,
}: {
  deck: Presentation;
  slideId: string;
  slide: Slide | undefined;
  onChange: (next: Presentation) => void;
  onClose: () => void;
  onSelect: (elementId: string) => void;
  selectedElementId?: string | null;
  selectedKey?: string | null;
  onSelectEntry?: (key: string) => void;
  onPreview?: (key?: string) => void;
  readOnly?: boolean;
}) {
  const rows = animationGroups(slide);
  const change = (
    key: string,
    patch: Parameters<typeof changeAnimationEntry>[3],
  ) => {
    if (readOnly) return;
    const next = changeAnimationEntry(deck, slideId, key, patch);
    if (next) onChange(next);
  };
  return (
    <aside
      className="slide-side-panel slide-animation-pane"
      aria-label="Animation pane"
    >
      <header>
        <h2>Animations</h2>
        <button type="button" aria-label="Close panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="slide-side-scroll">
        <button
          type="button"
          className="animation-play-all"
          disabled={!rows.length}
          onClick={() => onPreview?.()}
        >
          <Play size={16} fill="currentColor" />
          Play All
        </button>
        {rows.length === 0 ? (
          <p className="slide-side-note">
            No animations yet. Select an object, then choose an entrance effect
            in Animations.
          </p>
        ) : (
          <ol className="animation-pane-list">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className={
                  animationGroupContains(row, selectedElementId) &&
                  (!selectedKey || row.key === selectedKey)
                    ? "animation-row-selected"
                    : ""
                }
              >
                <button
                  type="button"
                  title={row.label}
                  aria-pressed={
                    animationGroupContains(row, selectedElementId) &&
                    (!selectedKey || row.key === selectedKey)
                  }
                  onClick={() => {
                    onSelect(row.id);
                    onSelectEntry?.(row.key);
                  }}
                >
                  <span className="animation-row-number">{row.click}.</span>{" "}
                  <Star size={16} fill="currentColor" aria-hidden="true" />
                  <span className="animation-row-label">{row.label}</span>
                </button>
                <span className="animation-row-detail">
                  {row.exit
                    ? "Disappear"
                    : row.kind === "fade-on-click"
                      ? "Fade"
                      : animationLabel(row.kind)}{" "}
                  ·{" "}
                  {row.trigger === "after"
                    ? "After previous"
                    : row.trigger === "with"
                      ? "With previous"
                      : "On click"}{" "}
                  · {row.ms / 1000} s
                </span>
                <div className="animation-row-actions">
                  <button
                    type="button"
                    aria-label={`Preview ${row.label}`}
                    onClick={() => onPreview?.(row.key)}
                  >
                    <Play size={13} />
                    Preview
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${row.label} earlier`}
                    disabled={readOnly || index === 0}
                    onClick={() => change(row.key, { move: -1 })}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${row.label} later`}
                    disabled={readOnly || index === rows.length - 1}
                    onClick={() => change(row.key, { move: 1 })}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${row.label} animation`}
                    disabled={readOnly}
                    onClick={() => change(row.key, { remove: true })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="slide-side-note">
          Numbers show the slide’s click order. Select an animation to change
          its start and duration in the ribbon.
        </p>
      </div>
    </aside>
  );
}
