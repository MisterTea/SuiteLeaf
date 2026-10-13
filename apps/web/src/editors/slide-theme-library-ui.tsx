import { useEffect, useRef, useState } from "react";
import type { SlideTheme } from "@suiteleaf/core";
import type { SaveThemeResult } from "./slide-theme-library";

function LibraryCard({
  theme,
  pressed,
  onHover,
  onApply,
}: {
  theme: SlideTheme;
  pressed: boolean;
  onHover: (theme: SlideTheme | null) => void;
  onApply: (theme: SlideTheme) => void;
}) {
  return (
    <button
      type="button"
      className="theme-card"
      aria-label={theme.name}
      aria-pressed={pressed}
      onMouseEnter={() => onHover(theme)}
      onFocus={() => onHover(theme)}
      onClick={() => onApply(theme)}
    >
      <span className="theme-card-slide" style={{ background: theme.background }}>
        <span className="theme-card-accent" style={{ background: theme.accent }} />
        <span
          className="theme-card-title"
          style={{ color: theme.headingColor, fontFamily: theme.headingFont }}
        >
          Title
        </span>
        <span
          className="theme-card-body"
          style={{ color: theme.bodyColor, fontFamily: theme.bodyFont }}
        >
          Body text
        </span>
      </span>
      <span className="theme-card-meta">
        <span className="theme-card-name">{theme.name}</span>
        <span className="theme-card-hex">{theme.accent.toUpperCase()}</span>
      </span>
    </button>
  );
}

/** Saved looks for this computer. Cards show the snapshot, not the open deck. */
export function ThemeLibrarySection({
  themes,
  current,
  canSave,
  onHover,
  onApply,
  onSave,
}: {
  themes: SlideTheme[];
  current?: SlideTheme;
  canSave: boolean;
  onHover: (theme: SlideTheme | null) => void;
  onApply: (theme: SlideTheme) => void;
  onSave: (name: string) => SaveThemeResult;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  const cancel = () => {
    setNaming(false);
    setName("");
    setError("");
  };
  const savedMatch = themes.find((theme) => theme.id === current?.id);
  const copyDrifted =
    !!savedMatch &&
    !!current &&
    (savedMatch.accent !== current.accent ||
      savedMatch.headingFont !== current.headingFont ||
      savedMatch.bodyFont !== current.bodyFont ||
      savedMatch.background !== current.background ||
      savedMatch.headingColor !== current.headingColor ||
      savedMatch.bodyColor !== current.bodyColor);

  return (
    <section className="theme-library" aria-label="Library">
      <h3>Library</h3>
      <p className="slide-side-note">
        Saved on this computer. Applying one copies it onto the deck.
      </p>
      {naming ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const result = onSave(name);
            if (!result.ok) {
              setError(result.error);
              inputRef.current?.focus();
              return;
            }
            setNotice(`${result.saved.name} is in the library.`);
            cancel();
          }}
        >
          <label className="theme-field">
            Name this look
            <input
              ref={inputRef}
              aria-label="Theme name"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
              }}
            />
          </label>
          {error ? (
            <p className="theme-library-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="theme-save-actions">
            <button type="submit" className="primary" disabled={!name.trim()}>
              Save
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="theme-save-open"
          disabled={!canSave}
          title={canSave ? "Save the current theme" : "Pick a theme first"}
          onClick={() => {
            setNotice("");
            setNaming(true);
          }}
        >
          Save to library
        </button>
      )}
      {notice ? <p className="transition-status">{notice}</p> : null}
      {copyDrifted && savedMatch ? (
        <p className="slide-side-note">
          This deck has its own copy. The library still has {savedMatch.name} at{" "}
          {savedMatch.accent.toUpperCase()}.
        </p>
      ) : null}
      {themes.length === 0 ? (
        naming ? null : <p className="slide-side-note">No saved themes yet.</p>
      ) : (
        <div className="theme-grid" onMouseLeave={() => onHover(null)}>
          {themes.map((theme) => (
            <LibraryCard
              key={theme.id}
              theme={theme}
              pressed={current?.id === theme.id}
              onHover={onHover}
              onApply={onApply}
            />
          ))}
        </div>
      )}
    </section>
  );
}
