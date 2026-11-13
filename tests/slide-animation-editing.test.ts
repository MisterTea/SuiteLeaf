import { describe, expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import {
  animationEntries,
  animationPreviewTimeline,
  changeAnimationEntry,
} from "../apps/web/src/editors/slide-animation-editing";

function fixture() {
  const deck = (createFile("slide") as SlideFile).content;
  const id = deck.slideOrder[0];
  deck.slides[id].elements = [
    {
      id: "a",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      content: "Hello",
      animation: "fade-on-click",
      animationOrder: 1,
      animationDuration: 1000,
    },
    {
      id: "b",
      type: "text",
      x: 0,
      y: 80,
      width: 100,
      height: 50,
      content: "World",
      animation: "fly-on-click",
      animationOrder: 2,
      animationTrigger: "with",
      animationDuration: 500,
    },
    {
      id: "c",
      type: "shape",
      x: 0,
      y: 160,
      width: 100,
      height: 50,
      paragraphBuilds: [
        { start: 0, end: 0, order: 3, trigger: "after" },
        { start: 1, end: 2, order: 4 },
      ],
      animationExit: { order: 5 },
    },
  ];
  return { deck, id, rows: animationEntries(deck.slides[id]) };
}

describe("animation editing", () => {
  it("lists independent entrances, paragraph builds and exits with the slideshow's click groups", () => {
    const { rows } = fixture();
    expect(rows.map((row) => row.click)).toEqual([1, 1, 1, 2, 3]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(5);
    expect(rows[2].label).toBe("shape (paragraph 1)");
    expect(rows[4].label).toBe("shape (exit)");
    expect(animationEntries(undefined)).toEqual([]);
  });
  it("updates starts and duration without changing unrelated state or the original deck", () => {
    const { deck, id, rows } = fixture();
    const next = changeAnimationEntry(deck, id, rows[0].key, {
      trigger: "after",
      duration: 1200,
    })!;
    expect(next.slides[id].elements[0]).toMatchObject({
      animationTrigger: "after",
      animationDuration: 1200,
    });
    expect(deck.slides[id].elements[0].animationTrigger).toBeUndefined();
    expect(next.slides[id].elements[1]).toBe(deck.slides[id].elements[1]);
    expect(
      changeAnimationEntry(deck, id, rows[0].key, { duration: 9000 })!.slides[
        id
      ].elements[0].animationDuration,
    ).toBe(5000);
    expect(
      changeAnimationEntry(deck, id, rows[0].key, { duration: -10 })!.slides[id]
        .elements[0].animationDuration,
    ).toBe(0);
  });
  it("edits and removes just the chosen paragraph or exit", () => {
    const { deck, id, rows } = fixture();
    const next = changeAnimationEntry(deck, id, rows[2].key, {
      trigger: "with",
    })!;
    expect(
      next.slides[id].elements[2].paragraphBuilds?.map((b) => b.trigger),
    ).toEqual(["with", undefined]);
    const removed = changeAnimationEntry(next, id, rows[2].key, {
      remove: true,
    })!;
    expect(removed.slides[id].elements[2].paragraphBuilds).toHaveLength(1);
    expect(removed.slides[id].elements[2].animationExit).toBeTruthy();
    const exit = changeAnimationEntry(removed, id, rows[4].key, {
      trigger: "after",
    })!;
    expect(exit.slides[id].elements[2].animationExit?.trigger).toBe("after");
    expect(
      changeAnimationEntry(exit, id, rows[4].key, { remove: true })!.slides[id]
        .elements[2].animationExit,
    ).toBeUndefined();
    expect(
      changeAnimationEntry(deck, id, rows[0].key, { remove: true })!.slides[id]
        .elements[0].animation,
    ).toBeUndefined();
  });
  it("reorders individual builds and exits without duplicating objects", () => {
    const { deck, id, rows } = fixture();
    const next = changeAnimationEntry(deck, id, rows[2].key, { move: -1 })!;
    expect(animationEntries(next.slides[id]).map((r) => r.key)).toEqual([
      rows[0].key,
      rows[2].key,
      rows[1].key,
      rows[3].key,
      rows[4].key,
    ]);
    const exit = changeAnimationEntry(next, id, rows[4].key, { move: -1 })!;
    expect(animationEntries(exit.slides[id]).at(-1)?.key).toBe(rows[3].key);
    expect(
      changeAnimationEntry(deck, id, rows[0].key, { move: 1 }),
    ).toBeTruthy();
    expect(
      changeAnimationEntry(deck, id, rows[0].key, { move: -1 }),
    ).toBeNull();
    expect(changeAnimationEntry(deck, id, rows[4].key, { move: 1 })).toBeNull();
    expect(
      changeAnimationEntry(deck, "missing", "x", { remove: true }),
    ).toBeNull();
    expect(
      changeAnimationEntry(deck, id, "missing", { remove: true }),
    ).toBeNull();
    expect(
      changeAnimationEntry(deck, id, rows[0].key, { duration: NaN }),
    ).toBeNull();
  });
  it("previews with/after groups and pauses between clicks", () => {
    const { rows } = fixture();
    expect(animationPreviewTimeline(rows).map((item) => item.delay)).toEqual([
      0, 0, 500, 1350, 2200,
    ]);
    expect(animationPreviewTimeline([])).toEqual([]);
  });
});

it("keeps preview and slideshow start times aligned for with/after entrances", async () => {
  const { showAudienceHooks } =
    await import("../apps/web/src/editors/slide-show-audience");
  const { deck, id } = fixture();
  const slide = deck.slides[id];
  slide.elements[2] = {
    ...slide.elements[2],
    paragraphBuilds: undefined,
    animationExit: undefined,
    animation: "zoom-on-click",
    animationOrder: 3,
    animationTrigger: "after",
  };
  const hooks = showAudienceHooks(slide, {
    slideIndex: 0,
    revealed: 3,
    enteringId: "a",
  });
  expect(hooks.box!(slide.elements[0]).props?.style).toMatchObject({
    animationDuration: "1000ms",
    animationDelay: "0ms",
  });
  expect(hooks.box!(slide.elements[1]).className).toContain(
    "fly-on-click-enter",
  );
  expect(hooks.box!(slide.elements[1]).props?.style).toMatchObject({
    animationDelay: "0ms",
  });
  expect(hooks.box!(slide.elements[2]).props?.style).toMatchObject({
    animationDelay: "500ms",
  });
  const back = showAudienceHooks(slide, {
    slideIndex: 0,
    revealed: 3,
    enteringId: null,
  });
  expect(back.box!(slide.elements[1]).className).toContain(
    "fade-on-click-shown",
  );
});

it("matches slideshow click numbering after a with-previous event changes order", () => {
  const { deck, id } = fixture();
  const slide = deck.slides[id];
  slide.elements[2] = {
    ...slide.elements[2],
    paragraphBuilds: undefined,
    animationExit: undefined,
    animation: "zoom-on-click",
    animationOrder: 2,
  };
  expect(animationEntries(slide).map((entry) => entry.click)).toEqual([
    1, 1, 2,
  ]);
});

it("keeps an effect's position when choosing a different entrance", async () => {
  const { applySlideAnimation } =
    await import("../apps/web/src/editors/slide-fade-in");
  const { deck, id } = fixture();
  expect(
    applySlideAnimation(deck, id, "a", "zoom-on-click")!.slides[id].elements[0]
      .animationOrder,
  ).toBe(1);
});

it("labels unnamed animated pictures without mistaking them for the initial slide view", () => {
  const { deck, id } = fixture();
  const slide = deck.slides[id];
  slide.elements = [
    {
      ...slide.elements[0],
      type: "image",
      content: undefined,
      alt: "Slide image",
    },
    {
      ...slide.elements[1],
      type: "image",
      content: undefined,
      alt: "A newspaper clipping",
    },
    {
      ...slide.elements[0],
      id: "third",
      type: "image",
      content: undefined,
      alt: undefined,
      animationOrder: 3,
    },
    {
      ...slide.elements[0],
      id: "static",
      type: "image",
      content: undefined,
      alt: "Slide image",
      animation: undefined,
    },
  ];
  expect(animationEntries(slide).map((entry) => entry.label)).toEqual([
    "Picture 1",
    "A newspaper clipping",
    "Picture 3",
  ]);
});

it("names each bullet build from its own paragraphs, keeping blank paragraphs and soft breaks indexed correctly", () => {
  const { deck, id } = fixture();
  const slide = deck.slides[id];
  slide.elements = [
    {
      ...slide.elements[0],
      animation: undefined,
      content:
        "\nDo readings and attend lectures\nDo all assignments\nPrepare for exams\nCome to class",
      runs: [
        { text: "" },
        { text: "\n", paragraphBreak: true },
        { text: "Do readings " },
        { text: "and attend lectures", bold: true },
        { text: "\n", paragraphBreak: true },
        { text: "Do all assignments" },
        { text: "\n", paragraphBreak: true },
        { text: "Prepare for exams" },
        { text: "\n" },
        { text: "Come to class" },
      ],
      paragraphBuilds: [
        { start: 1, end: 1, order: 1 },
        { start: 2, end: 2, order: 2 },
        { start: 3, end: 3, order: 3 },
        { start: 1, end: 2, order: 4 },
      ],
    },
  ];
  expect(animationEntries(slide).map((row) => row.label)).toEqual([
    "Do readings and attend lectures (paragraph 2)",
    "Do all assignments (paragraph 3)",
    "Prepare for exams Come to class (paragraph 4)",
    "Do readings and attend lectures Do all assignments (paragraph 2)",
  ]);
});

it("reads plain-text bullet ranges and retains the full label for its tooltip", () => {
  const { deck, id } = fixture();
  const slide = deck.slides[id];
  const long =
    "Do readings and attend lectures! That's your primary source for the material";
  slide.elements = [
    {
      ...slide.elements[0],
      animation: undefined,
      content: `${long}\r\nDo all assignments\rPrepare for exams`,
      paragraphBuilds: [
        { start: 0, end: 0, order: 1 },
        { start: 1, end: 1, order: 2 },
        { start: 2, end: 2, order: 3 },
      ],
    },
  ];
  expect(animationEntries(slide).map((row) => row.label)).toEqual([
    `${long} (paragraph 1)`,
    "Do all assignments (paragraph 2)",
    "Prepare for exams (paragraph 3)",
  ]);
  slide.elements[0] = {
    ...slide.elements[0],
    content: undefined,
    runs: [{ text: "Only runs" }],
    paragraphBuilds: undefined,
    animation: "appear-on-click",
  };
  expect(animationEntries(slide)[0].label).toBe("Only runs");
});
