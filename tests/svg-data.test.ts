// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  heightForNewShape,
  isSvgDataUri,
  svgDataUri,
  svgFromDataUri,
} from "../apps/web/src/editors/svg-data";
import { createFile, parseFile, serializeFile, type DocFile } from "../packages/core/src";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text>Café ✓</text></svg>';

describe("SVG pictures written into a file", () => {
  it("round-trips SVG text through a base64 data URI, accents and symbols included", () => {
    const src = svgDataUri(SVG);
    expect(src.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(isSvgDataUri(src)).toBe(true);
    expect(svgFromDataUri(src)).toBe(SVG);
  });

  it("reads percent-encoded SVG too", () => {
    expect(svgFromDataUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`)).toBe(SVG);
  });

  it("only takes SVG data", () => {
    expect(isSvgDataUri("data:image/png;base64,AAAA")).toBe(false);
    expect(isSvgDataUri("pictures/logo.svg")).toBe(false);
    expect(isSvgDataUri(undefined)).toBe(false);
    expect(svgFromDataUri("data:image/svg+xml;base64,%%%")).toBeNull();
  });

  it("keeps a picture's width and changes its height only when the drawing changes shape", () => {
    const tall = SVG.replace('height="100"', 'height="400"');
    expect(heightForNewShape(300, SVG, SVG.replace("Café", "Tea"))).toBeNull();
    expect(heightForNewShape(300, SVG, tall)).toBe(600);
    expect(heightForNewShape(0, SVG, tall)).toBeNull();
  });

  it("lets a document keep an SVG picture", () => {
    const file = createFile("doc", "Logo") as DocFile;
    file.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "inlineImage", attrs: { src: svgDataUri(SVG) } }] }],
    };
    expect(parseFile(serializeFile(file))).toEqual(file);
  });
});
