import { useState } from "react";
import {
  marginError,
  pageDimensions,
  setPageMargin,
  PX_PER_INCH,
  type MarginEdge,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import "./page-margins.css";

const EDGES: { edge: MarginEdge; label: string }[] = [
  { edge: "top", label: "Top" },
  { edge: "bottom", label: "Bottom" },
  { edge: "left", label: "Left" },
  { edge: "right", label: "Right" },
];

function inchesText(px: number): string {
  if (!Number.isFinite(px)) return "";
  const inches = Math.round((px / PX_PER_INCH) * 1000) / 1000;
  return String(inches);
}

/** CSS pixels for what the person typed, or NaN when it is not a number yet. */
function parseInches(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "." || trimmed === "-" || trimmed === "-.")
    return Number.NaN;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n * PX_PER_INCH : Number.NaN;
}

/**
 * Top, Bottom, Left, and Right, in inches, plus a preview of the edge being
 * edited. The preview's dashed box is where the text sat when the dialog
 * opened, so a change on one side does not look like every side moved.
 */
export function PageMarginFields({
  draft,
  onChange,
}: {
  draft: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  const [text, setText] = useState(() => ({
    top: inchesText(draft.top),
    bottom: inchesText(draft.bottom),
    left: inchesText(draft.left),
    right: inchesText(draft.right),
  }));
  const [focused, setFocused] = useState<MarginEdge>("top");
  const [opened] = useState(() => ({
    top: draft.top,
    bottom: draft.bottom,
    left: draft.left,
    right: draft.right,
  }));

  const errors = {
    top: marginError(draft.top),
    bottom: marginError(draft.bottom),
    left: marginError(draft.left),
    right: marginError(draft.right),
  };
  const error =
    errors[focused] ??
    errors.top ??
    errors.bottom ??
    errors.left ??
    errors.right;
  const focusedLabel = EDGES.find((item) => item.edge === focused)!.label;
  const { width, height } = pageDimensions(draft);

  return (
    <fieldset className="page-margins">
      <legend>Margins</legend>
      <div className="page-margins-layout">
        <div className="page-margins-fields">
          {EDGES.map(({ edge, label }) => (
            <label
              key={edge}
              className={`page-margin-field${focused === edge ? " is-active" : ""}${errors[edge] ? " is-invalid" : ""}`}
            >
              <span>{label}</span>
              <span className="page-margin-control">
                <input
                  type="text"
                  aria-label={`${label} margin`}
                  aria-invalid={errors[edge] ? true : undefined}
                  aria-describedby="page-margin-note"
                  inputMode="decimal"
                  autoComplete="off"
                  value={text[edge]}
                  onFocus={() => setFocused(edge)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
                    setText((prev) => ({ ...prev, [edge]: raw }));
                    onChange(setPageMargin(draft, edge, parseInches(raw)));
                  }}
                />
                <span className="page-margin-unit" aria-hidden="true">
                  in
                </span>
              </span>
            </label>
          ))}
        </div>
        <MarginPreview
          pageWidth={width}
          pageHeight={height}
          current={{
            top: draft.top,
            bottom: draft.bottom,
            left: draft.left,
            right: draft.right,
          }}
          opened={opened}
          active={focused}
          labels={text}
          invalid={errors}
        />
      </div>
      <p
        id="page-margin-note"
        className={`page-margin-note${error ? " is-error" : ""}`}
        role={error ? "alert" : "status"}
      >
        {error ?? `Only the ${focusedLabel.toLowerCase()} margin changes.`}
      </p>
    </fieldset>
  );
}

function bandPx(px: number, along: number): number {
  if (!Number.isFinite(px) || px <= 0) return 0;
  return Math.min(px, along * 0.46);
}

function MarginPreview({
  pageWidth,
  pageHeight,
  current,
  opened,
  active,
  labels,
  invalid,
}: {
  pageWidth: number;
  pageHeight: number;
  current: Record<MarginEdge, number>;
  opened: Record<MarginEdge, number>;
  active: MarginEdge;
  labels: Record<MarginEdge, string>;
  invalid: Record<MarginEdge, string | null>;
}) {
  const box = (margins: Record<MarginEdge, number>) => ({
    top: `${(bandPx(margins.top, pageHeight) / pageHeight) * 100}%`,
    right: `${(bandPx(margins.right, pageWidth) / pageWidth) * 100}%`,
    bottom: `${(bandPx(margins.bottom, pageHeight) / pageHeight) * 100}%`,
    left: `${(bandPx(margins.left, pageWidth) / pageWidth) * 100}%`,
  });
  const moved = EDGES.some(
    ({ edge }) =>
      Number.isFinite(current[edge]) &&
      Math.abs(current[edge] - opened[edge]) > 0.5,
  );
  const labelText = (edge: MarginEdge) =>
    labels[edge] === "" ? "—" : labels[edge];
  return (
    <div
      className="margin-preview"
      role="img"
      aria-label={`Margin preview. Top ${labelText("top")} in, bottom ${labelText("bottom")} in, left ${labelText("left")} in, right ${labelText("right")} in.`}
    >
      <div
        className={`margin-preview-readout is-top${active === "top" ? " is-active" : ""}${invalid.top ? " is-invalid" : ""}`}
      >
        {labelText("top")}
      </div>
      <div className="margin-preview-row">
        <div
          className={`margin-preview-readout is-side${active === "left" ? " is-active" : ""}${invalid.left ? " is-invalid" : ""}`}
        >
          {labelText("left")}
        </div>
        <div
          className="margin-preview-page"
          style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}
        >
          <div className="margin-preview-text" style={box(current)}>
            <span />
            <span />
            <span />
            <span />
          </div>
          {moved ? (
            <div className="margin-preview-original" style={box(opened)} />
          ) : null}
          <div
            className={`margin-preview-edge is-top${active === "top" ? " is-active" : ""}`}
            style={{ height: box(current).top }}
          />
          <div
            className={`margin-preview-edge is-bottom${active === "bottom" ? " is-active" : ""}`}
            style={{ height: box(current).bottom }}
          />
          <div
            className={`margin-preview-edge is-left${active === "left" ? " is-active" : ""}`}
            style={{
              top: box(current).top,
              bottom: box(current).bottom,
              width: box(current).left,
            }}
          />
          <div
            className={`margin-preview-edge is-right${active === "right" ? " is-active" : ""}`}
            style={{
              top: box(current).top,
              bottom: box(current).bottom,
              width: box(current).right,
            }}
          />
        </div>
        <div
          className={`margin-preview-readout is-side${active === "right" ? " is-active" : ""}${invalid.right ? " is-invalid" : ""}`}
        >
          {labelText("right")}
        </div>
      </div>
      <div
        className={`margin-preview-readout is-bottom${active === "bottom" ? " is-active" : ""}${invalid.bottom ? " is-invalid" : ""}`}
      >
        {labelText("bottom")}
      </div>
    </div>
  );
}
