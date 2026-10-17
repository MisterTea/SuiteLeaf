import { useState, type CSSProperties } from "react";
import {
  PAGE_NUMBER_START_MAX,
  furnitureImage,
  pageFace,
  pageNumberFormatChips,
  pageNumberHint,
  pageNumberText,
  setDifferentFirstPage,
  setDifferentOddEven,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import "./page-setup.css";
import { DocWatermark, DocWatermarkField } from "./doc-watermark";
import { acceptPageNumberStart } from "./page-number-live";
import {
  previewNumberCorner,
  previewPlan,
  previewSkipLabel,
  type PreviewPageRole,
  type PreviewSlot,
} from "./page-preview";

function ImageControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className="furniture-image-field">
      {value ? <img src={value} alt="" /> : null}
      <input
        aria-label={label}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || file.size > 1024 * 1024) return;
          const reader = new FileReader();
          reader.onload = () => {
            const next = furnitureImage(reader.result);
            if (next) onChange(next);
          };
          reader.readAsDataURL(file);
        }}
      />
      {value ? (
        <button type="button" onClick={() => onChange("")}>
          Remove
        </button>
      ) : null}
    </span>
  );
}

function TextField({
  span,
  label,
  value,
  placeholder,
  onChange,
  image,
}: {
  span: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  image?: { label: string; value: string; onChange: (value: string) => void };
}) {
  return (
    <label>
      <span>{span}</span>
      <span className="page-setup-text-line">
        <input
          aria-label={label}
          placeholder={placeholder}
          value={value}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
        />
        {image ? <ImageControl {...image} /> : null}
      </span>
    </label>
  );
}

function sheetLabel(
  index: number,
  shifted: boolean,
  ends: boolean,
  total: number,
  role?: PreviewPageRole,
) {
  if (role === "cover") return "Cover";
  if (role === "next") return "Next page";
  const name = `${shifted ? "File page" : "Page"} ${index + 1}`;
  if (role === "last-even") return `${name} · last even`;
  if (role === "last-odd") return `${name} · last odd`;
  if (ends && index === 0) return `${name} · first`;
  if (ends && index === total - 1) return `${name} · last`;
  if (index === 0 || total < 3) return name;
  return `${name}${index % 2 === 1 ? " · even" : " · odd"}`;
}

function numberPlacePhrase(face: {
  numberSide: string;
  pageNumber: string;
}): string {
  if (face.numberSide === "none") return "No number";
  if (face.numberSide === "left") return `${face.pageNumber} on the left`;
  if (face.numberSide === "center") return `${face.pageNumber} in the center`;
  if (face.numberSide === "top-left")
    return `${face.pageNumber} at the top left`;
  if (face.numberSide === "top-right")
    return `${face.pageNumber} at the top right`;
  return `${face.pageNumber} on the right`;
}

function oddEvenHint(draft: PageSettings): string {
  const shared = draft.header.trim() || "one shared header";
  if (!draft.differentOddEven)
    return "Even and odd pages after the first can each have a header and a footer.";
  if (draft.pageNumbers && draft.pageNumberPositionSet) {
    const back =
      draft.pageNumberPosition === "top-right"
        ? "the top right"
        : draft.pageNumberPosition === "bottom-center"
          ? "the bottom center"
          : "the bottom right";
    return `The number sits on the outside edge. Untick to put it back at ${back}.`;
  }
  return `Untick to put “${shared}” back on every later page.`;
}

function PreviewSheet({
  draft,
  index,
  total,
  ends,
  role,
}: {
  draft: PageSettings;
  index: number;
  total: number;
  ends: boolean;
  role?: PreviewPageRole;
}) {
  const face = pageFace(draft, index, total);
  const corner = previewNumberCorner(face.numberSide);
  const shifted = draft.coverHasNoNumber || draft.pageNumberStart !== 1;
  const phrase = numberPlacePhrase(face);
  return (
    <div
      className="page-setup-preview-page"
      data-preview-index={index}
      data-preview-role={role}
    >
      <div className="page-setup-preview-sheet" data-number-corner={corner}>
        {face.header ? (
          <span className={`page-setup-preview-header align-${face.headerAlign}`}>
            {face.header}
          </span>
        ) : null}
        {face.numberSide === "none" ? (
          <span className="page-setup-preview-number side-none">No number</span>
        ) : (
          <span className={`page-setup-preview-number side-${face.numberSide}`}>
            {face.pageNumber}
          </span>
        )}
      </div>
      <span className="page-setup-preview-label">
        {sheetLabel(index, shifted, ends, total, role)}
      </span>
      {face.numberSide === "none" ? null : (
        <span className="page-setup-preview-place">{phrase}</span>
      )}
    </div>
  );
}

function PreviewSkip({
  draft,
  slot,
  total,
}: {
  draft: PageSettings;
  slot: Extract<PreviewSlot, { kind: "skip" }>;
  total: number;
}) {
  const label = previewSkipLabel(draft, slot.firstIndex, slot.lastIndex, total);
  return (
    <div className="page-setup-preview-skip">
      <span className="page-setup-preview-skip-mark" aria-hidden="true">
        …
      </span>
      <span className="page-setup-preview-skip-label">{label}</span>
    </div>
  );
}

function Preview({
  draft,
  pageCount,
}: {
  draft: PageSettings;
  pageCount: number;
}) {
  const plan = previewPlan(
    pageCount,
    draft.differentOddEven,
    draft.coverHasNoNumber,
  );
  const ends = plan.slots.some((slot) => slot.kind === "skip");
  const parity = draft.differentOddEven;
  return (
    <div
      className={
        ends
          ? "page-setup-preview is-ends"
          : parity
            ? "page-setup-preview is-parity"
            : "page-setup-preview"
      }
      role="group"
      aria-label="Page preview"
      style={{ "--preview-columns": plan.slots.length } as CSSProperties}
    >
      {plan.slots.map((slot) =>
        slot.kind === "skip" ? (
          <PreviewSkip key="skip" draft={draft} slot={slot} total={plan.total} />
        ) : (
          <PreviewSheet
            key={slot.index}
            draft={draft}
            index={slot.index}
            total={plan.total}
            ends={ends}
            role={slot.role}
          />
        ),
      )}
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
  const [startText, setStartText] = useState(String(draft.pageNumberStart));
  const [startRefused, setStartRefused] = useState(false);
  const stayed = pageNumberText(
    draft.pageNumberFormat,
    draft.pageNumberStart,
    Math.max(pageCount, 1),
  );
  const chips = pageNumberFormatChips(draft.pageNumberStart, pageCount);
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
          {oddEvenHint(draft)}
        </p>
      </fieldset>
      <div className="page-setup-check page-setup-numbers">
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
        <DocWatermarkField
          value={draft.watermark}
          onChange={(watermark) => onChange({ ...draft, watermark })}
        />
        <fieldset className="page-number-choice" disabled={!draft.pageNumbers}>
          <legend>Format</legend>
          <label>
            <input
              type="radio"
              name="page-number-format"
              checked={draft.pageNumberFormat === "fraction"}
              onChange={() =>
                onChange({ ...draft, pageNumberFormat: "fraction" })
              }
            />
            {chips.fraction}
          </label>
          <label>
            <input
              type="radio"
              name="page-number-format"
              checked={draft.pageNumberFormat === "page"}
              onChange={() => onChange({ ...draft, pageNumberFormat: "page" })}
            />
            {chips.page}
          </label>
          <label>
            <input
              type="radio"
              name="page-number-format"
              checked={draft.pageNumberFormat === "roman"}
              onChange={() => onChange({ ...draft, pageNumberFormat: "roman" })}
            />
            {chips.roman}
          </label>
        </fieldset>
        <fieldset className="page-number-choice" disabled={!draft.pageNumbers}>
          <legend>Position</legend>
          {(
            [
              ["bottom-right", "Bottom right"],
              ["bottom-center", "Bottom center"],
              ["top-right", "Top right"],
            ] as const
          ).map(([id, label]) => (
            <label key={id}>
              <input
                type="radio"
                name="page-number-position"
                checked={
                  draft.pageNumberPositionSet
                    ? draft.pageNumberPosition === id
                    : !draft.differentOddEven && id === "bottom-right"
                }
                onChange={() =>
                  onChange({
                    ...draft,
                    pageNumberPosition: id,
                    pageNumberPositionSet: true,
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset
          className={`page-number-choice page-number-start${startRefused ? " is-refused" : ""}`}
          disabled={!draft.pageNumbers || draft.coverHasNoNumber}
        >
          <legend>Start at</legend>
          <input
            aria-label="Start at"
            aria-describedby="page-numbers-hint"
            aria-invalid={startRefused || undefined}
            type="number"
            inputMode="numeric"
            min={1}
            max={PAGE_NUMBER_START_MAX}
            step={1}
            value={startText}
            onChange={(e) => {
              const next = acceptPageNumberStart(
                draft.pageNumberStart,
                e.target.value,
              );
              setStartText(next.text);
              setStartRefused(next.refused);
              if (!next.refused && next.start !== draft.pageNumberStart)
                onChange({ ...draft, pageNumberStart: next.start });
            }}
          />
        </fieldset>
        <label className="page-number-cover">
          <input
            type="checkbox"
            aria-describedby="page-numbers-hint"
            checked={draft.coverHasNoNumber}
            disabled={!draft.pageNumbers}
            onChange={(e) =>
              onChange({ ...draft, coverHasNoNumber: e.target.checked })
            }
          />
          Cover has no number
        </label>
        <p
          id="page-numbers-hint"
          className={`page-setup-hint${startRefused ? " is-refused" : ""}`}
          role={startRefused ? "alert" : undefined}
        >
          {startRefused
            ? `Numbering starts at 1 or later. The page stays on ${stayed}.`
            : pageNumberHint(draft, pageCount)}
        </p>
      </div>
      <Preview draft={draft} pageCount={pageCount} />
      <div className="page-setup-text">
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
            image={{
              label: "First header image",
              value: draft.firstHeaderImage,
              onChange: (firstHeaderImage) =>
                onChange({ ...draft, firstHeaderImage }),
            }}
          />
          <TextField
            span="First footer"
            label="First page footer"
            placeholder="Footer on page 1 only"
            value={draft.firstFooter}
            onChange={(firstFooter) => onChange({ ...draft, firstFooter })}
            image={{
              label: "First footer image",
              value: draft.firstFooterImage,
              onChange: (firstFooterImage) =>
                onChange({ ...draft, firstFooterImage }),
            }}
          />
        </>
      ) : null}
      {draft.differentOddEven ? (
        <>
          <p className="page-setup-group">
            Even pages
            <span>
              {draft.coverHasNoNumber
                ? "Page 2, then 4, 6… The number stays on the left."
                : "Pages 2, 4, 6… Title and number on the left."}
            </span>
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
              {draft.coverHasNoNumber
                ? "Page 1 is the page after the cover. The number stays on the right."
                : draft.differentFirstPage
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
            image={{
              label: "Header image",
              value: draft.headerImage,
              onChange: (headerImage) => onChange({ ...draft, headerImage }),
            }}
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
            image={{
              label: "Footer image",
              value: draft.footerImage,
              onChange: (footerImage) => onChange({ ...draft, footerImage }),
            }}
          />
        </>
      )}
      </div>
    </>
  );
}

export function PageFurniture({
  settings,
  pageCount,
  arabicStart = null,
}: {
  settings: PageSettings;
  pageCount: number;
  /** 0-based page where arabic numbering restarts at 1. */
  arabicStart?: number | null;
}) {
  return (
    <div className="page-furniture" aria-hidden="true">
      {Array.from({ length: pageCount }, (_, i) => {
        const face = pageFace(settings, i, pageCount, arabicStart);
        return (
          <div
            key={i}
            className="page-furniture-page"
            data-number-side={face.numberSide}
            data-header-align={face.headerAlign}
            style={{ "--page-index": i } as CSSProperties}
          >
            {face.numberSide === "top-right" || face.numberSide === "top-left" ? (
              <span className={`page-number page-number-top side-${face.numberSide}`}>
                {face.pageNumber}
              </span>
            ) : null}
            <div className={`page-header align-${face.headerAlign}`}>{face.header}</div>
            <DocWatermark text={settings.watermark} />
            <div
              className={`page-footer number-${face.numberSide === "top-right" || face.numberSide === "top-left" ? "none" : face.numberSide}`}
            >
              {face.numberSide === "left" ? (
                <span className="page-number">{face.pageNumber}</span>
              ) : null}
              <span className="page-footer-text">{face.footer}</span>
              {face.numberSide === "right" || face.numberSide === "center" ? (
                <span className="page-number">{face.pageNumber}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
