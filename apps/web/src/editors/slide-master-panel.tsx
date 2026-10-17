import { useState } from "react";
import type { Presentation } from "@suiteleaf/core";
import {
  addMasterImage,
  addMasterText,
  readMaster,
  removeMasterElement,
  setMasterBackground,
  updateMasterElement,
} from "./slide-master";

export function SlideMasterPanel({
  deck,
  onChange,
  onClose,
}: {
  deck: Presentation;
  onChange: (next: Presentation) => void;
  onClose: () => void;
}) {
  const master = readMaster(deck);
  const [text, setText] = useState("Garden club");
  return (
    <aside className="slide-side-panel" aria-label="Slide master">
      <header>
        <h2>Slide master</h2>
        <button type="button" aria-label="Close panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="slide-side-scroll">
        <p className="slide-side-note">
          Objects here sit behind every slide. A slide's own background covers the master color.
        </p>
        <label className="theme-field">
          Master background
          <input
            aria-label="Master background"
            type="color"
            value={master.background?.color || "#ffffff"}
            onChange={(event) => onChange(setMasterBackground(deck, event.target.value))}
          />
        </label>
        <label className="theme-field">
          Footer text
          <input
            aria-label="Master footer text"
            value={text}
            maxLength={200}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => onChange(addMasterText(deck, text.trim()))}
        >
          Add footer to master
        </button>
        <label className="theme-field">
          Logo
          <input
            aria-label="Master logo"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file || file.size > 2 * 1024 * 1024) return;
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === "string") onChange(addMasterImage(deck, reader.result));
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
        <ul className="animation-pane-list">
          {master.elements.map((el) => (
            <li key={el.id}>
              {el.type === "text" ? (
                <input
                  aria-label="Master text"
                  value={el.content || ""}
                  onChange={(event) =>
                    onChange(updateMasterElement(deck, el.id, { content: event.target.value }))
                  }
                />
              ) : (
                <span>{el.alt || "Image"}</span>
              )}
              <button type="button" onClick={() => onChange(removeMasterElement(deck, el.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
