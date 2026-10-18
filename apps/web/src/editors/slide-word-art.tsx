import { useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { SlideElement } from "@suiteleaf/core";
import { WORD_ART, type WordArtStyle } from "./slide-editing";

const LABELS: Record<WordArtStyle, string> = {
  blue: "Blue",
  gold: "Gold",
};

/** Outline width and color come from the saved stroke, not from the class name. */
export function wordArtProps(
  el: Pick<SlideElement, "wordArt" | "stroke" | "strokeWidth">,
): { className: string; style: CSSProperties } {
  if (!el.wordArt || !el.stroke) return { className: "", style: {} };
  return {
    className: " slide-word-art",
    style: {
      ["--word-outline" as string]: `${el.strokeWidth ?? 2}px ${el.stroke}`,
    },
  };
}

export function WordArtDialog({
  onCancel,
  onInsert,
}: {
  onCancel: () => void;
  onInsert: (text: string, style: WordArtStyle) => void;
}) {
  const [text, setText] = useState("");
  const [style, setStyle] = useState<WordArtStyle>("blue");
  const words = text.trim();
  return (
    <div
      className="gdocs-modal-overlay word-art-overlay"
      onClick={onCancel}
    >
      <form
        className="gdocs-dialog word-art-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Word art"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!words) return;
          onInsert(words, style);
        }}
      >
        <div className="dialog-header">
          <h2>Word art</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="floating-field">
            <label htmlFor="word-art-text">Text</label>
            <input
              id="word-art-text"
              value={text}
              autoFocus
              autoComplete="off"
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="floating-field">
            <label htmlFor="word-art-style">Style</label>
            <select
              id="word-art-style"
              value={style}
              onChange={(event) => setStyle(event.target.value as WordArtStyle)}
            >
              {(Object.keys(WORD_ART) as WordArtStyle[]).map((choice) => (
                <option key={choice} value={choice}>
                  {LABELS[choice]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn" disabled={!words}>
            Insert
          </button>
        </div>
      </form>
    </div>
  );
}
