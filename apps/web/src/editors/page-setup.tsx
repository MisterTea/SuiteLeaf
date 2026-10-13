import type { CSSProperties } from "react";
import {
  pageFace,
  pageNumberHint,
  setDifferentFirstPage,
  setDifferentOddEven,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import "./page-setup.css";

function TextField({
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
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Preview({
  draft,
  pageCount,
}: {
  draft: PageSettings;
  pageCount: number;
}) {
  const total = Math.max(pageCount, 3);
  return (
    <div className="page-setup-preview" role="group" aria-label="Page preview">
      {[0, 1, 2].map((index) => {
        const face = pageFace(draft, index, total);
        const where =
          face.numberSide === "none"
            ? "No number"
            : face.numberSide === "left"
              ? `${face.pageNumber} on the left`
              : `${face.pageNumber} on the right`;
        return (
          <div key={index} className="page-setup-preview-page">
            <span className="page-setup-preview-label">
              Page {index + 1}
              {index === 0 ? "" : index % 2 === 1 ? " · even" : " · odd"}
            </span>
            <span className={`page-setup-preview-header align-${face.headerAlign}`}>
              {face.header || "No header"}
            </span>
            <span className={`page-setup-preview-number side-${face.numberSide}`}>
              {where}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PageSetupFields({
  draft,
  pageCount,
  onChange,
}: {
  draft: PageSettings;
  pageCount: number;
  onChange: (next: PageSettings) => void;
}) {
  const shared = draft.header.trim() || "one shared header";
  return (
    <>
      <fieldset className="page-setup-variants">
        <legend>Which pages differ</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.differentFirstPage}
            onChange={(e) =>
              onChange(setDifferentFirstPage(draft, e.target.checked))
            }
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
        <p className="page-setup-hint">
          {draft.differentOddEven
            ? `Untick to put “${shared}” back on every later page.`
            : "Even and odd pages after the first can each have a header and a footer. Their page numbers sit on the outside edge."}
        </p>
      </fieldset>
      <div className="page-setup-check">
        <label>
          <input
            type="checkbox"
            aria-describedby="page-numbers-hint"
            checked={draft.pageNumbers}
            onChange={(e) =>
              onChange({ ...draft, pageNumbers: e.target.checked })
            }
          />
          Page numbers
        </label>
        <span id="page-numbers-hint" className="page-setup-hint">
          {pageNumberHint(draft)}
        </span>
      </div>
      <Preview draft={draft} pageCount={pageCount} />
      {draft.differentFirstPage ? (
        <>
          <p className="page-setup-group">
            First page
            <span>Letterhead. No page number, including when odd and even pages are on.</span>
          </p>
          <TextField
            span="First header"
            label="First page header"
            placeholder="Letterhead on page 1 only"
            value={draft.firstHeader}
            onChange={(firstHeader) => onChange({ ...draft, firstHeader })}
          />
          <TextField
            span="First footer"
            label="First page footer"
            placeholder="Footer on page 1 only"
            value={draft.firstFooter}
            onChange={(firstFooter) => onChange({ ...draft, firstFooter })}
          />
        </>
      ) : null}
      {draft.differentOddEven ? (
        <>
          <p className="page-setup-group">
            Even pages
            <span>Pages 2, 4, 6… Title and number on the left.</span>
          </p>
          <TextField
            span="Even header"
            label="Even page header"
            placeholder="Header on even pages"
            value={draft.evenHeader}
            onChange={(evenHeader) => onChange({ ...draft, evenHeader })}
          />
          <TextField
            span="Even footer"
            label="Even page footer"
            placeholder="Footer on even pages"
            value={draft.evenFooter}
            onChange={(evenFooter) => onChange({ ...draft, evenFooter })}
          />
          <p className="page-setup-group">
            Odd pages
            <span>
              {draft.differentFirstPage
                ? "Pages 3, 5, 7… Title and number on the right."
                : "Pages 1, 3, 5… Title and number on the right."}
            </span>
          </p>
          <TextField
            span="Odd header"
            label="Odd page header"
            placeholder="Header on odd pages"
            value={draft.oddHeader}
            onChange={(oddHeader) => onChange({ ...draft, oddHeader })}
          />
          <TextField
            span="Odd footer"
            label="Odd page footer"
            placeholder="Footer on odd pages"
            value={draft.oddFooter}
            onChange={(oddFooter) => onChange({ ...draft, oddFooter })}
          />
        </>
      ) : (
        <>
          {draft.differentFirstPage ? (
            <p className="page-setup-group">
              Later pages
              <span>One header and footer, with the number on the right.</span>
            </p>
          ) : null}
          <TextField
            span={draft.differentFirstPage ? "Later header" : "Header"}
            label={
              draft.differentFirstPage ? "Header for later pages" : "Page header"
            }
            placeholder={
              draft.differentFirstPage
                ? "Text at the top of every later page"
                : "Text at the top of every page"
            }
            value={draft.header}
            onChange={(header) => onChange({ ...draft, header })}
          />
          <TextField
            span={draft.differentFirstPage ? "Later footer" : "Footer"}
            label={
              draft.differentFirstPage ? "Footer for later pages" : "Page footer"
            }
            placeholder={
              draft.differentFirstPage
                ? "Text at the bottom of every later page"
                : "Text at the bottom of every page"
            }
            value={draft.footer}
            onChange={(footer) => onChange({ ...draft, footer })}
          />
        </>
      )}
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
        return (
          <div
            key={i}
            className="page-furniture-page"
            data-number-side={face.numberSide}
            data-header-align={face.headerAlign}
            style={{ "--page-index": i } as CSSProperties}
          >
            <div className={`page-header align-${face.headerAlign}`}>{face.header}</div>
            <div className={`page-footer number-${face.numberSide}`}>
              {face.numberSide === "left" ? (
                <span className="page-number">{face.pageNumber}</span>
              ) : null}
              <span className="page-footer-text">{face.footer}</span>
              {face.numberSide === "right" ? (
                <span className="page-number">{face.pageNumber}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
