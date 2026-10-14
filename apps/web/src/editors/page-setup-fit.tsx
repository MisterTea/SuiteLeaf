import { useState } from "react";
import {
  formatMarginInches,
  pageMarginError,
  pageMarginsError,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { EdgeField } from "./header-edge";
import { GutterField } from "./page-gutter";
import "./page-setup-margins.css";
import "./page-setup-fit.css";

type MarginEdge = "marginTop" | "marginBottom" | "marginLeft" | "marginRight";

const edgeName: Record<MarginEdge, string> = {
  marginTop: "Top",
  marginBottom: "Bottom",
  marginLeft: "Left",
  marginRight: "Right",
};

/** CSS pixels on the thumbnail per inch of paper. */
const PREVIEW_SCALE = 10;

function MarginField({
  edge,
  draft,
  active,
  onChange,
  onActive,
}: {
  edge: MarginEdge;
  draft: PageSettings;
  active: MarginEdge | null;
  onChange: (next: PageSettings) => void;
  onActive: (update: (current: MarginEdge | null) => MarginEdge | null) => void;
}) {
  const side = edgeName[edge];
  // Text, not a number box: "1." has to stay on screen long enough to become 1.5.
  const [text, setText] = useState(() => formatMarginInches(draft[edge]));
  const px = text.trim() === "" ? Number.NaN : Number(text) * 96;
  return (
    <label className={`measure-margin${active === edge ? " is-active" : ""}`}>
      <span>{side}</span>
      <span className="page-margin-input">
        <input
          aria-label={`${side} margin`}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={pageMarginError(px) ? true : undefined}
          value={text}
          onFocus={() => onActive(() => edge)}
          onBlur={() => onActive((current) => (current === edge ? null : current))}
          onChange={(e) => {
            const next = e.target.value;
            if (next !== "" && !/^\d*\.?\d*$/.test(next)) return;
            setText(next);
            const inches = next.trim() === "" ? Number.NaN : Number(next);
            onChange({
              ...draft,
              [edge]: Number.isFinite(inches) ? inches * 96 : Number.NaN,
            });
          }}
        />
        <span aria-hidden="true">in</span>
      </span>
    </label>
  );
}

function MarginPreview({
  draft,
  active,
}: {
  draft: PageSettings;
  active: MarginEdge | null;
}) {
  const inches = (edge: MarginEdge) =>
    Number.isFinite(draft[edge]) ? formatMarginInches(draft[edge]) : "–";
  const band = (edge: MarginEdge) =>
    Number.isFinite(draft[edge])
      ? `${(draft[edge] / 96) * PREVIEW_SCALE}px`
      : "0px";
  return (
    <div className="margin-preview" aria-hidden="true">
      <span className={active === "marginTop" ? "is-active" : ""}>
        {inches("marginTop")}
      </span>
      <div className="margin-preview-row">
        <span className={active === "marginLeft" ? "is-active" : ""}>
          {inches("marginLeft")}
        </span>
        <div
          className={`margin-preview-page${draft.landscape ? " is-landscape" : ""}${active ? ` edge-${active}` : ""}`}
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
  );
}

/**
 * Margins and edge distances on the same rows, so the explanation sits
 * under the distance and the margin it talks about stays in view.
 */
export function PageSetupFit({
  draft,
  onChange,
}: {
  draft: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  const [active, setActive] = useState<MarginEdge | null>(null);
  const error = pageMarginsError(draft);
  const field = (edge: MarginEdge) => (
    <MarginField
      edge={edge}
      draft={draft}
      active={active}
      onChange={onChange}
      onActive={setActive}
    />
  );
  return (
    <section className="page-setup-fit" aria-label="Margins and distance from the edge">
      <div className="page-setup-fit-main">
        <p className="page-setup-fit-hint">
          Separate from the margins. These place the header and the footer. The margin numbers stay as they are.
        </p>
        <div className="measure-pair">
          {field("marginTop")}
          <EdgeField kind="header" draft={draft} onChange={onChange} />
        </div>
        <div className="measure-pair">
          {field("marginBottom")}
          <EdgeField kind="footer" draft={draft} onChange={onChange} />
        </div>
        <div className="measure-sides">
          {field("marginLeft")}
          {field("marginRight")}
        </div>
        <div className="measure-gutter">
          <GutterField
            px={draft.gutter}
            onPx={(gutter) => onChange({ ...draft, gutter })}
          />
        </div>
        <p
          className="page-margin-note"
          aria-live="polite"
          role={error ? "alert" : undefined}
        >
          {error
            ? error
            : active
              ? `${edgeName[active]} is the edge that will move. The others stay as they are.`
              : "The blue band is the margin. The white box is where the text sits."}
        </p>
      </div>
      <MarginPreview draft={draft} active={active} />
    </section>
  );
}
