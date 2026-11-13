// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Slide } from "@suiteleaf/core";
import { useSlideMobileTextZoom } from "../../apps/web/src/editors/slide-mobile-text-zoom";

afterEach(() => vi.restoreAllMocks());

function setup(width = 390, readOnly = false, type = "text") {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
  const stage = document.createElement("div");
  stage.innerHTML = '<div class="slide-canvas" style="width: 100%; background: red"></div>';
  const canvas = stage.firstElementChild as HTMLElement;
  Object.defineProperties(stage, { clientWidth: { value: 390 }, clientHeight: { value: 300 } });
  vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(() => ({
    left: 8, top: 12, width: canvas.style.width.endsWith("px") ? parseFloat(canvas.style.width) : 374,
  }) as DOMRect);
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
  const slide = { id: "slide", elements: [{ id: "text", type, x: 400, y: 300, width: 400, height: 80 }] } as Slide;
  const ref = { current: stage };
  const hook = renderHook(({ focused }) => useSlideMobileTextZoom(ref, slide, focused, 960, readOnly), {
    initialProps: { focused: null as string | null },
  });
  return { ...hook, stage, canvas };
}

it("zooms the focused box and restores canvas sizing and scroll when editing ends", () => {
  const { stage, canvas, rerender } = setup();
  stage.scrollLeft = 5;
  stage.scrollTop = 10;
  const style = canvas.getAttribute("style");
  rerender({ focused: "text" });
  expect(parseFloat(canvas.style.width)).toBeCloseTo(859.2);
  expect(stage.scrollLeft).toBeGreaterThan(5);
  expect(stage.scrollTop).toBeGreaterThan(10);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(parseFloat(canvas.style.width)).toBeCloseTo(859.2);
  rerender({ focused: null });
  expect(canvas.getAttribute("style")).toBe(style);
  expect(stage.scrollLeft).toBe(5);
  expect(stage.scrollTop).toBe(10);
});

it.each([[1024, false, "text"], [390, true, "text"], [390, false, "image"]] as const)(
  "leaves the view unchanged at width %s, readOnly %s, type %s",
  (width, readOnly, type) => {
    const { canvas, rerender } = setup(width, readOnly, type);
    rerender({ focused: "text" });
    expect(canvas.style.width).toBe("100%");
  },
);
