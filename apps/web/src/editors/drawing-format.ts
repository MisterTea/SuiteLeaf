import {
  createFile,
  DRAWING_SOURCE_CHARS,
  DRAWING_STARTERS,
  type DrawingFile,
  type DrawingFormat,
} from "@suiteleaf/core";

/** File extensions a drawing opens from. `.dot` stays a Word template. */
const FROM_EXTENSION: Record<string, DrawingFormat> = {
  svg: "svg",
  mmd: "mermaid",
  mermaid: "mermaid",
  gv: "graphviz",
};
export const DRAWING_IMPORT_EXTENSIONS = Object.keys(FROM_EXTENSION);

export function drawingFormatFor(name: string): DrawingFormat | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return name.includes(".") ? (FROM_EXTENSION[ext] ?? null) : null;
}

/** The extension a drawing's own text is saved with. */
export const SOURCE_EXTENSION: Record<DrawingFormat, string> = {
  svg: "svg",
  mermaid: "mmd",
  graphviz: "gv",
};

export const FORMAT_NAME: Record<DrawingFormat, string> = {
  svg: "SVG",
  mermaid: "Mermaid",
  graphviz: "Graphviz",
};

/** What File › Export offers: the text itself first, then pictures of it. */
export function drawingExports(format: DrawingFormat): string[] {
  return format === "svg" ? ["svg", "png"] : [SOURCE_EXTENSION[format], "svg", "png"];
}

export function createDrawingFile(
  format: DrawingFormat,
  title = `Untitled ${FORMAT_NAME[format]} drawing`,
  source = DRAWING_STARTERS[format],
): DrawingFile {
  const file = createFile("drawing", title.slice(0, 200)) as DrawingFile;
  return { ...file, content: { format, source } };
}

export function importDrawing(name: string, text: string): DrawingFile | null {
  const format = drawingFormatFor(name);
  if (!format) return null;
  if (text.length > DRAWING_SOURCE_CHARS) throw new Error("Drawings are limited to 5 million characters.");
  const title = name.replace(/\.[^.]+$/, "").slice(0, 200) || "Imported drawing";
  return createDrawingFile(format, title, text.replace(/^\uFEFF/, ""));
}
