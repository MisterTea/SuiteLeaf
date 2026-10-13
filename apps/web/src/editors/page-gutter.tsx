import { useState } from "react";
import {
  defaultPageSettings,
  gutterAccepted,
  pageSideInsets,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

/** Facing-page sketch of where the staple room goes. */
function MiniSheet({
  label,
  pageNumber,
  gutterPx,
}: {
  label: string;
  pageNumber: number;
  gutterPx: number;
}) {
  const width = 104;
  const height = 134;
  const scale = width / 816;
  const settings = { ...defaultPageSettings, gutter: gutterPx };
  const insets = pageSideInsets(settings, pageNumber);
  const margin = settings.margin * scale;
  const gutter = settings.gutter * scale;
  const odd = pageNumber % 2 === 1;
  return (
    <figure className="gutter-mini-figure">
      <div className="gutter-mini" style={{ width, height }}>
        {gutter > 0 ? (
          <div
            className="gutter-mini-band"
            style={
              odd
                ? { left: margin, width: gutter }
                : { right: margin, width: gutter }
            }
          />
        ) : null}
        <div
          className="gutter-mini-header"
          style={{ left: insets.left * scale }}
        />
        <div
          className="gutter-mini-body"
          style={{ left: insets.left * scale, right: insets.right * scale }}
        >
          <span />
          <span />
          <span />
          <span />
        </div>
        <span
          className="gutter-mini-num"
          style={{ right: insets.right * scale }}
        >
          {pageNumber}
        </span>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Gutter field for Page setup, with a live picture of both sides of the sheet. */
export function GutterField({
  px,
  onPx,
}: {
  px: number;
  onPx: (px: number) => void;
}) {
  const [text, setText] = useState(() =>
    Number.isFinite(px) ? String(Math.round((px / 96) * 1000) / 1000) : "",
  );
  const inches = text.trim() === "" ? Number.NaN : Number(text);
  const next = inches * 96;
  const invalid = !gutterAccepted(next);
  const refused = Number.isFinite(inches) && inches > 2;
  const note = refused
    ? "A gutter larger than 2 inches is refused, so the text stays on the page."
    : invalid
      ? "Enter a gutter from 0 to 2 inches."
      : inches > 0
        ? "Odd pages on the left, even pages on the right. The outside margin stays put."
        : "No extra room yet. Both pages use the same margins.";
  return (
    <>
      <label>
        <span>Gutter (inches)</span>
        <input
          aria-describedby="gutter-hint"
          aria-invalid={invalid}
          type="number"
          inputMode="decimal"
          min="0"
          max="2"
          step="0.125"
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            onPx(raw.trim() === "" ? Number.NaN : Number(raw) * 96);
          }}
        />
      </label>
      <p
        id="gutter-hint"
        className={`page-setup-gutter-note${invalid ? " is-refused" : ""}`}
      >
        {note}
      </p>
      {invalid ? null : (
        <div className="gutter-preview">
          <div className="gutter-spread">
            <MiniSheet label="Even page" pageNumber={2} gutterPx={next} />
            <MiniSheet label="Odd page" pageNumber={3} gutterPx={next} />
          </div>
        </div>
      )}
    </>
  );
}

/** On-screen shade for the binding edge. Hidden when printing. */
export function PageGutterBands({
  settings,
  pageCount,
}: {
  settings: PageSettings;
  pageCount: number;
}) {
  if (!(settings.gutter > 0)) return null;
  return (
    <>
      {Array.from({ length: pageCount }, (_, i) => {
        const odd = (i + 1) % 2 === 1;
        return (
          <div
            key={i}
            className="page-gutter-band"
            style={{
              top: `calc(${i} * var(--page-stride))`,
              width: settings.gutter,
              ...(odd
                ? { left: settings.left }
                : { right: settings.right }),
            }}
          />
        );
      })}
    </>
  );
}
