import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { SlideTheme } from "@suiteleaf/core";
import {
  THEME_FONTS,
  TRANSITION_CHOICES,
  normalizeHex,
  type TransitionType,
} from "./slide-theme";
import type { SaveThemeResult } from "./slide-theme-library";
import { ThemeLibrarySection } from "./slide-theme-library-ui";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function AccentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="theme-accent-row">
      <input
        type="color"
        aria-label="Accent colour"
        value={normalizeHex(value) ?? "#000000"}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
      <input
        type="text"
        aria-label="Accent hex"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const next = normalizeHex(e.target.value);
          if (next) onChange(next);
        }}
      />
    </div>
  );
}

export function SlideDesignPanel({
  mode,
  onClose,
  themes,
  current,
  resolve,
  onHoverTheme,
  onApplyTheme,
  onCustomize,
  library,
  onSaveToLibrary,
  duration,
  onDuration,
  scope,
  onScope,
  selectedCount,
  slideCount,
  chosen,
  onPickTransition,
  onApplyAll,
  onPlay,
  status,
}: {
  mode: "theme" | "transition";
  onClose: () => void;
  themes: SlideTheme[];
  current?: SlideTheme;
  resolve: (theme: SlideTheme) => SlideTheme;
  onHoverTheme: (theme: SlideTheme | null) => void;
  onApplyTheme: (theme: SlideTheme) => void;
  onCustomize: (patch: Partial<SlideTheme>) => void;
  library: SlideTheme[];
  onSaveToLibrary: (name: string) => SaveThemeResult;
  duration: number;
  onDuration: (seconds: number) => void;
  scope: "all" | "selected";
  onScope: (scope: "all" | "selected") => void;
  selectedCount: number;
  slideCount: number;
  chosen: TransitionType | null;
  onPickTransition: (type: TransitionType) => void;
  onApplyAll: () => void;
  onPlay: () => void;
  status: string;
}) {
  return (
    <aside className="slide-side-panel" aria-label={mode === "theme" ? "Theme" : "Transition"}>
      <header>
        <h2>{mode === "theme" ? "Theme" : "Transition"}</h2>
        <button type="button" aria-label="Close panel" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="slide-side-scroll">
        {mode === "theme" ? (
          <>
            <p className="slide-side-note">
              One background, two fonts, and an accent. Hover to preview the
              current slide, then click to restyle the whole deck.
            </p>
            <div
              className="theme-grid"
              onMouseLeave={() => onHoverTheme(null)}
            >
              {themes.map((theme) => {
                const shown = resolve(theme);
                return (
                  <button
                    key={theme.id}
                    type="button"
                    className="theme-card"
                    aria-label={shown.name}
                    aria-pressed={current?.id === theme.id}
                    onMouseEnter={() => {
                      // A custom accent is typed in the fields below. Hovering a
                      // card while that field is focused would preview another
                      // theme over the colour just chosen.
                      if (document.activeElement?.closest(".theme-customize"))
                        return;
                      onHoverTheme(shown);
                    }}
                    onFocus={() => {
                      if (document.activeElement?.closest(".theme-customize"))
                        return;
                      onHoverTheme(shown);
                    }}
                    onClick={() => onApplyTheme(shown)}
                  >
                    <span
                      className="theme-card-slide"
                      style={{ background: shown.background }}
                    >
                      <span
                        className="theme-card-accent"
                        style={{ background: shown.accent }}
                      />
                      <span
                        className="theme-card-title"
                        style={{
                          color: shown.headingColor,
                          fontFamily: shown.headingFont,
                        }}
                      >
                        Title
                      </span>
                      <span
                        className="theme-card-body"
                        style={{
                          color: shown.bodyColor,
                          fontFamily: shown.bodyFont,
                        }}
                      >
                        Body text
                      </span>
                    </span>
                    <span className="theme-card-name">{shown.name}</span>
                  </button>
                );
              })}
            </div>
            {current ? (
              <p className="transition-status">
                {current.name} is on every slide. Accent {current.accent.toUpperCase()},
                headings in {current.headingFont}, body in {current.bodyFont}.
              </p>
            ) : null}
            <ThemeLibrarySection
              themes={library}
              current={current}
              canSave={!!current}
              onHover={onHoverTheme}
              onApply={onApplyTheme}
              onSave={onSaveToLibrary}
            />
            <div
              className="theme-customize"
              onMouseEnter={() => onHoverTheme(null)}
              onFocus={() => onHoverTheme(null)}
            >
              <h3>Customize</h3>
              {current ? (
                <>
                  <div className="theme-field">
                    Accent colour
                    <AccentField
                      value={current.accent}
                      onChange={(accent) => onCustomize({ accent })}
                    />
                  </div>
                  <label className="theme-field">
                    Heading font
                    <select
                      aria-label="Heading font"
                      value={current.headingFont}
                      onChange={(e) => onCustomize({ headingFont: e.target.value })}
                    >
                      {THEME_FONTS.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="theme-field">
                    Body font
                    <select
                      aria-label="Body font"
                      value={current.bodyFont}
                      onChange={(e) => onCustomize({ bodyFont: e.target.value })}
                    >
                      {THEME_FONTS.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <p className="slide-side-note">Pick a theme, then adjust it here.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="slide-side-note">
              All slides is already selected, so the next choice lands on the
              whole deck. A range of slides uses just that range.
            </p>
            <div className="transition-scope" role="group" aria-label="Which slides">
              <button
                type="button"
                aria-pressed={scope === "all"}
                onClick={() => onScope("all")}
              >
                All slides
              </button>
              <button
                type="button"
                aria-pressed={scope === "selected"}
                onClick={() => onScope("selected")}
              >
                Selected ({selectedCount})
              </button>
            </div>
            <div className="transition-types" role="group" aria-label="Transition">
              {TRANSITION_CHOICES.map((choice) => (
                <button
                  key={choice.type}
                  type="button"
                  aria-pressed={chosen === choice.type}
                  onClick={() => onPickTransition(choice.type)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <label className="theme-field">
              Duration, {duration.toFixed(1)} s
              <input
                type="range"
                aria-label="Duration"
                min={0.1}
                max={2}
                step={0.1}
                value={duration}
                onChange={(e) => onDuration(Number(e.target.value))}
              />
            </label>
            <div className="transition-actions">
              <button type="button" className="primary" onClick={onApplyAll}>
                Apply to all slides
              </button>
              <button type="button" onClick={onPlay}>
                Play
              </button>
            </div>
            {status ? <p className="transition-status">{status}</p> : null}
            <p className="slide-side-note">
              {slideCount} slides. Thumbnails show an icon where a transition
              will play.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
