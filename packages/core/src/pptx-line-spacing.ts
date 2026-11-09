import type { TextRun } from "./slide-schema";

/** PPTX's font-independent line box (LibreOffice's fixed-cell text mode).
 * Font ascent/descent still describe ink and baseline geometry, not line pitch.
 * Keep this presentation policy separate from document/spreadsheet font metrics.
 */
export const presentationSingleSpacing = 1.2;

/** Exact spacing is already a font-relative point height from the importer. */
export function presentationLineHeight(factor = 1, exact = false): number {
  return exact ? factor : presentationSingleSpacing * factor;
}

/** Per-paragraph pitch must override the box even when a later paragraph returns to percentages. */
export function presentationParagraphRuns(paragraphs: {runs: TextRun[]; lineHeight?: number; lineHeightPt?: number; exactLine?: boolean; spaceBefore?: number}[]): TextRun[] {
 return paragraphs.flatMap((p,index)=>{
  const pitch={paraLine:presentationLineHeight(p.lineHeight,p.exactLine), ...(p.lineHeightPt?{paraLinePt:p.lineHeightPt}:{}), ...(p.spaceBefore?{spaceBefore:p.spaceBefore}:{})};
  return [...(index?[{text:"\n",paragraphBreak:true,...pitch}]:[]), ...p.runs.map((run,i)=>i===0?{...run,...pitch}:run)];
 });
}
