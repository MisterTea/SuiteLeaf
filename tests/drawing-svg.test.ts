// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  appendSvgElement,
  moveSvgElement,
  newShapeMarkup,
  removeSvgElement,
  resizeSvgElement,
  scanSvg,
  setSvgAttributes,
  setSvgText,
  svgElementAt,
  svgText,
  svgViewBox,
} from "../apps/web/src/editors/drawing-svg";

const picture = `<?xml version="1.0"?>
<!-- a comment with <rect> in it -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g id="group" transform="translate(10, 5)">
    <rect x="1" y="2" width="30" height="20" data-note="a > b"/>
  </g>
  <circle cx="50" cy="50" r="10" />
  <text x="5" y="90">Hi &amp; bye</text>
</svg>
`;

describe("scanning SVG source", () => {
  it("finds elements in the order a DOM parser does, skipping comments and declarations", () => {
    const tags = scanSvg(picture);
    expect(tags.map((t) => t.name)).toEqual(["svg", "g", "rect", "circle", "text"]);
    const dom = new DOMParser().parseFromString(picture, "image/svg+xml");
    expect([...dom.querySelectorAll("*")].map((e) => e.localName)).toEqual(tags.map((t) => t.name));
    expect(tags[2].parent).toBe(1);
    expect(tags[2].selfClosing).toBe(true);
    expect(picture.slice(tags[1].start, tags[1].end)).toMatch(/^<g[\s\S]*<\/g>$/);
  });

  it("finds the innermost element under an offset", () => {
    expect(svgElementAt(picture, picture.indexOf("<rect x") + 3)).toBe(2);
    expect(svgElementAt(picture, picture.indexOf("Hi"))).toBe(4);
    expect(svgElementAt(picture, 0)).toBeNull();
  });
});

describe("editing SVG source in place", () => {
  it("changes, adds, and removes attributes without touching the rest", () => {
    const next = setSvgAttributes(picture, 3, { r: "12", fill: "#ff0000", cx: null });
    expect(next).toContain('<circle cy="50" r="12" fill="#ff0000" />');
    expect(next.replace(/<circle[^>]*>/, "")).toBe(picture.replace(/<circle[^>]*>/, ""));
  });

  it("escapes attribute values", () => {
    expect(setSvgAttributes(picture, 3, { fill: 'a"<b' })).toContain('fill="a&quot;&lt;b"');
  });

  it("moves plain shapes by their coordinates and others by a transform", () => {
    expect(moveSvgElement(picture, 3, 5, -5)).toContain('<circle cx="55" cy="45" r="10" />');
    expect(moveSvgElement(picture, 1, 5, 5)).toContain('<g id="group" transform="translate(15 10)">');
    const path = `<svg><path d="M0 0L5 5" transform="rotate(45)"/></svg>`;
    expect(moveSvgElement(path, 1, 2, 3)).toContain('transform="translate(2 3) rotate(45)"');
  });

  it("never moves the root", () => {
    expect(moveSvgElement(picture, 0, 5, 5)).toBe(picture);
  });

  it("resizes boxes from the corner and circles from the centre", () => {
    expect(resizeSvgElement(picture, 2, 10, 5)).toContain('width="40" height="25"');
    expect(resizeSvgElement(picture, 3, 4, 2)).toContain('r="14"');
    expect(resizeSvgElement(picture, 2, -100, -100)).toContain('width="1" height="1"');
  });

  it("edits the text of an element without child elements", () => {
    expect(svgText(picture, 4)).toBe("Hi & bye");
    expect(svgText(picture, 1)).toBeNull();
    expect(setSvgText(picture, 4, "a < b")).toContain('<text x="5" y="90">a &lt; b</text>');
    expect(setSvgText(`<svg><text/></svg>`, 1, "x")).toBe("<svg><text>x</text></svg>");
  });

  it("removes an element along with its line", () => {
    const next = removeSvgElement(picture, 3);
    expect(next).not.toContain("circle");
    expect(next).toContain("  </g>\n  <text");
    expect(removeSvgElement(picture, 0)).toBe(picture);
  });

  it("appends an element as the root's last child at its children's indentation", () => {
    const { source, index } = appendSvgElement(picture, '<rect width="1" height="1"/>');
    expect(source).toContain('</text>\n  <rect width="1" height="1"/>\n</svg>');
    expect(scanSvg(source)[index].name).toBe("rect");
    expect(scanSvg(source)[index].parent).toBe(0);
    const tight = appendSvgElement(`<svg></svg>`, "<g/>");
    expect(tight.source).toBe("<svg>\n  <g/>\n</svg>");
  });

  it("centres new shapes in the view box", () => {
    expect(svgViewBox(picture)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(svgViewBox(`<svg width="40" height="30"/>`)).toEqual({ x: 0, y: 0, width: 40, height: 30 });
    expect(newShapeMarkup(picture, "ellipse")).toContain('cx="100" cy="50" rx="25" ry="12.5"');
  });
});
