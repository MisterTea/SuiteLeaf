import type { CSSProperties } from "react";
import {
  pageFace,
  pageNumberHint,
  setDifferentOddEven,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import "./page-setup.css";

function HeaderField({
  span,
  label,
  value,
  placeholder,
  onChange,
}: {
  span: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{span}</span>
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        maxLength={500}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function PageSetupFields({
  draft,
  onChange,
}: {
  draft: PageSettings;
  onChange: (next: PageSettings) => void;
}) {
  const set = (patch: Partial<PageSettings>) => onChange({ ...draft, ...patch });
  const showFirst = draft.differentFirstPage;
  const showOddEven = draft.differentOddEven;
  const footers = [
    showFirst && draft.firstFooter
      ? {
          label: "First page footer",
          value: draft.firstFooter,
          key: "firstFooter" as const,
        }
      : null,
    showOddEven && draft.evenFooter
      ? {
          label: "Even page footer",
          value: draft.evenFooter,
          key: "evenFooter" as const,
        }
      : null,
    showOddEven && draft.oddFooter
      ? {
          label: "Odd page footer",
          value: draft.oddFooter,
          key: "oddFooter" as const,
        }
      : null,
  ].filter((field) => field !== null);
  return (
    <>
      <fieldset className="page-setup-variants">
        <legend>Which pages differ</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.differentFirstPage}
            onChange={(e) => set({ differentFirstPage: e.target.checked })}
          />
          Different first page
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.differentOddEven}
            onChange={(e) =>
              onChange(setDifferentOddEven(draft, e.target.checked))
            }
          />
          Different odd and even pages
        </label>
      </fieldset>
      <div className="page-setup-check">
        <label>
          <input
            type="checkbox"
            aria-describedby="page-numbers-hint"
            checked={draft.pageNumbers}
            onChange={(e) => set({ pageNumbers: e.target.checked })}
          />
          Page numbers
        </label>
        <span id="page-numbers-hint" className="page-setup-hint">
          {pageNumberHint(draft)}
        </span>
      </div>
      {showFirst ? (
        <HeaderField
          span="First header"
          label="First page header"
          placeholder="Letterhead on page 1 only"
          value={draft.firstHeader}
          onChange={(firstHeader) => set({ firstHeader })}
        />
      ) : null}
      {showOddEven ? (
        <>
          <HeaderField
            span="Even header"
            label="Even page header"
            placeholder="Header on even pages, on the left"
            value={draft.evenHeader}
            onChange={(evenHeader) => set({ evenHeader })}
          />
          <HeaderField
            span="Odd header"
            label="Odd page header"
            placeholder="Header on odd pages, on the right"
            value={draft.oddHeader}
            onChange={(oddHeader) => set({ oddHeader })}
          />
        </>
      ) : (
        <HeaderField
          span={showFirst ? "Later header" : "Header"}
          label={showFirst ? "Header for later pages" : "Page header"}
          placeholder={
            showFirst
              ? "Text at the top of every later page"
              : "Text at the top of every page"
          }
          value={draft.header}
          onChange={(header) => set({ header })}
        />
      )}
      {showOddEven ? null : (
        <HeaderField
          span={showFirst ? "Later footer" : "Footer"}
          label={showFirst ? "Footer for later pages" : "Page footer"}
          placeholder={
            showFirst
              ? "Text at the bottom of every later page"
              : "Text at the bottom of every page"
          }
          value={draft.footer}
          onChange={(footer) => set({ footer })}
        />
      )}
      {footers.map((field) => (
        <HeaderField
          key={field.key}
          span={field.label.replace(" page", "")}
          label={field.label}
          placeholder=""
          value={field.value}
          onChange={(value) => set({ [field.key]: value })}
        />
      ))}
    </>
  );
}

export function PageFurniture({
  settings,
  pageCount,
}: {
  settings: PageSettings;
  pageCount: number;
}) {
  return (
    <div className="page-furniture" aria-hidden="true">
      {Array.from({ length: pageCount }, (_, i) => {
        const face = pageFace(settings, i, pageCount);
        const numberWithHeader =
          settings.differentOddEven && face.numberSide !== "none";
        const number = numberWithHeader ? (
          <span className="page-number">{face.pageNumber}</span>
        ) : null;
        return (
          <div
            key={i}
            className="page-furniture-page"
            data-header-align={face.headerAlign}
            data-number-side={face.numberSide}
            data-letterhead={
              i === 0 && settings.differentFirstPage && face.header
                ? "true"
                : undefined
            }
            style={{ "--page-index": i } as CSSProperties}
          >
            <div className={`page-header align-${face.headerAlign}`}>
              {face.numberSide === "left" ? number : null}
              <span className="page-header-text">{face.header}</span>
              {face.numberSide === "right" ? number : null}
            </div>
            <div className="page-footer">
              <span>{face.footer}</span>
              {!numberWithHeader && face.numberSide === "right" ? (
                <span className="page-number">{face.pageNumber}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
