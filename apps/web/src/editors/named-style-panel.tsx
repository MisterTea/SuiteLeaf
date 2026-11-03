import { useState } from "react";

export type NamedStyleRow = { id: string; name: string; fontSize?: number };

/** Change the size of one named style. The document is updated by the caller. */
export function NamedStylePanel({
  styles,
  onSize,
  onImport,
  characterStyles,
  onApplyCharacter,
  onMatch,
  onApply,
  onClose,
}: {
  styles: NamedStyleRow[];
  onSize: (id: string, fontSize: number) => void;
  onImport?: (template: { attrs?: Record<string, unknown> | null }) => void;
  characterStyles?: { id: string; name: string }[];
  onApplyCharacter?: (id: string) => void;
  /** Store the selection's bold and size on this style. Returns the status sentence. */
  onMatch?: (id: string) => string;
  /** Write this style onto the current paragraph. Returns the status sentence. */
  onApply?: (id: string) => string;
  onClose: () => void;
}) {
  const [styleId, setStyleId] = useState(styles[0]?.id ?? "");
  const current = styles.find((style) => style.id === styleId) ?? styles[0];
  const [size, setSize] = useState(String(current?.fontSize ?? 18));
  const [note, setNote] = useState("");
  const [characterId, setCharacterId] = useState(characterStyles?.[0]?.id ?? "");
  return (
    <section className="access-notes" aria-label="Named styles">
      <h2>Named styles</h2>
      {styles.length === 0 ? (
        <p>This document has no named styles.</p>
      ) : (
        <>
          <label>
            Style
            <select
              aria-label="Style name"
              value={current?.id ?? ""}
              onChange={(event) => {
                const next = styles.find((style) => style.id === event.target.value);
                setStyleId(event.target.value);
                setSize(String(next?.fontSize ?? 18));
              }}
            >
              {styles.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Size
            <input
              aria-label="Style size"
              value={size}
              onChange={(event) => setSize(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const fontSize = Number(size);
              if (!current || !Number.isFinite(fontSize)) return;
              onSize(current.id, fontSize);
            }}
          >
            Update style
          </button>
          {onMatch && current ? (
            <button type="button" onClick={() => setNote(onMatch(current.id))}>
              Match the selection
            </button>
          ) : null}
          {onApply && current ? (
            <button type="button" onClick={() => setNote(onApply(current.id))}>
              Use this style
            </button>
          ) : null}
        </>
      )}
      {onImport ? (
        <label>
          Import styles
          <input
            aria-label="Import styles"
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(text);
                } catch {
                  setNote("That file is not a style template.");
                  return;
                }
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                  setNote("That file is not a style template.");
                  return;
                }
                onImport(parsed as { attrs?: Record<string, unknown> | null });
                setNote("Styles from the template were added.");
              });
            }}
          />
        </label>
      ) : null}
      {onApplyCharacter && characterStyles && characterStyles.length > 0 ? (
        <>
          <label>
            Character style
            <select
              aria-label="Character style"
              value={characterStyles.some((style) => style.id === characterId) ? characterId : characterStyles[0].id}
              onChange={(event) => setCharacterId(event.target.value)}
            >
              {characterStyles.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              const id = characterStyles.some((style) => style.id === characterId)
                ? characterId
                : characterStyles[0].id;
              onApplyCharacter(id);
              setNote("That character style was applied to the selection.");
            }}
          >
            Use character style
          </button>
        </>
      ) : null}
      {note ? <p>{note}</p> : null}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </section>
  );
}
