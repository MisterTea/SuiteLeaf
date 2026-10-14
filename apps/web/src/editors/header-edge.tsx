import { useState } from "react";
import {
  edgeDistanceError,
  edgeIntrusionNote,
  formatEdgeInches,
  type EdgeKind,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import "./header-edge.css";

export function EdgeField({
  kind,
  draft,
  onChange,
}: {
  kind: EdgeKind;
  draft: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  const key = kind === "header" ? "headerFromEdge" : "footerFromEdge";
  const label = kind === "header" ? "Header from edge" : "Footer from edge";
  const [text, setText] = useState(() => formatEdgeInches(draft[key]));
  const px = text.trim() === "" ? Number.NaN : Number(text) * 96;
  const error = edgeDistanceError(kind, px);
  const note = error ? null : edgeIntrusionNote(kind, { ...draft, [key]: px });
  const describedBy = error || note ? `${kind}-edge-note` : undefined;
  return (
    <>
      <label>
        <span>{label}</span>
        <span className="header-edge-input">
          <input
            aria-label={label}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              if (next !== "" && !/^\d*\.?\d*$/.test(next)) return;
              setText(next);
              const inches = next.trim() === "" ? Number.NaN : Number(next);
              onChange({
                ...draft,
                [key]: Number.isFinite(inches) ? inches * 96 : Number.NaN,
              });
            }}
          />
          <span aria-hidden="true">in</span>
        </span>
      </label>
      {error || note ? (
        <p
          id={`${kind}-edge-note`}
          className={error ? "header-edge-note is-error" : "header-edge-note"}
          role={error ? "alert" : "status"}
        >
          {error ?? note}
        </p>
      ) : null}
    </>
  );
}

/** Header and footer distances, in inches, separate from the body margins. */
export function HeaderEdgeFields({
  draft,
  onChange,
}: {
  draft: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  return (
    <fieldset className="header-edge-fields">
      <legend>Distance from the page edge</legend>
      <p className="header-edge-hint">
        Separate from the margins. These place the header and the footer. The margin numbers stay as they are.
      </p>
      <EdgeField kind="header" draft={draft} onChange={onChange} />
      <EdgeField kind="footer" draft={draft} onChange={onChange} />
    </fieldset>
  );
}
