import { describe, expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import { animationSequence } from "../packages/core/src/slide-motion";
import { applySlideAnimation } from "../apps/web/src/editors/slide-fade-in";
import {
  selectedAnimationParagraphs,
  applySelectedParagraphAnimation,
} from "../apps/web/src/editors/slide-animation-selection";
import { animationEntries } from "../apps/web/src/editors/slide-animation-editing";

function fixture() {
  const deck = (createFile("slide") as SlideFile).content;
  const id = deck.slideOrder[0];
  deck.slides[id].elements = [
    {
      id: "body",
      type: "text",
      x: 20,
      y: 20,
      width: 400,
      height: 200,
      content: "• First bullet\n• Second bullet\n• Third bullet",
    },
  ];
  return { deck, id, element: deck.slides[id].elements[0] };
}

describe("entrances for selected bullets", () => {
  it("maps partial and reversed selections to bullets, excluding an unselected next line", () => {
    const { element } = fixture();
    const second = element.content!.indexOf("• Second");
    const third = element.content!.indexOf("• Third");
    expect(
      selectedAnimationParagraphs(element, { start: second + 2, end: third }),
    ).toEqual([1]);
    expect(
      selectedAnimationParagraphs(element, {
        start: third + 4,
        end: second + 2,
      }),
    ).toEqual([1, 2]);
    expect(
      selectedAnimationParagraphs(element, { start: second, end: second }),
    ).toEqual([]);
    expect(
      selectedAnimationParagraphs(element, { start: NaN, end: 4 }),
    ).toEqual([]);
    expect(
      selectedAnimationParagraphs(
        { ...element, type: "shape" },
        { start: 0, end: 4 },
      ),
    ).toEqual([]);
  });
  it("uses Office paragraph separators, keeps soft breaks inside a bullet and skips blanks", () => {
    const { element } = fixture();
    element.runs = [
      { text: "" },
      { text: "\n", paragraphBreak: true },
      { text: "• First\ncontinued" },
      { text: "\n", paragraphBreak: true },
      { text: "• Second" },
    ];
    expect(selectedAnimationParagraphs(element, { start: 0, end: 30 })).toEqual(
      [1, 2],
    );
    expect(
      selectedAnimationParagraphs(element, { start: 10, end: 15 }),
    ).toEqual([1]);
  });
  it("creates individual effects only on selected bullets and preserves the chosen effect", () => {
    const { deck, id, element } = fixture();
    const next = applySlideAnimation(deck, id, "body", "fly-on-click", {
      start: 2,
      end: element.content!.indexOf("• Third"),
    })!;
    expect(next.slides[id].elements[0].animation).toBeUndefined();
    expect(
      animationSequence(next.slides[id].elements).map((item) => [
        item.kind,
        item.paragraphs,
      ]),
    ).toEqual([
      ["fly-on-click", { start: 0, end: 0 }],
      ["fly-on-click", { start: 1, end: 1 }],
    ]);
    expect(animationEntries(next.slides[id]).map((item) => item.label)).toEqual(
      ["• First bullet (paragraph 1)", "• Second bullet (paragraph 2)"],
    );
    expect(deck.slides[id].elements[0].paragraphBuilds).toBeUndefined();
  });
  it("replaces overlapping builds without losing unselected bullets, timing or unrelated objects", () => {
    const { deck, id, element } = fixture();
    element.paragraphBuilds = [
      { start: 0, end: 2, order: 1, trigger: "with", kind: "wipe-on-click" },
    ];
    element.animation = "fade-on-click";
    element.animationOrder = 1;
    element.sourceShapeId = "5";
    deck.slides[id].elements.push({
      ...element,
      id: "art",
      type: "shape",
      paragraphBuilds: undefined,
    });
    deck.slides[id].elements.push({
      ...element,
      id: "other",
      sourceShapeId: "6",
    });
    const next = applySlideAnimation(deck, id, "body", "zoom-on-click", {
      start: element.content!.indexOf("Second"),
      end: element.content!.indexOf("Second") + 2,
    })!;
    expect(next.slides[id].elements[0].paragraphBuilds).toEqual([
      { start: 0, end: 0, order: 1, trigger: "with", kind: "wipe-on-click" },
      { start: 2, end: 2, order: 1, trigger: "with", kind: "wipe-on-click" },
      { start: 1, end: 1, order: 1, trigger: "with", kind: "zoom-on-click" },
    ]);
    expect(next.slides[id].elements[1].animation).toBeUndefined();
    expect(next.slides[id].elements[2]).toBe(
      element === deck.slides[id].elements[2]
        ? element
        : deck.slides[id].elements[2],
    );
  });
  it("switches back to one whole-textbox entrance when the selection is collapsed or absent", () => {
    const { deck, id } = fixture();
    const bullets = applySlideAnimation(deck, id, "body", "fade-on-click", {
      start: 0,
      end: 30,
    })!;
    const whole = applySlideAnimation(bullets, id, "body", "zoom-on-click", {
      start: 4,
      end: 4,
    })!;
    expect(whole.slides[id].elements[0]).toMatchObject({
      animation: "zoom-on-click",
    });
    expect(whole.slides[id].elements[0].paragraphBuilds).toBeUndefined();
    expect(animationSequence(whole.slides[id].elements)).toHaveLength(1);
    expect(
      applySelectedParagraphAnimation(
        deck,
        "missing",
        "body",
        "fade-on-click",
        { start: 0, end: 10 },
      ),
    ).toBeNull();
    expect(
      applySelectedParagraphAnimation(deck, id, "missing", "fade-on-click", {
        start: 0,
        end: 10,
      }),
    ).toBeNull();
    expect(
      applySelectedParagraphAnimation(deck, id, "body", "fade-on-click", {
        start: 1000,
        end: 1100,
      }),
    ).toBeNull();
  });
});
