import { useState } from "react";
import {
  formatMarginInches,
  pageMarginsValid,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import "./page-setup-margins.css";

type Edge = "marginTop" | "marginBottom" | "marginLeft" | "marginRight";

const fields: { edge: Edge; label: string; side: string }[] = [
  { edge: "marginTop", label: "Top margin", side: "top" },
  { edge: "marginBottom", label: "Bottom margin", side: "bottom" },
  { edge: "marginLeft", label: "Left margin", side: "left" },
  { edge: "marginRight", label: "Right margin", side: "right" },
];
const edgeName: Record<Edge, string> = {
  marginTop: "Top",
  marginBottom: "Bottom",
  marginLeft: "Left",
  marginRight: "Right",
};

/** CSS pixels on the thumbnail per inch of paper. */
const PREVIEW_SCALE = 16;

export function PageMarginFields({
  draft,
  onChange,
}: {
  draft: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  const [active, setActive] = useState<Edge | null>(null);
  const valid = pageMarginsValid(draft);
  const inches = (edge: Edge) => formatMarginInches(draft[edge]);
  const band = (edge: Edge) =>
    `${(draft[edge] / 96) * PREVIEW_SCALE}px`;
  return (
    <fieldset className="page-setup-margins">
      <legend>Margins (inches)</legend>
      <div className="page-margin-layout">
        <div className="margin-preview" aria-hidden="true">
          <span className={active === "marginTop" ? "is-active" : ""}>
            {inches("marginTop")}
          </span>
          <div className="margin-preview-row">
            <span className={active === "marginLeft" ? "is-active" : ""}>
              {inches("marginLeft")}
            </span>
            <div
              className={`margin-preview-page${active ? ` edge-${active}` : ""}`}
              style={{
                paddingTop: band("marginTop"),
                paddingRight: band("marginRight"),
                paddingBottom: band("marginBottom"),
                paddingLeft: band("marginLeft"),
              }}
            >
              <div className="margin-preview-body" />
            </div>
            <span className={active === "marginRight" ? "is-active" : ""}>
              {inches("marginRight")}
            </span>
          </div>
          <span className={active === "marginBottom" ? "is-active" : ""}>
            {inches("marginBottom")}
          </span>
        </div>
        <div className="page-margin-fields">
          {fields.map(({ edge, label, side }) => (
            <label key={edge}>
              <span>{side[0].toUpperCase() + side.slice(1)}</span>
              <span className="page-margin-input">
                <input
                  aria-label={label}
                  type="number"
                  inputMode="decimal"
                  min="0.25"
                  max="1.5"
                  step="0.05"
                  value={inches(edge)}
                  onFocus={() => setActive(edge)}
                  onBlur={() => setActive((current) => (current === edge ? null : current))}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      [edge]: Number(e.target.value) * 96,
                    })
                  }
                />
                <span aria-hidden="true">in</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <p className="page-margin-note" aria-live="polite">
        {!valid
          ? "Each margin is from 0.25 to 1.5 inches."
          : active
            ? `${edgeName[active]} is the edge that will move. The others stay as they are.`
            : "The blue band is the margin. The white box is where the text sits."}
      </p>
    </fieldset>
  );
}
