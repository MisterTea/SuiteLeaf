import PptxGenJS from "pptxgenjs";
import type { SlideElement, SlideFile, TextRun } from "./index";
import { stampSlideMotion } from "./slide-motion";

const PX_PER_INCH = 96;

function color(value: string | undefined, fallback = "1E293B") {
  const hex = (value ?? "").replace("#", "");
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : fallback;
}

function runs(el: SlideElement): TextRun[] {
  if (el.runs?.length) return el.runs.filter((run) => run.text);
  if (!el.content) return [];
  const run: TextRun = { text: el.content };
  if (el.bold) run.bold = true;
  if (el.italic) run.italic = true;
  if (el.underline) run.underline = true;
  if (el.color) run.color = el.color;
  return [run];
}

function box(el: SlideElement) {
  return {
    x: el.x / PX_PER_INCH,
    y: el.y / PX_PER_INCH,
    w: Math.max(el.width, 1) / PX_PER_INCH,
    h: Math.max(el.height, 1) / PX_PER_INCH,
  };
}

function shapeName(el: SlideElement): string {
  if (el.shapeType === "ellipse") return "ellipse";
  if (el.shapeType === "roundRect") return "roundRect";
  if (el.shapeType === "line") return "line";
  if (el.shapeType === "arrow") return "rightArrow";
  return "rect";
}

/** Write the editable presentation as a PPTX file. */
export async function exportPptx(file: SlideFile): Promise<Uint8Array> {
  const deck = file.content;
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "SUITELEAF",
    width: deck.width / PX_PER_INCH,
    height: deck.height / PX_PER_INCH,
  });
  pptx.layout = "SUITELEAF";
  pptx.title = file.title;
  for (const id of deck.slideOrder) {
    const source = deck.slides[id];
    if (!source) continue;
    const slide = pptx.addSlide();
    if (source.background?.color)
      slide.background = { color: color(source.background.color, "FFFFFF") };
    for (const el of source.elements) {
      const place = box(el);
      if (el.type === "image" && el.src) {
        const image = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.exec(el.src);
        if (!image) continue;
        slide.addImage({ data: el.src, altText: el.alt, ...place });
        continue;
      }
      if (el.type === "table" && el.rows?.length) {
        slide.addTable(
          el.rows.map((row, rowIndex) =>
            row.map((cell, column) => {
              const mark = el.cellMarks?.[rowIndex]?.[column];
              return {
                text: cell,
                options: { bold: mark?.bold, italic: mark?.italic },
              };
            }),
          ),
          { ...place, fontFace: el.fontFamily || "Arial", fontSize: el.fontSize || 14 },
        );
        continue;
      }
      if (el.type === "shape") {
        slide.addShape(shapeName(el) as unknown as PptxGenJS.ShapeType, {
          ...place,
          fill: el.fill ? { color: color(el.fill, "FFFFFF") } : undefined,
          line: el.stroke
            ? { color: color(el.stroke, "000000"), width: el.strokeWidth || 1 }
            : undefined,
        });
      }
      const text = runs(el);
      if (!text.length) continue;
      slide.addText(
        text.map((run) => ({
          text: run.text,
          options: {
            bold: run.bold ?? el.bold,
            italic: run.italic ?? el.italic,
            underline: run.underline || el.underline ? { style: "sng" as const } : undefined,
            color: color(run.color || el.color),
          },
        })),
        {
          ...place,
          fontSize: el.fontSize || 18,
          fontFace: el.fontFamily || "Arial",
          align: el.align || "left",
          bullet: el.bullet ? { indent: 10 } : undefined,
          valign: "top",
        },
      );
    }
    if (source.notes) slide.addNotes(source.notes);
  }
  if (!deck.slideOrder.length) pptx.addSlide();
  const written = await pptx.write({ outputType: "uint8array" });
  const bytes = written instanceof Uint8Array ? written : new Uint8Array(written as ArrayBuffer);
  const slides = deck.slideOrder.map((id) => deck.slides[id]).filter((slide) => slide != null);
  return stampSlideMotion(bytes, slides);
}
