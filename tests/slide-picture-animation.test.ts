import { expect, it } from "vitest";
import type { Slide, SlideElement } from "../packages/core/src";
import { pictureAnimationOwner } from "../apps/web/src/editors/slide-picture-animation";
import { showAudienceHooks } from "../apps/web/src/editors/slide-show-audience";
import { clickSteps } from "../apps/web/src/editors/slide-fade-in";

const bounds = { x: 100, y: 100, width: 400, height: 200 };
const picture = (extra: Partial<SlideElement> = {}): SlideElement => ({
  ...bounds, id: "picture", type: "image", src: "picture.png", animation: "fade-on-click",
  animationOrder: 1, animationDuration: 1200, animationExit: { order: 2 }, ...extra,
});
const frame = (extra: Partial<SlideElement> = {}): SlideElement => ({
  ...bounds, id: "frame", type: "shape", shapeType: "rect", fill: "transparent",
  stroke: "#000000", strokeWidth: 2, ...extra,
});

it.each([true, false])("reveals and hides the picture's painted frame on the same clicks (source IDs=%s)", (sourceIds) => {
  const source = sourceIds ? { sourceShapeId: "5" } : {};
  const image = picture(source);
  const fill = frame({ ...source, id: "fill", fill: "#ffffff", stroke: undefined });
  const outline = frame(source);
  const unrelated = frame({ id: "other", x: 700 });
  const slide = { id: "a", elements: [fill, image, outline, unrelated] } as Slide;
  const original = structuredClone(slide);
  expect(clickSteps(slide.elements)).toEqual([1, 1]);
  for (const [revealed, enteringId, hidden] of [
    [0, null, true], [1, "picture", false], [1, null, false], [2, null, true], [0, null, true],
  ] as const) {
    const hooks = showAudienceHooks(slide, { slideIndex: 0, revealed, enteringId });
    const imageView = hooks.box!(image);
    for (const part of [fill, outline]) {
      const view = hooks.box!(part);
      expect(view.className).toBe(imageView.className);
      expect(view.props?.["data-fade"]).toBe(hidden ? "hidden" : "visible");
      expect(view.props?.style).toEqual(imageView.props?.style);
    }
    expect(hooks.box!(unrelated).props?.["data-fade"]).toBeUndefined();
  }
  expect(slide).toEqual(original);
});

it("uses source identity for clipped or rotated frame artwork", () => {
  const image = picture({ sourceShapeId: "7", rotation: 45 });
  const outline = frame({ sourceShapeId: "7", shapeType: "ellipse", width: 420 });
  expect(pictureAnimationOwner(outline, [outline, image])).toBe(image);
});

it("keeps a picture's outline hidden through its after-previous delay", () => {
  const first = frame({ id: "first", x: 800, animation: "appear-on-click", animationOrder: 1, animationDuration: 1000 });
  const image = picture({ animationOrder: 2, animationTrigger: "after" });
  const outline = frame();
  const slide = { id: "a", elements: [first, image, outline] } as Slide;
  const hooks = showAudienceHooks(slide, { slideIndex: 0, revealed: 2, enteringId: "first" });
  expect(hooks.box!(outline).className).toBe(hooks.box!(image).className);
  expect(hooks.box!(outline).props?.style).toMatchObject({ animationDelay: "1000ms", animationDuration: "1200ms" });
});

it("recognizes an adjacent legacy outline even when only the picture retained its source ID", () => {
  const image = picture({ sourceShapeId: "7" });
  const outline = frame();
  expect(pictureAnimationOwner(outline, [image, outline])).toBe(image);
});

it.each([
  { animation: "appear-on-click" as const }, { animationExit: { order: 3 } },
  { paragraphBuilds: [{ start: 0, end: 0, order: 1 }] }, { marpHtml: "<div>HTML</div>" },
  { content: "Label" }, { sourceShapeId: "9" }, { shapeType: "ellipse" as const },
  { x: 101 }, { y: 101 }, { width: 401 }, { height: 201 }, { rotation: 90 },
  { flipH: true }, { flipV: true },
])("preserves independent artwork and nonmatching rectangles: %j", (extra) => {
  const image = picture({ sourceShapeId: "7" });
  const outline = frame(extra);
  expect(pictureAnimationOwner(outline, [image, outline])).toBe(outline);
});

it("does not attach a distant rectangle or an element outside the slide", () => {
  const image = picture();
  const outline = frame();
  const separator = frame({ id: "separator", x: 800 });
  expect(pictureAnimationOwner(outline, [image, separator, outline])).toBe(outline);
  expect(pictureAnimationOwner(outline, [image])).toBe(outline);
  expect(pictureAnimationOwner(image, [image, outline])).toBe(image);
});
