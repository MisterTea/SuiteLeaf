// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Presentation, SlideElement } from "../../packages/core/src";
import { SlideFace } from "../../apps/web/src/editors/slide-face";
import { AutofitBox, autofitFontSize } from "../../apps/web/src/editors/slide-autofit";
import { cellBody } from "../../apps/web/src/editors/slide-table-cell";
import { MarpCode, MarpMath, MarpRichText } from "../../apps/web/src/editors/slide-marp-math";
import { lineEndPath, slideBackgroundPaint } from "../../apps/web/src/editors/slide-surface-paint";

let observed: (() => void)[] = [];
beforeEach(() => {
  observed = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observed.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PIC = "data:image/png;base64,iVBORw0KGgo=";
const at = (id: string, extra: Partial<SlideElement>): SlideElement => ({
  id,
  type: "shape",
  x: 10,
  y: 10,
  width: 200,
  height: 100,
  ...extra,
});

function draw(elements: SlideElement[], deck: Partial<Presentation> = {}, still = false, hooks = {}) {
  const full: Presentation = {
    id: "d",
    width: 960,
    height: 540,
    slideOrder: ["s"],
    slides: { s: { id: "s", elements } },
    ...deck,
  } as Presentation;
  const view = render(
    <div className="slide-surface">
      <SlideFace deck={full} slide={full.slides.s} index={2} still={still} hooks={hooks} />
    </div>,
  );
  const drawn = (id: string) => view.container.querySelector<HTMLElement>(`[data-element-id="${id}"]`)!;
  return { ...view, drawn };
}
const tag = (el: SlideElement) => ({ props: { "data-element-id": el.id } });

describe("drawing each kind of text", () => {
  it("draws code, display math, inline math, runs, and plain words", () => {
    const view = draw(
      [
        at("code", { type: "text", content: "print('hi') < 2", preformatted: true, codeLanguage: "python" }),
        at("cobol", { type: "text", content: "MOVE A TO B", preformatted: true, codeLanguage: "cobol" }),
        at("math", { type: "text", content: "$$\nx^2\n$$", math: true }),
        at("rich", { type: "text", content: "Area $\\pi r^2$ and $$E=mc^2$$ done" }),
        at("runs", { type: "text", content: "ab", runs: [{ text: "a", bold: true }, { text: "b" }] }),
        at("plain", { type: "text", content: "Plain", textFlow: "upright", valign: "middle", fill: "#eeeeee" }),
      ],
      { slideNumbers: true },
      false,
      { box: tag },
    );
    expect(view.drawn("code").querySelector("pre.marp-code .hljs-built_in, pre.marp-code span")).not.toBeNull();
    expect(view.drawn("cobol").querySelector("pre.marp-code")!.textContent).toBe("MOVE A TO B");
    expect(view.drawn("math").querySelector(".marp-math .katex")).not.toBeNull();
    expect(view.drawn("rich").querySelectorAll(".katex")).toHaveLength(2);
    expect(view.drawn("runs").querySelector('[data-bold="1"]')).not.toBeNull();
    expect(view.drawn("plain").style.writingMode).toBe("vertical-lr");
    expect(view.drawn("plain").dataset.valign).toBe("middle");
    expect(view.getByLabelText("Slide number 3").textContent).toBe("3");
  });

  it("falls back to the source when the math cannot be typeset", async () => {
    const katex = (await import("katex")).default;
    const boom = vi.spyOn(katex, "renderToString").mockImplementation(() => {
      throw new Error("bad tex");
    });
    const math = render(<MarpMath source={"$$\\frac{$$"} />);
    expect(math.container.querySelector("pre")!.textContent).toBe("$$\\frac{$$");
    const rich = render(<MarpRichText source="cost $x$ now" />);
    expect(rich.container.textContent).toBe("cost $x$ now");
    boom.mockReturnValue("");
    const empty = render(<MarpRichText source="$y$" />);
    expect(empty.container.textContent).toBe("$y$");
    const hljs = (await import("highlight.js/lib/core")).default;
    vi.spyOn(hljs, "highlight").mockImplementation(() => {
      throw new Error("no grammar");
    });
    const code = render(<MarpCode source="a < b & c" />);
    expect(code.container.querySelector("pre")!.innerHTML).toBe("a &lt; b &amp; c");
  });
});

describe("drawing pictures, shapes, tables, and media", () => {
  it("draws clipped, linked, cropped, tiled, and turned pictures", () => {
    const view = draw(
      [
        at("clip", { type: "image", src: PIC, clipPath: "M0 0 L10 0 L10 10 Z", cropLeft: 10, cropRight: 10, cropTop: 120 }),
        at("clip-turned", { type: "image", src: PIC, clipPath: "M0 0 L10 10 Z", rotation: 30 }),
        at("link", { type: "image", src: PIC, href: "https://example.com", opacity: 0.5, softEdge: 4 }),
        at("crop", { type: "image", src: PIC, cropLeft: 10, shadow: { x: 1, y: 1, blur: 2, color: "#000" } }),
        at("tile", { type: "image", src: PIC, tile: { width: 20, height: 20, x: 0, y: 0 } }),
        at("turned", { type: "image", src: PIC, rotation: 90 }),
        at("emf", { type: "image", src: "data:image/emf;base64,AA==" }),
        at("gone", { type: "image", src: PIC, x: 2000 }),
      ],
      {},
      false,
      { box: tag },
    );
    expect(view.drawn("clip").querySelector("clipPath path")!.getAttribute("d")).toBe("M0 0 L10 0 L10 10 Z");
    expect(view.drawn("clip").querySelector("image")!.getAttribute("width")).toBe("250");
    expect(view.drawn("clip-turned").querySelector("g[transform]")).not.toBeNull();
    expect(view.drawn("link").querySelector("a")!.getAttribute("href")).toBe("https://example.com");
    expect(view.drawn("link").style.opacity).toBe("0.5");
    expect(view.drawn("crop").firstElementChild!.getAttribute("style")).toContain("overflow: hidden");
    expect(view.drawn("turned").querySelector("svg image")).not.toBeNull();
    expect(view.drawn("emf").querySelector("img")!.getAttribute("alt")).toBe("");
    expect(view.drawn("gone")).toBeNull();
  });

  it("draws lines with ends, rotated shapes, ellipses, and outlined shapes", () => {
    const view = draw(
      [
        at("line", { shapeType: "line", stroke: "#ff0000", strokeWidth: 2, strokeStyle: "dashed", lineHead: "oval", lineTail: "stealth", flipH: true }),
        at("arrow", { shapeType: "arrow", height: 0, lineTail: "diamond", lineTailSize: "lg", lineHeadSize: "sm", flipV: true }),
        at("turn", { shapeType: "rect", rotation: 45, fill: "#00ff00" }),
        at("oval", { shapeType: "ellipse", fill: "#0000ff", stroke: "#000000", strokeStyle: "dotted", softEdge: 3 }),
        at("oval-grad", { shapeType: "ellipse", fill: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)" }),
        at("oval-straight", { shapeType: "ellipse", fill: "linear-gradient(90deg, rgba(255,0,0,1) 0%, rgba(0,0,255,0.5) 100%)" }),
        at("round", { shapeType: "roundRect", stroke: "#000000", strokeWidth: 3, strokeStyle: "dashed" }),
        at("radius", { shapeType: "rect", radius: 6 }),
        at("html", { marpHtml: true }),
      ],
      {},
      false,
      { box: tag, after: (el: SlideElement) => (el.marpHtml ? <span className="label">HTML</span> : null) },
    );
    expect(view.drawn("line").querySelectorAll("path")).toHaveLength(2);
    expect(view.drawn("line").querySelector("line")!.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(view.drawn("arrow").querySelectorAll("path")).toHaveLength(1);
    expect(view.drawn("turn")).not.toBeNull();
    expect(view.drawn("oval").querySelector("ellipse")!.getAttribute("fill")).toBe("#0000ff");
    expect(view.drawn("oval-grad").querySelector("ellipse")!.getAttribute("fill")).toBe("url(#slf-oval-grad)");
    expect(view.drawn("oval-grad").querySelector("defs")!.innerHTML).toContain('id="slf-oval-grad"');
    expect(view.drawn("oval-straight").querySelector("ellipse")).toBeNull();
    expect(view.drawn("round").querySelector("rect")!.getAttribute("rx")).toBe("12");
    expect(view.drawn("radius").style.borderRadius).toContain("6");
    expect(view.drawn("html").querySelector(".label")).not.toBeNull();
  });

  it("draws tables with spans, widths, row heights, and cell runs", () => {
    const view = draw(
      [
        at("table", {
          type: "table",
          rows: [
            ["a `code` b", "two\nlines\n"],
            ["tab\there", "runs"],
          ],
          colWidths: [0.4, 0.6],
          rowHeights: [40, null as unknown as number],
          rtl: true,
          fill: "#ffffff",
          fontSize: 18,
          cellMarks: [
            [{ colSpan: 1, fill: "#eeeeee" }, { rowSpan: 2 }],
            [{ bold: true, tabSize: 36 }, { runs: [{ text: "x", color: "#ff0000" }] }],
          ],
        }),
      ],
      { marpFit: 5 },
      false,
      { box: tag, cell: () => ({ className: "cell" }) },
    );
    const table = view.drawn("table");
    expect(table.querySelectorAll("col")).toHaveLength(2);
    expect(table.querySelector("table")!.style.direction).toBe("rtl");
    expect(table.querySelector("code")!.textContent).toBe("code");
    expect(table.querySelectorAll("td")[1].querySelectorAll(":scope span[style*='display: block'], :scope [data-row-clip] span")).not.toHaveLength(0);
    expect(table.querySelector('[data-color="#ff0000"]')).not.toBeNull();
    expect(table.querySelector("td.cell")).not.toBeNull();
  });

  it("draws media controls on the slide and a still picture for print", () => {
    const media = [
      at("song", { type: "audio", src: "data:audio/mpeg;base64,AA==" }),
      at("clip", { type: "video", src: "data:video/mp4;base64,AA==" }),
    ];
    const live = draw(media, {}, false, { box: tag });
    expect(live.drawn("song").dataset.media).toBe("audio");
    expect(live.drawn("clip").querySelector(".slide-media-play")).not.toBeNull();
    cleanup();
    const still = draw([...media, at("cut", { type: "text", content: "Off the page", y: -50 })], {}, true, { box: tag });
    expect(still.drawn("clip").className).toContain("slide-video-still");
    expect(still.drawn("clip").querySelector(".slide-media-play")).toBeNull();
    expect(still.drawn("cut").querySelector(".slide-text-shift")).not.toBeNull();
  });

  it("writes table cells with indents and tab stops", () => {
    const view = render(
      <div>
        {cellBody("one\n\ttwo\n", {
          lines: [{ margin: 10, hang: 5 }, { tabs: [{ pos: 72, align: "l" }] }, {}],
          bold: true,
          italic: true,
          font: "Arial",
          fontSize: 12,
        })}
        {cellBody("first", { lines: [{ first: 8 }] })}
      </div>,
    );
    const lines = view.container.querySelectorAll<HTMLElement>(":scope > div > span");
    expect(lines[0].style.paddingLeft).toContain("15px");
    expect(lines[0].style.textIndent).toContain("-5px");
    expect(lines[1].innerHTML).toContain("inline-block");
    expect(lines[2].textContent).toBe("\u00a0");
    expect(lines[3].innerHTML).toContain("text-indent");
  });
});

describe("shrinking words to fit", () => {
  it("finds the largest size that fits, stopping at the smallest readable size", () => {
    expect(autofitFontSize((px) => px <= 20, 40)).toBeCloseTo(20, 0);
    expect(autofitFontSize(() => false, 40)).toBe(8);
    expect(autofitFontSize(() => false, 6)).toBe(6);
    expect(autofitFontSize(() => true, 40)).toBe(40);
    expect(autofitFontSize(() => true, 0)).toBe(0);
  });

  it("shrinks the box's type while its words overflow and follows a resize", () => {
    let room = 100;
    const area = (node: HTMLElement) => parseFloat(node.style.fontSize || "40") * 5;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => room);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return area(this);
    });
    const box = (autofit: boolean, signature = "a") => (
      <div className="slide-surface">
        <AutofitBox autofit={autofit} normalPx={40} signature={signature} style={{ fontSize: "40px" }} data-testid="box">
          <div className="slide-text-face">words</div>
        </AutofitBox>
      </div>
    );
    const view = render(box(true));
    const fitted = () => parseFloat(view.getByTestId("box").style.fontSize);
    expect(fitted()).toBeLessThanOrEqual(20);
    expect(fitted()).toBeGreaterThan(19);
    room = 1000;
    act(() => observed.forEach((callback) => callback()));
    expect(view.getByTestId("box").style.fontSize).toBe("40px");
    room = 50;
    view.rerender(box(true, "b"));
    expect(fitted()).toBeLessThanOrEqual(10);
    view.rerender(box(false, "b"));
    expect(view.getByTestId("box").style.fontSize).toBe("40px");
  });
});

describe("slide paint helpers", () => {
  it("paints solid, office, and straight gradient backgrounds", () => {
    expect(slideBackgroundPaint("#ffffff")).toEqual({ backgroundColor: "#ffffff" });
    expect(slideBackgroundPaint("linear-gradient(90deg, #fff 0%, #000 100%)").background).toContain("gradient");
    expect(lineEndPath("triangle", 6, { x: 10, y: 0 }, { x: 1, y: 0 })).toBe("M 10,0 L 4,3 L 4,-3 Z");
  });
});
