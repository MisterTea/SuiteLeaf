import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type Presentation,
  type SlideFile,
} from "../packages/core/src";
import {
  FADE_ON_CLICK,
  applyFadeOnClick,
  applySlideAnimation,
  animationEnterMs,
  audienceClass,
  audiencePhase,
  clickSteps,
  fadeOnClickIds,
  fadeOnClickReason,
  fadesOnClick,
  moveShowCursor,
  shownSlideIndex,
  nextCursor,
  prevCursor,
  startOfShow,
} from "../apps/web/src/editors/slide-fade-in";

function deck(): { presentation: Presentation; slideId: string; chartId: string; calloutId: string } {
  const file = createFile("slide", "Q3 update") as SlideFile;
  const slideId = file.content.slideOrder[0];
  const chartId = "chart";
  const calloutId = "september";
  file.content.slides[slideId].elements = [
    {
      id: chartId,
      type: "shape",
      x: 80,
      y: 140,
      width: 80,
      height: 200,
      shapeType: "rect",
      fill: "#1a73e8",
    },
    {
      id: calloutId,
      type: "text",
      x: 400,
      y: 160,
      width: 280,
      height: 80,
      content: "September",
    },
  ];
  file.content.slideOrder.push("next");
  file.content.slides.next = {
    id: "next",
    elements: [
      {
        id: "after",
        type: "text",
        x: 80,
        y: 40,
        width: 400,
        height: 60,
        content: "What changed",
      },
    ],
  };
  return { presentation: file.content, slideId, chartId, calloutId };
}

describe("fade in on click", () => {
  it("stores a chosen entrance and plays click order", () => {
    const { presentation, slideId, chartId, calloutId } = deck();
    const flown = applySlideAnimation(presentation, slideId, chartId, "fly-on-click");
    const faded = applySlideAnimation(flown!, slideId, calloutId, "fade-on-click");
    const elements = faded!.slides[slideId].elements;
    expect(elements.find((el) => el.id === chartId)?.animation).toBe("fly-on-click");
    expect(fadeOnClickIds(elements)).toEqual([chartId, calloutId]);
    expect(applySlideAnimation(faded!, slideId, chartId, null)!.slides[slideId].elements.find((el) => el.id === chartId)?.animation).toBeUndefined();
  });

  it("marks only the selected object and keeps it in the saved file", () => {
    const { presentation, slideId, chartId, calloutId } = deck();
    const marked = applyFadeOnClick(presentation, slideId, calloutId);
    expect(marked).not.toBeNull();
    const elements = marked!.slides[slideId].elements;
    expect(elements.find((el) => el.id === calloutId)?.animation).toBe(FADE_ON_CLICK);
    expect(elements.find((el) => el.id === chartId)?.animation).toBeUndefined();
    expect(applyFadeOnClick(marked!, slideId, calloutId)).toBeNull();
    expect(fadeOnClickReason(undefined)).toMatch(/Select an object/);
    expect(fadeOnClickReason(elements.find((el) => el.id === calloutId))).toMatch(/already/);
    expect(fadeOnClickReason(elements.find((el) => el.id === chartId))).toBeUndefined();

    const file = createFile("slide", "Q3 update") as SlideFile;
    file.content = marked!;
    const again = parseFile(serializeFile(file)) as SlideFile;
    const saved = again.content.slides[slideId].elements;
    expect(saved.find((el) => el.id === calloutId)?.animation).toBe(FADE_ON_CLICK);
    expect(fadesOnClick(saved.find((el) => el.id === chartId))).toBe(false);
  });

  it("uses the next click to reveal, and the click after that to change slides", () => {
    const { presentation, slideId } = deck();
    const marked = applyFadeOnClick(presentation, slideId, "september")!;
    const ids = fadeOnClickIds(marked.slides[slideId].elements);
    expect(ids).toEqual(["september"]);
    const hidden = startOfShow(0);
    expect(audiencePhase({ id: "chart" }, 0, ids, null)).toBe("plain");
    expect(audiencePhase({ id: "september", animation: FADE_ON_CLICK }, 0, ids, null)).toBe(
      "hidden",
    );

    const revealed = nextCursor(hidden, ids, 2);
    expect(revealed).toEqual({ slideIndex: 0, revealed: 1, enteringId: "september" });
    expect(
      audiencePhase(
        { id: "september", animation: FADE_ON_CLICK },
        revealed.revealed,
        ids,
        revealed.enteringId,
      ),
    ).toBe("entering");

    const advanced = nextCursor(revealed, ids, 2);
    expect(advanced).toEqual({ slideIndex: 1, revealed: 0, enteringId: null });
    const stayed = nextCursor(advanced, [], 2);
    expect(stayed.slideIndex).toBe(1);

    const back = prevCursor(advanced, (index) => (index === 0 ? ids : []));
    expect(back).toEqual({ slideIndex: 0, revealed: 1, enteringId: null });
    expect(audiencePhase({ id: "september", animation: FADE_ON_CLICK }, back.revealed, ids, null)).toBe(
      "shown",
    );
  });

  it("does not reveal an object that was not marked", () => {
    const ids = fadeOnClickIds([
      { id: "chart" },
      { id: "september", animation: FADE_ON_CLICK },
    ]);
    expect(moveShowCursor(startOfShow(), "next", () => ids, 2).slideIndex).toBe(0);
    expect(audiencePhase({ id: "chart" }, 0, ids, null)).toBe("plain");
  });

  it("reveals two objects that share an order on one click", () => {
    const elements = [
      { id: "title", animation: FADE_ON_CLICK, animationOrder: 1 },
      { id: "photo", animation: "fly-on-click" as const, animationOrder: 1 },
      { id: "note" },
    ];
    const ids = fadeOnClickIds(elements);
    const steps = clickSteps(elements);
    expect(steps).toEqual([2]);
    const shown = nextCursor(startOfShow(), ids, 1, steps);
    expect(shown).toEqual({ slideIndex: 0, revealed: 2, enteringId: "title" });
    expect(audiencePhase({ id: "photo", animation: "fly-on-click" }, shown.revealed, ids, shown.enteringId)).toBe(
      "shown",
    );
    expect(audiencePhase({ id: "note" }, shown.revealed, ids, shown.enteringId)).toBe("plain");
    const back = prevCursor(shown, () => ids, () => steps);
    expect(back.revealed).toBe(0);
    expect(JSON.stringify(shown)).not.toContain("secret-value");
  });

  it("starts the next object after the previous entrance on the same click", () => {
    const elements = [
      { id: "title", animation: FADE_ON_CLICK, animationOrder: 1 },
      { id: "photo", animation: "fly-on-click" as const, animationOrder: 2, animationTrigger: "after" },
      { id: "note" },
    ];
    const ids = fadeOnClickIds(elements);
    const steps = clickSteps(elements);
    expect(steps).toEqual([2]);
    const shown = nextCursor(startOfShow(), ids, 1, steps);
    expect(shown).toEqual({ slideIndex: 0, revealed: 2, enteringId: "title" });
    expect(audiencePhase(elements[1], shown.revealed, ids, shown.enteringId)).toBe("after");
    expect(audienceClass("after", "fly-on-click")).toContain("animation-after-previous");
    expect(audiencePhase({ id: "note" }, shown.revealed, ids, shown.enteringId)).toBe("plain");
    expect(JSON.stringify(shown)).not.toContain("secret-value");
  });

  it("uses a stored entrance length and keeps the default when the length is unusable", () => {
    expect(animationEnterMs(undefined)).toBe(600);
    expect(animationEnterMs(1500)).toBe(1500);
    expect(animationEnterMs(9000)).toBe(5000);
    expect(animationEnterMs(Number.NaN)).toBe(600);
    expect(animationEnterMs(-4)).toBe(0);
    const file = createFile("slide", "Talk") as SlideFile;
    const slideId = file.content.slideOrder[0];
    file.content.slides[slideId].elements.push({
      id: "title",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      content: "Welcome",
      animation: "fade-on-click",
      animationDuration: 1500,
    });
    const opened = parseFile(serializeFile(file));
    if (opened.kind !== "slide") throw new Error("Expected slides");
    const element = opened.content.slides[slideId].elements.find((item) => item.id === "title");
    expect(element?.animationDuration).toBe(1500);
    expect(animationEnterMs(element?.animationDuration)).toBe(1500);
    expect(JSON.stringify(element)).not.toContain("secret-value");
  });

  it("skips a hidden slide while the show moves", () => {
    const shown = (index: number) => index !== 1;
    expect(shownSlideIndex(1, 3, 1, shown)).toBe(2);
    const next = moveShowCursor(startOfShow(0), "next", () => [], 3, () => [], shown);
    expect(next.slideIndex).toBe(2);
    const back = moveShowCursor(next, "prev", () => [], 3, () => [], shown);
    expect(back.slideIndex).toBe(0);
    const home = moveShowCursor(next, "home", () => [], 3, () => [], (index) => index !== 0);
    expect(home.slideIndex).toBe(1);
    expect(JSON.stringify({ next, back, home })).not.toContain("secret-value");
  });
});
