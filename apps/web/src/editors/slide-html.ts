import { fontKerning, kernFeature, type Presentation } from "@suiteleaf/core";
import { masterForSlide } from "./slide-master";
import { marpMediaSrc } from "./slide-marp-import";
import { escapeHtml, hasTextRuns, textInnerHtml } from "./slide-runs";

const SAFE_COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|[a-z]{3,20})$/i;

function attr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function cssColor(value: string | undefined, fallback: string): string {
  const color = value?.trim() ?? "";
  return SAFE_COLOR.test(color) ? color : fallback;
}

/** An address a downloaded clip can use. A script address or a credential is left out. */
function mediaAddress(src: string): string {
  const value = src.trim();
  if (!value || /[\r\n]/.test(value)) return "";
  if (/^blob:/i.test(value) || /^data:(audio|video)\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    const rest = `${url.pathname}${url.search}${url.hash}`;
    if (/password|secret|token|authorization|api[-_]?key|credential/i.test(rest)) return "";
    return value;
  } catch {
    return "";
  }
}

/** A blank slide color uses the master. A stored color stays, even when it is not a color. */
function htmlBackground(slideColor: string | undefined, masterColor: string | undefined): string {
  const own = slideColor?.trim() ?? "";
  if (own) return cssColor(own, "#fff");
  return cssColor(masterColor, "#fff");
}

function cssFamily(value: string | undefined): string {
  const name = (value || "Arial").replace(/['"\\\r\n;{}<>]/g, "").trim();
  return `'${name || "Arial"}'`;
}

/** Standalone HTML download for a deck. */
export function deckToHtml(deck: Presentation, title: string): string {
  const slidesHtml = deck.slideOrder
    .filter((id) => deck.slides[id] && !deck.slides[id].hidden)
    .map((id, i) => {
      const s = deck.slides[id];
      if (!s) return "";
      const bg = `background-color: ${htmlBackground(s.background?.color, masterForSlide(deck, s).background?.color)};`;
      const elsHtml = s.elements
        .filter((el) => !el.decorative)
        .map((el) => {
          const pos = `position: absolute; left: ${(el.x / (deck.width || 960)) * 100}%; top: ${(el.y / (deck.height || 540)) * 100}%; width: ${(el.width / (deck.width || 960)) * 100}%; height: ${(el.height / (deck.height || 540)) * 100}%;`;
          if (el.type === "text") {
            const weight = hasTextRuns(el)
              ? "normal"
              : el.bold
                ? "bold"
                : "normal";
            const family = cssFamily(el.fontFamily);
            const outline =
              el.wordArt && el.stroke
                ? `-webkit-text-stroke:${el.strokeWidth || 2}px ${cssColor(el.stroke, "#000")};paint-order:stroke fill;-webkit-text-fill-color:currentColor;`
                : "";
            const style = `${pos} font-size: ${(el.fontSize || 20) * 1.5}px; font-weight: ${weight}; font-style: ${hasTextRuns(el) ? "normal" : el.italic ? "italic" : "normal"}; color: ${cssColor(el.color, "#1e293b")}; text-align: ${el.align || "left"}; white-space: pre-wrap; word-break: break-word; font-kerning: ${fontKerning(el.kern, el.fontSize || 20)}; font-feature-settings: ${kernFeature(el.kern, el.fontSize || 20)}; font-family: ${family};${outline}`;
            return `<div style="${style}">${textInnerHtml(el)}</div>`;
          }
          if (el.type === "image" && el.src) {
            return `<img src="${attr(marpMediaSrc(el.src, deck.marpAssets) ?? "")}" alt="${attr(el.alt || "image")}" style="${pos} object-fit: contain;" />`;
          }
          if ((el.type === "audio" || el.type === "video") && el.src) {
            const name = escapeHtml(el.alt || el.type);
            const poster = el.type === "video" && el.poster ? ` poster="${attr(el.poster)}"` : "";
            const src = mediaAddress(el.src);
            const source = src ? ` src="${attr(src)}"` : "";
            return `<div style="${pos}"><${el.type}${source}${poster} controls></${el.type}><p>${name}</p></div>`;
          }
          if (el.type === "shape") {
            const border = el.stroke
              ? `border: ${el.strokeWidth || 1}px solid ${cssColor(el.stroke, "#000")};`
              : "";
            const rad =
              el.shapeType === "ellipse"
                ? "border-radius: 50%;"
                : el.shapeType === "roundRect"
                  ? "border-radius: 12px;"
                  : "";
            return `<div style="${pos} background-color: ${cssColor(el.fill, "#e2e8f0")}; ${border} ${rad}"></div>`;
          }
          return "";
        })
        .join("\n");
      return `<section class="slide" id="slide-${i + 1}" style="${bg}">
          ${elsHtml}
          ${s.notes ? `<aside class="notes">Notes: ${escapeHtml(s.notes)}</aside>` : ""}
        </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #0f172a; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
    .slide { width: 960px; height: 540px; position: relative; box-shadow: 0 10px 25px rgba(0,0,0,0.5); overflow: hidden; margin-bottom: 2rem; border-radius: 4px; }
    .notes { max-width: 960px; margin: -1rem auto 2rem; color: #e2e8f0; font-size: 14px; }
    @media print { body { background: #fff; } .slide { page-break-after: always; box-shadow: none; margin: 0; width: 100%; height: 100vh; } }
  </style>
</head>
<body>
${slidesHtml}
</body>
</html>`;
}
