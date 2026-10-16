import { describe, expect, it } from "vitest";
import { createFile } from "@suiteleaf/core";
import { animationRows, applySlideAnimation, reorderAnimation } from "../apps/web/src/editors/slide-fade-in";

describe("animation pane", () => {
  it("lists click animations and moves one later", () => {
    const file = createFile("slide", "Pitch");
    if (file.kind !== "slide") throw new Error("expected slides");
    const slideId = file.content.slideOrder[0]!;
    const slide = file.content.slides[slideId]!;
    slide.elements = [
      { id: "title", type: "text", x: 0, y: 0, width: 100, height: 40, content: "Welcome" },
      { id: "body", type: "text", x: 0, y: 80, width: 100, height: 40, content: "Agenda" },
    ];
    const first = applySlideAnimation(file.content, slideId, "title", "fade-on-click");
    const both = applySlideAnimation(first!, slideId, "body", "fly-on-click");
    expect(animationRows(both!.slides[slideId]).map((row) => row.label)).toEqual(["Welcome", "Agenda"]);
    const moved = reorderAnimation(both!, slideId, "title", 1);
    expect(animationRows(moved!.slides[slideId]).map((row) => row.id)).toEqual(["body", "title"]);
    expect(reorderAnimation(moved!, slideId, "body", -1)).toBeNull();
  });

  it("names an empty text box by its placeholder", () => {
    const file = createFile("slide", "Pitch");
    if (file.kind !== "slide") throw new Error("expected slides");
    const slideId = file.content.slideOrder[0]!;
    file.content.slides[slideId]!.elements = [
      {
        id: "title",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        content: "",
        placeholder: "Click to add title",
      },
    ];
    const next = applySlideAnimation(file.content, slideId, "title", "fade-on-click");
    expect(animationRows(next!.slides[slideId]).map((row) => row.label)).toEqual([
      "Click to add title",
    ]);
  });
});
