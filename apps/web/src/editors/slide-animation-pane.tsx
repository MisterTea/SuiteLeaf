import { useState } from "react";
import type { Presentation, Slide } from "@suiteleaf/core";
import {
  SLIDE_ANIMATION_CHOICES,
  animationLabel,
  animationPreview,
  animationRows,
  reorderAnimation,
} from "./slide-fade-in";

export function AnimationPane({
  deck,
  slideId,
  slide,
  onChange,
  onClose,
  onSelect,
}: {
  deck: Presentation;
  slideId: string;
  slide: Slide | undefined;
  onChange: (next: Presentation) => void;
  onClose: () => void;
  onSelect: (elementId: string) => void;
}) {
  const rows = animationRows(slide);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = rows.find((row) => row.id === previewId);
  const motion = preview ? animationPreview(preview) : null;
  return (
    <aside className="slide-side-panel" aria-label="Animation pane">
      <header>
        <h2>Animation pane</h2>
        <button type="button" aria-label="Close panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="slide-side-scroll">
        <p className="slide-side-note">
          Click order for this slide. Objects that share a number appear together. An object marked after starts when the previous entrance finishes.
        </p>
        {rows.length === 0 ? (
          <p className="slide-side-note">No animations yet. Select an object, then Insert › Animation.</p>
        ) : (
          <ol className="animation-pane-list">
            {rows.map((row, index) => (
              <li key={row.id}>
                <button type="button" onClick={() => onSelect(row.id)}>
                  {row.click}. {row.label}
                </button>
                <span>
                  {animationLabel(row.kind)}
                  {row.trigger === "after" ? " after previous" : row.trigger === "with" ? " with previous" : ""}
                  {` · ${row.ms} ms`}
                </span>
                <button type="button" aria-label={`Preview ${row.label}`} onClick={() => setPreviewId(row.id)}>
                  Preview
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.label} earlier`}
                  disabled={index === 0}
                  onClick={() => {
                    const next = reorderAnimation(deck, slideId, row.id, -1);
                    if (next) onChange(next);
                  }}
                >
                  Up
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.label} later`}
                  disabled={index === rows.length - 1}
                  onClick={() => {
                    const next = reorderAnimation(deck, slideId, row.id, 1);
                    if (next) onChange(next);
                  }}
                >
                  Down
                </button>
              </li>
            ))}
          </ol>
        )}
        {motion && preview ? (
          <p className="slide-side-note">
            <span
              data-preview={preview.id}
              className={motion.className}
              style={{ animationDuration: `${motion.durationMs}ms` }}
            />
          </p>
        ) : null}
        <p className="slide-side-note">
          {SLIDE_ANIMATION_CHOICES.map((choice) => choice.label).join(", ")}
        </p>
      </div>
    </aside>
  );
}
