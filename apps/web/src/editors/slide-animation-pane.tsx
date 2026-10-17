import type { Presentation, Slide } from "@suiteleaf/core";
import {
  SLIDE_ANIMATION_CHOICES,
  animationLabel,
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
          Click order for this slide. Objects that share a number appear together.
        </p>
        {rows.length === 0 ? (
          <p className="slide-side-note">No animations yet. Select an object, then Insert › Animation.</p>
        ) : (
          <ol className="animation-pane-list">
            {rows.map((row, index) => (
              <li key={row.id}>
                <button type="button" onClick={() => onSelect(row.id)}>
                  {index + 1}. {row.label}
                </button>
                <span>{animationLabel(row.kind)}</span>
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
        <p className="slide-side-note">
          {SLIDE_ANIMATION_CHOICES.map((choice) => choice.label).join(", ")}
        </p>
      </div>
    </aside>
  );
}
