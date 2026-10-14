import type { CSSProperties } from "react";
import {
  watermarkText,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

/** Store the phrase that is actually drawn, not surrounding spaces. */
export function pageSetupToSave(draft: PageSettings): PageSettings {
  return { ...draft, watermark: watermarkText(draft.watermark) };
}

/** The Page setup field, placed beside the page-number choices. */
export function DocWatermarkField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="doc-watermark-field">
      <label htmlFor="doc-watermark">Watermark</label>
      <input
        id="doc-watermark"
        placeholder="Optional"
        maxLength={40}
        value={value}
        spellCheck={false}
        aria-describedby="doc-watermark-hint"
        onChange={(e) => onChange(e.target.value)}
      />
      <span id="doc-watermark-hint" className="page-setup-hint">
        On every page. Blank removes it.
      </span>
    </div>
  );
}

/**
 * The word behind one page. It lives in the page furniture, so selecting or
 * editing a paragraph cannot delete it.
 */
export function DocWatermark({ text }: { text: string }) {
  const word = watermarkText(text);
  if (!word) return null;
  const em = Math.max(4.2, word.length * 0.78);
  return (
    <div
      className="page-watermark"
      data-watermark={word}
      style={{ "--mark-em": em } as CSSProperties}
    >
      <span>{word}</span>
    </div>
  );
}
