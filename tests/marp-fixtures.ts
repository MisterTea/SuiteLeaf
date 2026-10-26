import type { Presentation, Slide, SlideElement, TextRun } from "../packages/core/src";
import { newSlide } from "../apps/web/src/editors/slide-layouts";
import { createMarpFile, keepElementIds } from "../apps/web/src/editors/slide-marp";
import {
  isHtmlOnly,
  mapMarpSource,
  markdownUnits,
  normalizeMarp,
} from "../apps/web/src/editors/slide-marp-source";
import { MARP_FIT_REVISION } from "../apps/web/src/editors/slide-marp-fit";
import { deckFromMarkdown } from "../apps/web/src/editors/slide-marp-sync";

/** One style for the whole box when every word shares it, as the fit stores it. */
function collapse(runs: TextRun[]): Partial<SlideElement> {
  const words = runs.filter((run) => run.text.trim());
  const first = words[0] ?? {};
  const uniform = words.every(
    (run) =>
      !!run.bold === !!first.bold &&
      !!run.italic === !!first.italic &&
      !!run.underline === !!first.underline &&
      !run.color,
  );
  if (!uniform) return { runs: runs.map((run) => ({ ...run })) };
  return {
    ...(first.bold ? { bold: true } : {}),
    ...(first.italic ? { italic: true } : {}),
    ...(first.underline ? { underline: true } : {}),
  };
}

/**
 * Boxes laid out from the markdown the way the editor's fit lays them out:
 * one per heading, paragraph, picture, and list, each with the markdown
 * lines it came from. Headings are bold, as the theme draws them.
 */
export function fakeFit(deck: Presentation): Presentation {
  const map = mapMarpSource(normalizeMarp(deck.marpSource ?? ""));
  const order = [...deck.slideOrder];
  const slides: Record<string, Slide> = { ...deck.slides };
  map.slides.forEach((source, index) => {
    const offset = source.lines[0];
    const chunk = map.lines.slice(source.lines[0], source.lines[1]);
    const elements: SlideElement[] = [];
    let y = 20;
    let titled = false;
    let list: SlideElement | null = null;
    let number = 0;
    const box = (el: Omit<SlideElement, "id" | "x" | "y" | "width" | "height">, height = 40) => {
      const placed = { id: crypto.randomUUID(), x: 48, y, width: 860, height, ...el } as SlideElement;
      y += height + 8;
      elements.push(placed);
      return placed;
    };
    for (const unit of markdownUnits(chunk.join("\n"))) {
      const lines: [number, number] = [offset + unit.lines[0], offset + unit.lines[1]];
      const text = unit.runs.map((run) => run.text).join("").replace(/[ \t]+/g, " ").trim();
      const written = chunk.slice(unit.lines[0], unit.lines[1]).join("\n");
      if (unit.kind === "paragraph" && isHtmlOnly(written)) {
        box({ type: "shape", shapeType: "rect", marpHtml: true, marpLines: lines }, 80);
        list = null;
        continue;
      }
      const image = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(written);
      if (image)
        box({ type: "image", src: image[2], alt: image[1] || "Image", marpLines: lines }, 120);
      if (!text) {
        list = null;
        continue;
      }
      const styled = unit.runs.some((run) => run.bold || run.italic || run.underline || run.color);
      if (unit.kind === "item") {
        const ordered = /\d/.test(unit.prefix);
        const indent = " ".repeat(/^\s*/.exec(unit.prefix)![0].length);
        number = list ? number + 1 : Number(/\d+/.exec(unit.prefix)?.[0] ?? 1);
        const line = `${indent}${ordered ? `${number}. ` : "• "}${text}`;
        if (list && list.marpLines![1] === lines[0] && !styled && !list.runs) {
          list.content = `${list.content}\n${line}`;
          list.marpLines = [list.marpLines![0], lines[1]];
          continue;
        }
        list = box({
          type: "text",
          content: line,
          marpLines: lines,
          ...(styled ? { runs: [{ text: `${indent}${ordered ? `${number}. ` : "• "}` }, ...unit.runs] } : {}),
        });
        continue;
      }
      list = null;
      if (unit.kind === "heading" && !titled) {
        titled = true;
        box(
          {
            type: "text",
            content: text,
            placeholder: "Click to add title",
            marpLines: lines,
            ...collapse(unit.runs.map((run) => ({ ...run, bold: true }))),
          },
          60,
        );
        continue;
      }
      box({
        type: "text",
        content: text,
        marpLines: lines,
        ...(unit.kind === "heading" ? { bold: true } : {}),
        ...(styled && unit.kind !== "heading" ? { runs: unit.runs.map((run) => ({ ...run })) } : {}),
      });
    }
    for (const lines of source.html)
      box({ type: "shape", shapeType: "rect", marpHtml: true, marpLines: lines }, 80);
    elements.sort((a, b) => (a.marpLines?.[0] ?? 0) - (b.marpLines?.[0] ?? 0));
    let top = 20;
    for (const el of elements) {
      el.y = top;
      top += el.height + 8;
    }
    const id = order[index] ?? crypto.randomUUID();
    if (!order[index]) order.push(id);
    const previous = slides[id] ?? { ...newSlide("blank"), id };
    slides[id] = { ...previous, id, elements: keepElementIds(previous.elements, elements) };
  });
  return {
    ...deck,
    slideOrder: order.slice(0, map.slides.length),
    slides,
    marpFit: MARP_FIT_REVISION,
  };
}

/** A laid-out MARP deck from markdown. */
export function marpDeck(markdown: string): Presentation {
  const file = createMarpFile("Deck");
  const { deck } = deckFromMarkdown(file.content, markdown);
  return fakeFit(deck);
}
