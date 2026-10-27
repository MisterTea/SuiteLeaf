import DOMPurify from "dompurify";
import type { DrawingFormat } from "@suiteleaf/core";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Marks each element of an SVG drawing with its place in the source. */
export const INDEX_ATTRIBUTE = "data-sl-index";

export type DrawingRender =
  | {
      /** Safe to put on the page. */
      svg: string;
      /** The picture as its renderer made it, for export. */
      raw: string;
      error?: undefined;
    }
  | { error: string; svg?: undefined; raw?: undefined };

function sanitize(svg: string) {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["foreignObject", "use"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
}

/** An SVG drawing's own text, checked and numbered so each element on screen leads back to it. */
export function prepareSvg(source: string): DrawingRender {
  if (!source.trim()) return { error: "The drawing is empty." };
  let doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const problem = doc.querySelector("parsererror");
  if (problem) {
    const text = problem.textContent?.replace(/\s+/g, " ").trim();
    return { error: text || "The SVG is not well-formed." };
  }
  if (doc.documentElement.localName !== "svg") return { error: "The drawing must start with an <svg> element." };
  // A browser only draws elements in the SVG namespace, so a root without one gets it.
  if (doc.documentElement.namespaceURI !== SVG_NS) {
    const withNamespace = source.replace(/<svg\b/, `<svg xmlns="${SVG_NS}"`);
    doc = new DOMParser().parseFromString(withNamespace, "image/svg+xml");
  }
  doc.querySelectorAll("*").forEach((element, index) => element.setAttribute(INDEX_ATTRIBUTE, String(index)));
  const marked = new XMLSerializer().serializeToString(doc.documentElement);
  return { svg: sanitize(marked), raw: source };
}

let mermaidSerial = 0;
async function renderMermaid(source: string): Promise<DrawingRender> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });
  try {
    const { svg } = await mermaid.render(`drawing-mermaid-${++mermaidSerial}`, source);
    return { svg: sanitize(svg), raw: svg };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

let viz: Promise<import("@viz-js/viz").Viz> | null = null;
async function renderGraphviz(source: string): Promise<DrawingRender> {
  viz ??= import("@viz-js/viz").then((module) => module.instance());
  const result = (await viz).render(source, { format: "svg" });
  if (result.status !== "success")
    return { error: result.errors.map((e) => e.message).join("\n") || "The graph could not be drawn." };
  return { svg: sanitize(result.output), raw: result.output };
}

export async function renderDrawing(format: DrawingFormat, source: string): Promise<DrawingRender> {
  if (format === "svg") return prepareSvg(source);
  if (!source.trim()) return { error: "The drawing is empty." };
  return format === "mermaid" ? renderMermaid(source) : renderGraphviz(source);
}

const PX: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
function length(value: string | null) {
  const match = /^\s*([\d.]+)\s*(px|pt|pc|in|cm|mm)?\s*$/.exec(value ?? "");
  return match ? Number(match[1]) * PX[match[2] ?? "px"] : null;
}

/** How big a picture is in CSS pixels: its width and height, else its view box, else SVG's default. */
export function naturalSize(svg: Element) {
  const box = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const boxed = box?.length === 4 && box[2] > 0 && box[3] > 0 ? { width: box[2], height: box[3] } : null;
  const width = length(svg.getAttribute("width"));
  const height = length(svg.getAttribute("height"));
  if (width && height) return { width, height };
  if (boxed && width) return { width, height: (width * boxed.height) / boxed.width };
  if (boxed && height) return { width: (height * boxed.width) / boxed.height, height };
  return boxed ?? { width: 300, height: 150 };
}

/** A PNG of an SVG picture, at twice its size, on white. */
export async function svgToPng(svg: string): Promise<Uint8Array> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg") throw new Error("There is no picture to export.");
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", SVG_NS);
  const size = naturalSize(root);
  root.setAttribute("width", String(size.width));
  root.setAttribute("height", String(size.height));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(size.width * 2);
    canvas.height = Math.ceil(size.height * 2);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The picture could not be turned into a PNG.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
