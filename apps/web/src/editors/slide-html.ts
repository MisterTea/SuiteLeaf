import type { Presentation } from "@suiteleaf/core";
import { marpMediaSrc } from "./slide-marp-import";
import { escapeHtml, hasTextRuns, textInnerHtml } from "./slide-runs";

/** Standalone HTML download for a deck. */
export function deckToHtml(deck: Presentation, title: string): string {
  const slidesHtml = deck.slideOrder
    .map((id, i) => {
      const s = deck.slides[id];
      if (!s) return "";
      const bg = s.background?.color
        ? `background-color: ${s.background.color};`
        : "background-color: #fff;";
      const elsHtml = s.elements
        .map((el) => {
          const pos = `position: absolute; left: ${(el.x / (deck.width || 960)) * 100}%; top: ${(el.y / (deck.height || 540)) * 100}%; width: ${(el.width / (deck.width || 960)) * 100}%; height: ${(el.height / (deck.height || 540)) * 100}%;`;
          if (el.type === "text") {
            const weight = hasTextRuns(el)
              ? "normal"
              : el.bold
                ? "bold"
                : "normal";
            const family = JSON.stringify(el.fontFamily || "Arial");
            const outline =
              el.wordArt && el.stroke
                ? `-webkit-text-stroke:${el.strokeWidth || 2}px ${el.stroke};paint-order:stroke fill;-webkit-text-fill-color:currentColor;`
                : "";
            const style = `${pos} font-size: ${(el.fontSize || 20) * 1.5}px; font-weight: ${weight}; font-style: ${hasTextRuns(el) ? "normal" : el.italic ? "italic" : "normal"}; color: ${el.color || "#1e293b"}; text-align: ${el.align || "left"}; white-space: pre-wrap; word-break: break-word; font-family: ${family};${outline}`;
            return `<div style="${style}">${textInnerHtml(el)}</div>`;
          }
          if (el.type === "image" && el.src) {
            return `<img src="${marpMediaSrc(el.src, deck.marpAssets) ?? ""}" alt="${el.alt || "image"}" style="${pos} object-fit: contain;" />`;
          }
          if ((el.type === "audio" || el.type === "video") && el.src) {
            const name = escapeHtml(el.alt || el.type);
            return `<div style="${pos}"><${el.type} src="${el.src}"${el.type === "video" && el.poster ? ` poster="${escapeHtml(el.poster)}"` : ""} controls></${el.type}><p>${name}</p></div>`;
          }
          if (el.type === "shape") {
            const border = el.stroke
              ? `border: ${el.strokeWidth || 1}px solid ${el.stroke};`
              : "";
            const rad =
              el.shapeType === "ellipse"
                ? "border-radius: 50%;"
                : el.shapeType === "roundRect"
                  ? "border-radius: 12px;"
                  : "";
            return `<div style="${pos} background-color: ${el.fill || "#e2e8f0"}; ${border} ${rad}"></div>`;
          }
          return "";
        })
        .join("\n");
      return `<section class="slide" id="slide-${i + 1}" style="${bg}">
          ${elsHtml}
          ${s.notes ? `<div class="notes">Notes: ${s.notes}</div>` : ""}
        </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { margin: 0; background: #0f172a; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
    .slide { width: 960px; height: 540px; position: relative; box-shadow: 0 10px 25px rgba(0,0,0,0.5); overflow: hidden; margin-bottom: 2rem; border-radius: 4px; }
    .notes { position: absolute; bottom: 8px; left: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #fff; padding: 6px; font-size: 12px; border-radius: 4px; }
    @media print { body { background: #fff; } .slide { page-break-after: always; box-shadow: none; margin: 0; width: 100%; height: 100vh; } }
  </style>
</head>
<body>
${slidesHtml}
</body>
</html>`;
}
