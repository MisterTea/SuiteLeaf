import { expect, it } from "vitest";
import {
  createFile,
  type SlideFile,
  type SlideElement,
} from "../packages/core/src";
import {
  animationEntries,
  animationGroups,
  animationGroupContains,
  animationPreviewTimeline,
  changeAnimationEntry,
} from "../apps/web/src/editors/slide-animation-editing";
import { applySlideAnimation } from "../apps/web/src/editors/slide-fade-in";
import { showAudienceHooks } from "../apps/web/src/editors/slide-show-audience";

function fixture() {
  const deck = (createFile("slide") as SlideFile).content;
  const id = deck.slideOrder[0];
  const base: SlideElement = {
    id: "fill",
    type: "shape",
    x: 20,
    y: 20,
    width: 200,
    height: 100,
    sourceShapeId: "5",
    animation: "appear-on-click",
    animationOrder: 1,
  };
  deck.slides[id].elements = [
    base,
    { ...base, id: "picture", type: "image", alt: "Slide image" },
    { ...base, id: "outline" },
    {
      ...base,
      id: "caption",
      type: "text",
      content: "The Economist, 2021",
      sourceShapeId: "6",
      animationTrigger: "with",
    },
  ];
  return { deck, id, slide: deck.slides[id] };
}

it("shows one named picture for its imported fill, image and outline, keeping a separate caption", () => {
  const { slide } = fixture();
  expect(animationEntries(slide)).toHaveLength(4);
  const groups = animationGroups(slide);
  expect(groups.map((group) => group.label)).toEqual([
    "Picture 1",
    "The Economist, 2021",
  ]);
  expect(groups[0].id).toBe("picture");
  expect(groups[0].members.map((member) => member.id)).toEqual([
    "fill",
    "picture",
    "outline",
  ]);
  expect(groups.map((group) => group.click)).toEqual([1, 1]);
  expect(animationGroupContains(groups[0], "outline")).toBe(true);
  expect(animationGroupContains(groups[0], null)).toBe(false);
  expect(animationGroups(undefined)).toEqual([]);
});

it("changes timing and effects across every painted part, including selection through a border", () => {
  const { deck, id } = fixture();
  const next = changeAnimationEntry(deck, id, "outline:entrance", {
    duration: 1300,
    trigger: "after",
  })!;
  expect(
    next.slides[id].elements
      .slice(0, 3)
      .every(
        (el) =>
          el.animationDuration === 1300 && el.animationTrigger === "after",
      ),
  ).toBe(true);
  expect(next.slides[id].elements[3].animationDuration).toBeUndefined();
  const changed = applySlideAnimation(next, id, "picture", "fly-on-click")!;
  expect(
    changed.slides[id].elements
      .slice(0, 3)
      .every(
        (el) =>
          el.animation === "fly-on-click" &&
          el.animationDuration === 1300 &&
          el.animationTrigger === "after",
      ),
  ).toBe(true);
  expect(animationGroups(changed.slides[id])).toHaveLength(2);
  expect(
    applySlideAnimation(changed, id, "outline", "fly-on-click"),
  ).toBeNull();
  const removed = applySlideAnimation(changed, id, "outline", null)!;
  expect(
    removed.slides[id].elements
      .slice(0, 3)
      .every(
        (el) => !el.animation && !el.animationDuration && !el.animationTrigger,
      ),
  ).toBe(true);
});

it("moves and removes the whole object without changing independent objects", () => {
  const { deck, id } = fixture();
  const moved = changeAnimationEntry(deck, id, "picture:entrance", {
    move: 1,
  })!;
  expect(
    moved.slides[id].elements.slice(0, 3).map((el) => el.animationOrder),
  ).toEqual([2, 2, 2]);
  expect(moved.slides[id].elements[3].animationOrder).toBe(1);
  const removed = changeAnimationEntry(moved, id, "picture:entrance", {
    remove: true,
  })!;
  expect(animationGroups(removed.slides[id]).map((group) => group.id)).toEqual([
    "caption",
  ]);
  expect(deck.slides[id].elements[0].animation).toBe("appear-on-click");
});

it("does not merge separate effects, paragraphs, or unrelated objects on the same click", () => {
  const { slide } = fixture();
  slide.elements[0].animationDuration = 1000;
  expect(animationGroups(slide)).toHaveLength(3);
  slide.elements[0].animationDuration = undefined;
  slide.elements[0].animationOrder = 2;
  expect(animationGroups(slide)).toHaveLength(3);
  slide.elements[0].animationOrder = 1;
  slide.elements[0].sourceShapeId = undefined;
  expect(animationGroups(slide)).toHaveLength(3);
  slide.elements[0].sourceShapeId = "5";
  slide.elements[1].paragraphBuilds = [
    { start: 0, end: 0, order: 2 },
    { start: 1, end: 1, order: 3 },
  ];
  for (const el of slide.elements.slice(0, 3)) el.animationExit = { order: 4 };
  const groups = animationGroups(slide);
  expect(groups).toHaveLength(5);
  expect(groups.filter((group) => group.exit)).toHaveLength(1);
  expect(groups.find((group) => group.exit)?.members).toHaveLength(3);
  expect(groups.filter((group) => group.paragraphs)).toHaveLength(2);
});

it("starts all layers together for after-previous effects during slideshow playback", () => {
  const { slide } = fixture();
  const caption = slide.elements.pop()!;
  caption.animationTrigger = undefined;
  caption.animationOrder = 1;
  caption.animationDuration = 1000;
  for (const el of slide.elements) {
    el.animationOrder = 2;
    el.animationTrigger = "after";
    el.animation = "fly-on-click";
  }
  slide.elements.unshift(caption);
  expect(
    animationPreviewTimeline(animationGroups(slide)).map((item) => item.delay),
  ).toEqual([0, 1000]);
  const hooks = showAudienceHooks(slide, {
    slideIndex: 0,
    revealed: 4,
    enteringId: caption.id,
  });
  for (const el of slide.elements.slice(1))
    expect(hooks.box!(el).props?.style?.animationDelay).toBe("1000ms");
});
