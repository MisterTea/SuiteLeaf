// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createFile } from "@suiteleaf/core";
import { SlideFace } from "../../apps/web/src/editors/slide-surface";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("draws plain WordArt as ink stretched across the shape", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    return {
      font: "",
      measureText: (text: string) => ({
        width: text.length * 40,
        actualBoundingBoxLeft: 6,
        actualBoundingBoxRight: 30,
        actualBoundingBoxAscent: 70,
        actualBoundingBoxDescent: 5,
        fontBoundingBoxAscent: 80,
        fontBoundingBoxDescent: 20,
      }),
    } as unknown as CanvasRenderingContext2D;
  });
  const file = createFile("slide", "Pitch");
  if (file.kind !== "slide") throw new Error("expected slides");
  const deck = file.content;
  const slide = deck.slides[deck.slideOrder[0]];
  slide.elements.push({
    id: "numeral",
    type: "text",
    x: 40,
    y: 20,
    width: 200,
    height: 400,
    content: "2",
    fontSize: 96,
    fontFamily: "SuiteLeaf Ironwood Black",
    color: "#000000",
    runs: [{ text: "2", color: "#b9cde5" }],
    stretchText: true,
  });
  render(<SlideFace deck={deck} slide={slide} index={0} />);
  const svg = document.querySelector("svg[data-stretch-text='true']");
  expect(svg?.getAttribute("viewBox")).toBe("0 0 36 75");
  expect(svg?.getAttribute("preserveAspectRatio")).toBe("none");
  const glyph = svg?.querySelector("text");
  expect(glyph?.textContent).toBe("2");
  expect(glyph?.getAttribute("fill")).toBe("#b9cde5");
  expect(glyph?.getAttribute("x")).toBe("6");
  expect(glyph?.getAttribute("y")).toBe("70");
});
