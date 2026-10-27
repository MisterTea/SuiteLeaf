// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { INDEX_ATTRIBUTE, naturalSize, prepareSvg, renderDrawing } from "../apps/web/src/editors/drawing-render";
import { scanSvg } from "../apps/web/src/editors/drawing-svg";
import {
  createDrawingFile,
  drawingExports,
  drawingFormatFor,
  importDrawing,
} from "../apps/web/src/editors/drawing-format";
import { parseFile, serializeFile } from "@suiteleaf/core";

describe("drawing SVG source", () => {
  it("numbers each element by its place in the source and drops scripts", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
  <script>alert(1)</script>
  <style>rect { fill: red }</style>
  <rect width="5" height="5" onclick="alert(1)"/>
  <defs><linearGradient id="g"/></defs>
  <use href="#g"/>
</svg>`;
    const result = prepareSvg(source);
    expect(result.error).toBeUndefined();
    const host = document.createElement("div");
    host.innerHTML = result.svg!;
    expect(host.querySelector("script")).toBeNull();
    expect(host.innerHTML).not.toMatch(/onload|onclick/);
    expect(host.querySelector("style")).not.toBeNull();
    const rect = host.querySelector("rect")!;
    const index = Number(rect.getAttribute(INDEX_ATTRIBUTE));
    expect(scanSvg(source)[index].name).toBe("rect");
    const use = Number(host.querySelector("use")!.getAttribute(INDEX_ATTRIBUTE));
    expect(scanSvg(source)[use].name).toBe("use");
  });

  it("says what is wrong with source that is not SVG", () => {
    expect(prepareSvg("<svg><rect></svg>").error).toBeTruthy();
    expect(prepareSvg("<html/>").error).toBe("The drawing must start with an <svg> element.");
    expect(prepareSvg("  ").error).toBe("The drawing is empty.");
  });

  it("draws an SVG with no namespace", () => {
    const result = prepareSvg(`<svg width="10" height="10"><circle r="4"/></svg>`);
    expect(result.svg).toContain("circle");
  });

  it("sizes pictures from their width and height, or their view box", () => {
    const svg = (attrs: string) => new DOMParser().parseFromString(`<svg ${attrs}/>`, "image/svg+xml").documentElement;
    expect(naturalSize(svg('width="72pt" height="36pt"'))).toEqual({ width: 96, height: 48 });
    expect(naturalSize(svg('width="100%" viewBox="0 0 40 20"'))).toEqual({ width: 40, height: 20 });
    expect(naturalSize(svg('width="80" viewBox="0 0 40 20"'))).toEqual({ width: 80, height: 40 });
  });
});

describe("drawing Graphviz", () => {
  it("draws a graph whose nodes carry their ids", async () => {
    const result = await renderDrawing("graphviz", 'digraph { a -> "b c" }');
    expect(result.error).toBeUndefined();
    const host = document.createElement("div");
    host.innerHTML = result.svg!;
    const titles = [...host.querySelectorAll("g.node > title")].map((t) => t.textContent);
    expect(titles).toEqual(["a", "b c"]);
    expect(result.raw).toMatch(/^<\?xml|^<svg|<!DOCTYPE/);
  });

  it("reports the line of a syntax error", async () => {
    const result = await renderDrawing("graphviz", "digraph { a -> }");
    expect(result.error).toMatch(/syntax error/i);
  });
});

describe("drawing files", () => {
  it("opens from .svg, .mmd, .mermaid, and .gv, and not from a Word .dot template", () => {
    expect(drawingFormatFor("a.SVG")).toBe("svg");
    expect(drawingFormatFor("flow.mmd")).toBe("mermaid");
    expect(drawingFormatFor("flow.mermaid")).toBe("mermaid");
    expect(drawingFormatFor("g.gv")).toBe("graphviz");
    expect(drawingFormatFor("letter.dot")).toBeNull();
    expect(drawingFormatFor("svg")).toBeNull();
  });

  it("keeps the imported text exactly, apart from a byte-order mark", () => {
    const file = importDrawing("Org chart.gv", "\uFEFFgraph { a -- b }\n")!;
    expect(file.title).toBe("Org chart");
    expect(file.content).toEqual({ format: "graphviz", source: "graph { a -- b }\n" });
    expect(parseFile(serializeFile(file))).toEqual(file);
  });

  it("exports the text first, then pictures of it", () => {
    expect(drawingExports("svg")).toEqual(["svg", "png"]);
    expect(drawingExports("mermaid")).toEqual(["mmd", "svg", "png"]);
    expect(drawingExports("graphviz")).toEqual(["gv", "svg", "png"]);
  });

  it("starts new drawings with an example of their kind", () => {
    expect(createDrawingFile("mermaid").content.source).toMatch(/^flowchart/);
    expect(createDrawingFile("graphviz").title).toBe("Untitled Graphviz drawing");
  });
});
