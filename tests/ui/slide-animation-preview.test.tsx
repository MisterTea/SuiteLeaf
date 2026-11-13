// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createFile, type SlideFile } from "../../packages/core/src";
import { useAnimationPreview } from "../../apps/web/src/editors/slide-animation-preview";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(reduced = false) {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  const deck = (createFile("slide") as SlideFile).content;
  const slide = deck.slides[deck.slideOrder[0]];
  const kinds = [
    "fade-on-click",
    "appear-on-click",
    "fly-on-click",
    "wipe-on-click",
    "zoom-on-click",
  ] as const;
  slide.elements = kinds.map((animation, i) => ({
    id: `object${i}`,
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    animation,
    animationOrder: i + 1,
  }));
  slide.elements.push({
    id: "paragraphs",
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    paragraphBuilds: [{ start: 1, end: 2, order: 6 }],
    animationExit: { order: 7 },
  });
  const root = document.createElement("div");
  root.innerHTML = `<div class="slide-canvas">${slide.elements.map((el) => `<div data-element-id="${el.id}">${el.id === "paragraphs" ? '<p data-para-index="0"></p><p data-para-index="1"></p><p data-para-index="2"></p>' : ""}</div>`).join("")}</div>`;
  document.body.append(root);
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  root
    .querySelectorAll<HTMLElement>("[data-element-id], [data-para-index]")
    .forEach((node) => {
      node.animate = animate as unknown as HTMLElement["animate"];
    });
  const ref = { current: root as HTMLDivElement | null };
  const hook = renderHook(
    ({ currentSlide }) => useAnimationPreview(ref, currentSlide),
    { initialProps: { currentSlide: slide } },
  );
  return { ...hook, slide, ref, animate, cancel };
}

it("previews each entrance and individual paragraphs, then restores every object", () => {
  const hook = setup();
  act(() => hook.result.current.play());
  expect(hook.animate).toHaveBeenCalledTimes(8);
  expect(hook.animate.mock.calls[0]).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    expect.objectContaining({ duration: 600 }),
  ]);
  expect(hook.animate.mock.calls[1][1]).toMatchObject({ duration: 0 });
  expect(hook.animate.mock.calls[2][0][0]).toMatchObject({
    translate: "-32px 0",
  });
  expect(hook.animate.mock.calls[3][0][0]).toMatchObject({
    clipPath: "inset(0 100% 0 0)",
  });
  expect(hook.animate.mock.calls[7][0]).toEqual([
    { opacity: 1 },
    { opacity: 0 },
  ]);
  act(() => vi.runAllTimers());
  expect(hook.result.current.playing).toBe(false);
  expect(hook.cancel).toHaveBeenCalledTimes(8);
});

it("honors reduced motion and cancels when the slide changes", () => {
  const hook = setup(true);
  act(() => hook.result.current.play("object2:entrance"));
  expect(hook.animate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ duration: 0, delay: 650 }),
  );
  hook.rerender({ currentSlide: { ...hook.slide, elements: [] } });
  expect(hook.cancel).toHaveBeenCalledTimes(1);
  act(() => vi.runAllTimers());
  expect(hook.result.current.playing).toBe(false);
});

it("handles missing objects, paragraphs, animation APIs, and an unmounted canvas", () => {
  const hook = setup();
  hook.ref.current!.innerHTML =
    '<div class="slide-canvas"><div data-element-id="object0"></div></div>';
  act(() => hook.result.current.play());
  expect(hook.animate).not.toHaveBeenCalled();
  act(() => hook.result.current.stop());
  hook.ref.current = null;
  act(() => hook.result.current.play("missing"));
  act(() => vi.runAllTimers());
  expect(hook.result.current.playing).toBe(false);
});

it("gives instant Appear effects a hidden starting state and time to see the result", () => {
  const hook = setup();
  act(() => hook.result.current.play("object1:entrance"));
  expect(hook.animate).toHaveBeenCalledWith(
    [{ opacity: 0 }, { opacity: 1 }],
    expect.objectContaining({ duration: 0, delay: 650, fill: "both" }),
  );
  act(() => vi.advanceTimersByTime(650));
  expect(hook.result.current.playing).toBe(true);
  expect(hook.cancel).not.toHaveBeenCalled();
  act(() => vi.runAllTimers());
  expect(hook.cancel).toHaveBeenCalledTimes(1);
});

it("previews all painted parts when the picture's single row is requested", () => {
  const hook = setup();
  const slide = {
    ...hook.slide,
    elements: hook.slide.elements
      .slice(0, 3)
      .map((el, index) => ({
        ...el,
        sourceShapeId: "5",
        type: index === 1 ? ("image" as const) : ("shape" as const),
        animation: "appear-on-click" as const,
        animationOrder: 1,
      })),
  };
  hook.rerender({ currentSlide: slide });
  act(() => hook.result.current.play("object1:entrance"));
  expect(hook.animate).toHaveBeenCalledTimes(3);
  expect(hook.animate.mock.calls.map((call) => call[1])).toEqual(
    Array.from({ length: 3 }, () =>
      expect.objectContaining({ delay: 650, duration: 0 }),
    ),
  );
});
