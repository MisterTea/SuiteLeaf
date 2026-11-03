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

  it("uses the same click for a shared order and for after previous", () => {
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
        content: "Welcome",
        animation: "fade-on-click",
        animationOrder: 1,
      },
      {
        id: "photo",
        type: "text",
        x: 0,
        y: 80,
        width: 100,
        height: 40,
        content: "Photo",
        animation: "fly-on-click",
        animationOrder: 2,
        animationTrigger: "after",
      },
      {
        id: "note",
        type: "text",
        x: 0,
        y: 160,
        width: 100,
        height: 40,
        content: "secret-value",
      },
    ];
    const rows = animationRows(file.content.slides[slideId]);
    expect(rows.map((row) => [row.label, row.click, row.trigger])).toEqual([
      ["Welcome", 1, "click"],
      ["Photo", 1, "after"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("secret-value");
  });
});
