import { useState } from "react";
import {
  editSlideObject,
  moveReadingOrder,
  readingOrder,
  slideAccessNotes,
  mediaCaptionNotes,
  mediaPictureNotes,
  slideChecks,
  slideObjectLines,
  tableFieldRows,
  tableFieldText,
  type SlidePiece,
} from "@suiteleaf/core";

type SlideObject = {
  id: string;
  type: string;
  alt?: string;
  caption?: string;
  src?: string;
  poster?: string;
  decorative?: boolean;
};

/** Objects the slide checker understands. Other kinds are counted as skipped. */
export function piecesForAccess(elements: SlideObject[]): {
  pieces: SlidePiece[];
  skipped: number;
} {
  const pieces: SlidePiece[] = [];
  let skipped = 0;
  for (const element of elements) {
    if (
      element.type === "text" ||
      element.type === "image" ||
      element.type === "shape" ||
      element.type === "table" ||
      element.type === "video" ||
      element.type === "audio"
    ) {
      pieces.push({
        id: element.id,
        type: element.type,
        alt: element.alt,
        decorative: element.decorative,
      });
    } else skipped += 1;
  }
  return { pieces, skipped };
}

export function SlideAccessPanel({
  elements,
  order: stored,
  texts = {},
  tables = {},
  title,
  background,
  textColor,
  onEdit,
  onMove,
}: {
  elements: SlideObject[];
  order?: string[];
  texts?: Record<string, string>;
  tables?: Record<string, string[][]>;
  title?: string;
  background?: string;
  textColor?: string;
  onEdit?: (pieces: SlidePiece[], texts: Record<string, string>) => void;
  onMove?: (order: string[]) => void;
}) {
  const { pieces, skipped } = piecesForAccess(elements);
  const lines = slideObjectLines(pieces, texts, stored);
  const [draft, setDraft] = useState<{ id: string; value: string; note: string } | null>(null);
  const notes = slideAccessNotes(pieces, stored);
  const checks =
    title !== undefined || background !== undefined || textColor !== undefined
      ? slideChecks({
          title: title ?? "",
          background: background ?? "#ffffff",
          text: textColor ?? "#111111",
        })
      : [];
  const captions = mediaCaptionNotes(elements);
  const pictures = mediaPictureNotes(elements);
  const order = readingOrder(pieces, stored);
  const described = pieces.filter(
    (piece) =>
      piece.type === "image" || piece.type === "shape" || piece.type === "video" || piece.type === "audio",
  );
  return (
    <section className="access-notes" aria-label="Slide accessibility">
      <h2>Slide accessibility</h2>
      <p>Reading order: {order.ids.length ? order.ids.join(", ") : "nothing on this slide"}.</p>
      {described.map((piece) => (
        <label key={`decorative-${piece.id}`}>
          <input
            type="checkbox"
            aria-label={`Decorative ${piece.type} ${piece.id}`}
            checked={Boolean(piece.decorative)}
            onChange={(event) => {
              onEdit?.(
                pieces.map((item) =>
                  item.id === piece.id ? { ...item, decorative: event.target.checked } : item,
                ),
                texts,
              );
            }}
          />
          Decorative
        </label>
      ))}
      {draft?.note ? <p>{draft.note}</p> : null}
      <ul>
        {lines.map((line, index) => (
          <li key={line.id}>
            <label>
              {line.type} {line.id}
              {line.type === "table" ? (
                <textarea
                  aria-label={`${line.type} ${line.id}`}
                  value={
                    draft?.id === line.id
                      ? draft.value
                      : tables[line.id]
                        ? tableFieldText(tables[line.id])
                        : line.text
                  }
                  onChange={(event) => {
                    const columns = tables[line.id]?.[0]?.length ?? 0;
                    const parsed = tableFieldRows(event.target.value, columns);
                    if ("error" in parsed) {
                      setDraft({ id: line.id, value: event.target.value, note: parsed.error });
                      return;
                    }
                    setDraft(null);
                    const edited = editSlideObject(pieces, texts, line.id, event.target.value);
                    onEdit?.(edited.pieces, edited.texts);
                  }}
                />
              ) : (
                <input
                  aria-label={`${line.type} ${line.id}`}
                  value={draft?.id === line.id ? draft.value : line.text}
                  onChange={(event) => {
                    const edited = editSlideObject(pieces, texts, line.id, event.target.value);
                    onEdit?.(edited.pieces, edited.texts);
                  }}
                />
              )}
            </label>
            {onMove ? (
              <>
                <button
                  type="button"
                  aria-label={`Move ${line.type} ${index + 1} earlier`}
                  disabled={index === 0}
                  onClick={() => onMove(moveReadingOrder(pieces, stored, line.id, "earlier"))}
                >
                  Earlier
                </button>
                <button
                  type="button"
                  aria-label={`Move ${line.type} ${index + 1} later`}
                  disabled={index === lines.length - 1}
                  onClick={() => onMove(moveReadingOrder(pieces, stored, line.id, "later"))}
                >
                  Later
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {skipped > 0 ? (
        <p>Other objects on this slide are not checked here.</p>
      ) : null}
      {notes.length === 0 && checks.length === 0 && captions.length === 0 && pictures.length === 0 ? (
        <p>No notes for this slide.</p>
      ) : (
        <ul>
          {captions.map((message) => (
            <li key={message}>{message}</li>
          ))}
          {pictures.map((message) => (
            <li key={message}>{message}</li>
          ))}
          {checks.map((note) => (
            <li key={note.rule}>{note.message}</li>
          ))}
          {notes.map((note) => (
            <li key={`${note.rule}-${note.id}`}>{note.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
