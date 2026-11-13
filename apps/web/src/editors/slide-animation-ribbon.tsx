import { ArrowDown, ArrowUp, Play, Square, Star, X } from "lucide-react";
import type { Presentation, Slide } from "@suiteleaf/core";
import {
  SLIDE_ANIMATION_CHOICES,
  type SlideAnimationKind,
} from "./slide-fade-in";
import {
  animationGroups,
  animationGroupContains,
  changeAnimationEntry,
  type AnimationEntry,
} from "./slide-animation-editing";
import "./slide-animations.css";

export function AnimationTiming({
  entry,
  onChange,
  disabled = false,
}: {
  entry: AnimationEntry | undefined;
  onChange: (patch: {
    trigger?: "click" | "with" | "after";
    duration?: number;
  }) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="animation-timing" disabled={disabled || !entry}>
      <label>
        Start
        <select
          aria-label="Animation start"
          value={entry?.trigger ?? "click"}
          onChange={(e) =>
            onChange({ trigger: e.target.value as AnimationEntry["trigger"] })
          }
        >
          <option value="click">On click</option>
          <option value="with">With previous</option>
          <option value="after">After previous</option>
        </select>
      </label>
      <label>
        Duration
        <input
          aria-label="Animation duration"
          type="number"
          min="0"
          max="5"
          step="0.1"
          value={entry ? entry.ms / 1000 : ""}
          onChange={(e) => {
            if (e.target.value !== "")
              onChange({ duration: e.target.valueAsNumber * 1000 });
          }}
        />
        <span>s</span>
      </label>
    </fieldset>
  );
}

export function SlideAnimationRibbon({
  deck,
  slide,
  selectedElementId,
  selectedKey,
  readOnly,
  onChange,
  onPreview,
  playing,
  onStop,
  onClose,
  onApplyEffect,
}: {
  deck: Presentation;
  slide: Slide;
  selectedElementId: string | null;
  selectedKey: string | null;
  readOnly: boolean;
  onChange: (deck: Presentation) => void;
  onPreview: (key?: string) => void;
  playing: boolean;
  onStop: () => void;
  onClose: () => void;
  onApplyEffect: (kind: SlideAnimationKind) => void;
}) {
  const entries = animationGroups(slide);
  const entry =
    entries.find(
      (item) =>
        animationGroupContains(item, selectedElementId) &&
        item.key === selectedKey,
    ) ??
    entries.find((item) => animationGroupContains(item, selectedElementId));
  const element = slide.elements.find((el) => el.id === selectedElementId);
  const index = entry ? entries.indexOf(entry) : -1;
  const edit = (patch: Parameters<typeof changeAnimationEntry>[3]) => {
    if (!entry || readOnly) return;
    const next = changeAnimationEntry(deck, slide.id, entry.key, patch);
    if (next) onChange(next);
  };
  return (
    <section className="slide-animation-ribbon" aria-label="Animations ribbon">
      <button
        type="button"
        className="animation-preview-button"
        disabled={!entries.length}
        onClick={() => (playing ? onStop() : onPreview())}
      >
        {playing ? <Square size={23} /> : <Play size={23} />}
        <span>{playing ? "Stop preview" : "Preview"}</span>
      </button>
      <fieldset
        className="animation-effect-gallery"
        disabled={readOnly || !element}
        aria-label="Entrance effects"
      >
        <button
          type="button"
          aria-pressed={
            !element?.animation &&
            !entries.some((item) =>
              animationGroupContains(item, selectedElementId),
            )
          }
          onClick={() => {
            if (!element) return;
            let next = deck;
            for (const item of entries.filter((item) =>
              animationGroupContains(item, element.id),
            ))
              next =
                changeAnimationEntry(next, slide.id, item.key, {
                  remove: true,
                }) ?? next;
            if (next !== deck) onChange(next);
          }}
        >
          <X size={28} />
          <span>None</span>
        </button>
        {SLIDE_ANIMATION_CHOICES.map((choice) => (
          <button
            type="button"
            key={choice.kind}
            onMouseDown={(event) => event.preventDefault()}
            aria-pressed={element?.animation === choice.kind}
            onClick={() => {
              if (!element) return;
              onApplyEffect(choice.kind);
            }}
          >
            <Star
              size={30}
              className={`animation-effect-star ${choice.kind}`}
              fill="currentColor"
            />
            <span>
              {choice.kind === "fade-on-click" ? "Fade" : choice.label}
            </span>
          </button>
        ))}
        <legend>Entrance effects</legend>
      </fieldset>
      <AnimationTiming entry={entry} disabled={readOnly} onChange={edit} />
      <div className="animation-reorder">
        <button
          type="button"
          disabled={readOnly || index <= 0}
          onClick={() => edit({ move: -1 })}
        >
          <ArrowUp size={16} />
          Move earlier
        </button>
        <button
          type="button"
          disabled={readOnly || index < 0 || index === entries.length - 1}
          onClick={() => edit({ move: 1 })}
        >
          <ArrowDown size={16} />
          Move later
        </button>
      </div>
      <button type="button" className="animation-exit-mode" onClick={onClose}>
        Close animations
      </button>
      {!element && (
        <p className="animation-selection-hint">
          Select an object on the slide to add an effect.
        </p>
      )}
    </section>
  );
}
