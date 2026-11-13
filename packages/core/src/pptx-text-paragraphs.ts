import JSZip from "jszip";
import type { Slide, SlideElement, TextRun } from "./index";
import { officeFont } from "./office-fonts";
import { presentationSingleSpacing } from "./pptx-line-spacing";
import { isSymbolFont } from "./symbol-fonts";
import { restoreOfficeMath } from "./pptx-math-preservation";

/** Metadata on a paragraph separator belongs to the paragraph after it. */
export function exportParagraphs(element: SlideElement): TextRun[][] {
  const result: TextRun[][] = [[]];
  const content = element.content ?? "";
  for (const run of element.runs ?? [element.math
    ? { text: content.replace(/[\r\n]+/g, " "), latex: content, math: true }
    : { text: content }]) {
    if (run.paragraphBreak)
      result.push([{ ...run, text: "", paragraphBreak: false }]);
    else result.at(-1)!.push(run);
  }
  return result;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function markerOf(
  element: SlideElement,
  runs: TextRun[],
): { text: string; run: TextRun } | undefined {
  const run = runs.find((item) => item.text);
  if (run?.autoNumber && run.text.startsWith(run.autoNumber.prefix))
    return { text: run.autoNumber.prefix, run };
  const separator = element.bullet && runs.some((item) => item !== run && item.text)
    ? "(?:\\s|$)"
    : "\\s";
  const marker =
    element.bullet &&
    run &&
    (isSymbolFont(run.font) || isSymbolFont(officeFont(run.font ?? ""))
      ? new RegExp(`^(.)${separator}`, "u").exec(run.text)
      : new RegExp(`^([•▪◦‣∙●○■□–—-])${separator}`, "u").exec(run.text));
  return marker && run ? { text: marker[1], run } : undefined;
}
function properties(element: SlideElement, runs: TextRun[]): string {
  const first = runs[0] ?? {};
  const linePt = first.paraLinePt ?? element.lineHeightPt;
  const factor = first.paraLine ?? element.lineHeight;
  const line = linePt
    ? `<a:lnSpc><a:spcPts val="${Math.round(linePt * 100)}"/></a:lnSpc>`
    : factor
      ? `<a:lnSpc><a:spcPct val="${Math.round((factor / presentationSingleSpacing) * 100000)}"/></a:lnSpc>`
      : "";
  const before = first.spaceBefore
    ? `<a:spcBef><a:spcPts val="${Math.round(first.spaceBefore * 75)}"/></a:spcBef>`
    : "";
  const align = first.paraAlign ?? element.align ?? "left";
  const alignment = { left: "l", right: "r", center: "ctr", justify: "just" }[
    align
  ];
  const marker = markerOf(element, runs);
  const authoredBullet = element.bullet && !element.runs;
  const hang =
    first.paraHang ?? element.hang ?? (authoredBullet ? 13.333333 : 0);
  const margin = first.paraMargin ?? 0;
  const indent = first.paraFirst ?? -hang;
  const geometry = ` marL="${Math.round((margin + hang) * 9525)}" indent="${Math.round(indent * 9525)}"`;
  const bullet =
    marker || authoredBullet
      ? `${marker?.run.color ? `<a:buClr><a:srgbClr val="${escape(marker.run.color.replace("#", ""))}"/></a:buClr>` : ""}${marker?.run.fontSize ? `<a:buSzPts val="${Math.round(marker.run.fontSize * 100)}"/>` : ""}${marker?.run.font ? `<a:buFont typeface="${escape(officeFont(marker.run.font))}"/>` : ""}${marker?.run.autoNumber ? `<a:buAutoNum type="${escape(marker.run.autoNumber.kind)}"${marker.run.autoNumber.startAt ? ` startAt="${marker.run.autoNumber.startAt}"` : ""}/>` : `<a:buChar char="${escape(marker?.text ?? "•")}"/>`}`
      : "<a:buNone/>";
  const tabs = first.paraTabs?.length
    ? `<a:tabLst>${first.paraTabs.map((tab) => `<a:tab pos="${Math.round(tab.pos * 12700)}" algn="${tab.align}"/>`).join("")}</a:tabLst>`
    : "";
  const depth = first.listDepth ?? marker?.run.autoNumber?.level;
  return `<a:pPr algn="${first.paraDistributed ? "dist" : alignment}"${geometry}${depth ? ` lvl="${depth}"` : ""}${first.paraTab ? ` defTabSz="${Math.round(first.paraTab * 12700)}"` : ""}>${line}${before}${bullet}${tabs}</a:pPr>`;
}

/** PptxGenJS cannot express mixed paragraph pitches and folded imported gaps. */
export async function stampTextParagraphs(
  bytes: Uint8Array,
  slides: Slide[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  for (let index = 0; index < slides.length; index++) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const part = zip.file(path);
    if (!part) continue;
    let xml = await part.async("string");
    xml = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) => {
      const name = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(shape)?.[1];
      const element = slides[index].elements.find((el) =>
        name?.includes(el.id),
      );
      if (!element || !shape.includes("<p:txBody>")) return shape;
      if (element.paragraphEdgeSpacing)
        shape = shape.replace(/<a:bodyPr\b/, '<a:bodyPr spcFirstLastPara="1"');
      const paragraphs = exportParagraphs(element);
      let paragraphIndex = 0;
      return shape.replace(/<a:p>[\s\S]*?<\/a:p>/g, (paragraph) => {
        const runs = paragraphs[paragraphIndex++] ?? [];
        const props = properties(element, runs);
        const marker = markerOf(element, runs);
        let rest = paragraph.replace(
          /<a:pPr\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/a:pPr>)/g,
          "",
        );
        // Capitalization is a font feature, not an edit to the stored text.
        // Preserve native small/all caps so Office measures their real advances.
        const textRuns = runs.flatMap((run) => run.text.split("\n").filter(Boolean).map(() => run));
        let textRunIndex = 0;
        rest = rest.replace(/<a:r>[\s\S]*?<\/a:r>/g, (runXml) => {
          const run = textRuns[textRunIndex++];
          if (!run?.caps) return runXml;
          return runXml.replace(/<a:rPr\b/, `<a:rPr cap="${run.caps}"`);
        });
        rest = restoreOfficeMath(rest, textRuns, element.fontSize || 18, element.color);
        const breaks: TextRun[] = [];
        let previous: TextRun = {
          text: "",
          fontSize: element.fontSize,
          font: element.fontFamily,
        };
        for (const run of runs) {
          const style = { ...previous, ...run };
          for (const _ of run.text.matchAll(/\n/g)) breaks.push(style);
          previous = style;
        }
        let breakIndex = 0;
        rest = rest.replace(/<a:br\s*\/>/g, () => {
          const run = breaks[breakIndex++];
          if (!run) return "<a:br/>";
          const size = run.fontSize
            ? ` sz="${Math.round(run.fontSize * 100)}"`
            : "";
          const font = run.font
            ? `<a:latin typeface="${escape(officeFont(run.font))}"/>`
            : "";
          return `<a:br><a:rPr${size}>${font}</a:rPr></a:br>`;
        });
        if (marker)
          rest = rest.replace(
            /<a:t>([\s\S]*?)<\/a:t>/,
            (_, text) =>
              `<a:t>${text.startsWith(escape(marker.text)) ? text.slice(escape(marker.text).length).replace(/^\s/u, "") : text}</a:t>`,
          );
        if (marker)
          rest = rest.replace(
            /<a:r>\s*<a:rPr\b[\s\S]*?<\/a:rPr>\s*<a:t><\/a:t>\s*<\/a:r>/g,
            "",
          );
        // PptxGenJS sizes every empty paragraph from the whole text box.
        // A separator's metadata describes the paragraph after that separator.
        const emptySize = runs[0]?.fontSize ?? element.fontSize;
        if (!runs.some((run) => run.text) && emptySize)
          rest = rest.replace(
            /(<a:endParaRPr\b[^>]*\bsz=")[^"]*(")/,
            `$1${Math.round(emptySize * 100)}$2`,
          );
        return rest.replace("<a:p>", `<a:p>${props}`);
      });
    });
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
