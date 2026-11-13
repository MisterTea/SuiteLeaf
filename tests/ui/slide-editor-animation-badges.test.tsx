// @vitest-environment jsdom
import { waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { box, openSlides, setupSlidesDom, words } from "./slide-editor-harness";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));
setupSlidesDom();

describe("animation badges in the slide editor", () => {
  it("shows paragraph animation 1 before a whole-object animation 2", async () => {
    const elements = [
      words("bullets", "Public imagination\nEconomy\nPolitics", {
        runs: [{ text: "Public imagination" }, { text: "\n", paragraphBreak: true }, { text: "Economy" }, { text: "\n", paragraphBreak: true }, { text: "Politics" }],
        paragraphBuilds: [
          { start: 0, end: 0, order: 1 },
          { start: 1, end: 1, order: 4 },
        ],
      }),
      words("caption", "The Economist, 2021", {
        animation: "appear-on-click", animationOrder: 2,
      }),
      words("leaving", "Previous example", { animationExit: { order: 3 } }),
    ];
    const editor = openSlides({ slides: { a: elements } });
    await waitFor(() => expect(within(box("bullets")).getByLabelText("Animation 1")).toBeTruthy());
    expect(within(box("bullets")).getByLabelText("Animation 4").parentElement?.dataset.animationParagraph).toBe("1");
    expect(within(box("caption")).getByLabelText("Animation 2")).toBeTruthy();
    expect(within(box("leaving")).getByLabelText("Animation 3")).toBeTruthy();
    expect(editor.elements("a")).toEqual(elements);
  });
});

it("assigns badges to individual ranges while keeping with/after effects on their click", async () => {
  const { animationMarks } = await import("../../apps/web/src/editors/slide-paragraph-marks");
  const marks = animationMarks([
    words("body", "First\nSecond", { paragraphBuilds: [
      { start: 0, end: 0, order: 1 },
      { start: 1, end: 2, order: 2, trigger: "with" },
      { start: 1, end: 2, order: 2, trigger: "with" },
    ], animationExit: { order: 4 } }),
    words("caption", "Caption", { animation: "appear-on-click", animationOrder: 2 }),
    words("after", "After", { animation: "appear-on-click", animationOrder: 3, animationTrigger: "after" }),
  ]);
  expect(marks.get("body")).toEqual([{ number: 1, paragraph: 0 }, { number: 1, paragraph: 1 }, { number: 3 }]);
  expect(marks.get("caption")).toEqual([{ number: 2 }]);
  expect(marks.get("after")).toEqual([{ number: 2 }]);
});
