import { describe, expect, it } from "vitest";
import { createFile, type Presentation, type Slide, type SlideElement, type SlideFile } from "../packages/core/src";
import { newSlide } from "../apps/web/src/editors/slide-layouts";
import { DECK_THEMES, paintSlide } from "../apps/web/src/editors/slide-theme";
import {
  createMarpFile,
  deckToMarp,
  isMarpTitle,
  marpToDeck,
  moveToOtherColumn,
  marpColumns,
  reorderMarpItem,
  reflowMarp,
  slideIsMarpClean,
  switchMarpLayout,
} from "../apps/web/src/editors/slide-marp";
import { importFile } from "../apps/web/src/imports";

const meadow = DECK_THEMES.find((theme) => theme.id === "meadow")!;
const ink = DECK_THEMES.find((theme) => theme.id === "ink")!;

function deckOf(slides: Slide[], theme?: Presentation["theme"]): Presentation {
  const file = createFile("slide", "Deck") as SlideFile;
  return {
    ...file.content,
    theme,
    slideOrder: slides.map((slide) => slide.id),
    slides: Object.fromEntries(slides.map((slide) => [slide.id, slide])),
  };
}

function fill(slide: Slide, texts: string[], notes?: string) {
  const boxes = slide.elements.filter((el) => el.type === "text");
  boxes.forEach((el, i) => {
    el.content = texts[i] ?? "";
    if (texts[i]?.includes("•")) el.bullet = true;
  });
  if (notes) slide.notes = notes;
  return slide;
}

describe("MARP markdown", () => {
  it("round-trips layouts, bullets, notes, and a built-in theme", () => {
    const deck = deckOf(
      [
        fill(newSlide("title"), ["Ideas in the clear", "Thoughtful slide design"]),
        fill(newSlide("title-body"), ["Organize the deck", "• Thumbnails\n• Headings"], "Speaker notes."),
        fill(newSlide("two-column"), ["Compare", "• One", "• Two"]),
        fill(newSlide("section"), ["Part two"]),
        newSlide("blank"),
      ],
      meadow,
    );
    const markdown = deckToMarp(deck);
    expect(markdown).toBe(`---
marp: true
theme: meadow
---

<!-- _class: title -->

# Ideas in the clear

Thoughtful slide design

---

<!-- _class: title-body -->

# Organize the deck

- Thumbnails
- Headings

<!--
Speaker notes.
-->

---

<!-- _class: two-column -->

# Compare

:::left
- One
:::

:::right
- Two
:::

---

<!-- _class: section -->

# Part two

---

<!-- _class: blank -->
`);
    const parsed = marpToDeck(markdown, deck);
    expect(parsed).toMatchObject({ warnings: [] });
    if ("error" in parsed) return;
    expect(deckToMarp(parsed.deck)).toBe(markdown);
    expect(parsed.deck.slideOrder).toEqual(deck.slideOrder);
    expect(parsed.deck.theme).toEqual(meadow);
    for (const id of deck.slideOrder) {
      expect(parsed.deck.slides[id].elements.map((el) => el.id)).toEqual(
        deck.slides[id].elements.map((el) => el.id),
      );
      expect(parsed.deck.slides[id].layout).toBe(deck.slides[id].layout);
    }
    expect(parsed.deck.slides[deck.slideOrder[1]].notes).toBe("Speaker notes.");
    expect(parsed.deck.slides[deck.slideOrder[1]].elements[1].content).toBe(
      "• Thumbnails\n• Headings",
    );
  });

  it("keeps slide and text ids when the body changes", () => {
    const file = createFile("slide", "Deck") as SlideFile;
    const id = file.content.slideOrder[0];
    const slide = file.content.slides[id];
    slide.elements[0].content = "Hello";
    slide.elements[1].content = "There";
    slide.notes = "Say this";
    slide.transition = { type: "fade", duration: 0.4 };
    slide.comments = [
      {
        id: "thread",
        elementId: slide.elements[0].id,
        messages: [
          {
            id: "message",
            authorName: "Ada",
            text: "Look",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ];
    const markdown = deckToMarp(file.content).replace("There", "Updated");
    const parsed = marpToDeck(markdown, file.content);
    if ("error" in parsed) throw new Error(parsed.error);
    const next = parsed.deck.slides[id];
    expect(parsed.deck.slideOrder).toEqual([id]);
    expect(next.elements.map((el) => el.id)).toEqual(slide.elements.map((el) => el.id));
    expect(next.elements[1].content).toBe("Updated");
    expect(next.notes).toBe("Say this");
    expect(next.transition).toEqual({ type: "fade", duration: 0.4 });
    expect(next.comments?.[0].id).toBe("thread");
  });

  it("reads lead as a title slide and keeps text that does not fit a layout", () => {
    const file = createFile("slide", "Deck") as SlideFile;
    const lead = marpToDeck("<!-- _class: lead -->\n\n# Hello\n\nSub\n", file.content);
    if ("error" in lead) throw new Error(lead.error);
    const title = lead.deck.slides[lead.deck.slideOrder[0]];
    expect(title.layout).toBe("title");
    expect(title.elements.map((el) => el.content)).toEqual(["Hello", "Sub"]);

    const spilled = marpToDeck(
      "<!-- _class: blank -->\n\n# Kept\n\n- Still here\n",
      file.content,
    );
    if ("error" in spilled) throw new Error(spilled.error);
    expect(spilled.deck.slides[spilled.deck.slideOrder[0]].layout).toBe("title-body");
    expect(spilled.deck.slides[spilled.deck.slideOrder[0]].elements[1].content).toBe(
      "• Still here",
    );

    const section = marpToDeck("<!-- _class: section -->\n\n# Part\n\n- More\n", file.content);
    if ("error" in section) throw new Error(section.error);
    expect(section.deck.slides[section.deck.slideOrder[0]].layout).toBe("title-body");
  });

  it("keeps a shape when markdown changes the slot text", () => {
    const slide = fill(newSlide("title-body"), ["Title", "• One"]);
    const shape: SlideElement = {
      id: "shape-1",
      type: "shape",
      x: 12,
      y: 18,
      width: 40,
      height: 30,
      shapeType: "rect",
    };
    slide.elements.push(shape);
    const deck = deckOf([slide]);
    expect(slideIsMarpClean(slide)).toBe(false);
    const markdown = deckToMarp(deck);
    expect(markdown).toContain("<!-- _freeform -->");
    expect(markdown).not.toContain("shape");
    expect(markdown).not.toContain("x:");
    const parsed = marpToDeck(markdown.replace("- One", "- Two"), deck);
    if ("error" in parsed) throw new Error(parsed.error);
    const next = parsed.deck.slides[slide.id];
    expect(next.elements.find((el) => el.id === "shape-1")).toMatchObject({ x: 12, y: 18 });
    expect(next.elements.find((el) => el.type === "text" && el.bullet)?.content).toBe("• Two");
    expect(next.elements.map((el) => el.id)).toEqual(slide.elements.map((el) => el.id));
  });

  it("leaves freely placed text out of the markdown and where it sits", () => {
    const slide = newSlide("blank");
    slide.elements = [
      { id: "a", type: "text", x: 40, y: 36, width: 200, height: 40, content: "Q3" },
      { id: "b", type: "text", x: 420, y: 180, width: 300, height: 80, content: "Revenue was up" },
      { id: "c", type: "text", x: 48, y: 460, width: 220, height: 36, content: "See appendix" },
    ];
    const deck = deckOf([slide]);
    const markdown = deckToMarp(deck);
    expect(markdown).toContain("<!-- _class: blank -->");
    expect(markdown).toContain("<!-- _freeform -->");
    expect(markdown).not.toContain("# Q3");
    expect(markdown).not.toContain("Revenue was up");
    expect(markdown).not.toContain("See appendix");
    const parsed = marpToDeck(markdown, deck);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.deck.slides[slide.id].elements).toEqual(slide.elements);
  });

  it("stores an inline theme and pins a slide color against a later theme", () => {
    const file = createFile("slide", "Deck") as SlideFile;
    const markdown = `---
marp: true
theme:
  name: Night
  background: "#010203"
  headingColor: "#f8fafc"
  bodyColor: "#e5e7eb"
  accent: "#818cf8"
  headingFont: Georgia
  bodyFont: Arial
---

<!-- _class: title-body -->
<!-- _backgroundColor: #112233 -->

# Hello

- One
`;
    const parsed = marpToDeck(markdown, file.content);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.deck.theme).toMatchObject({
      id: "night",
      name: "Night",
      background: "#010203",
      headingFont: "Georgia",
    });
    const slide = parsed.deck.slides[parsed.deck.slideOrder[0]];
    expect(slide.background).toMatchObject({ color: "#112233", pinned: true });
    expect(paintSlide(slide, ink).background?.color).toBe("#112233");
    expect(deckToMarp(parsed.deck)).toContain('background: "#010203"');
    expect(deckToMarp(parsed.deck)).toContain("<!-- _backgroundColor: #112233 -->");
    const again = marpToDeck(deckToMarp(parsed.deck), parsed.deck);
    if ("error" in again) throw new Error(again.error);
    expect(deckToMarp(again.deck)).toBe(deckToMarp(parsed.deck));
  });

  it("warns on an unknown theme or an image and refuses a theme it cannot save", () => {
    const file = createFile("slide", "Deck") as SlideFile;
    file.content.theme = meadow;
    const before = structuredClone(file.content);
    const unknown = marpToDeck("---\ntheme: gaia\n---\n\n# Hello\n", file.content);
    if ("error" in unknown) throw new Error(unknown.error);
    expect(unknown.warnings).toEqual([
      'No theme named "gaia". The current theme was left as it is.',
    ]);
    expect(unknown.deck.theme).toEqual(meadow);
    expect(file.content).toEqual(before);

    const image = marpToDeck("# Hello\n\n![cat](cat.png)\n", file.content);
    if ("error" in image) throw new Error(image.error);
    expect(image.warnings[0]).toMatch(/image/);
    expect(image.deck.slides[image.deck.slideOrder[0]].elements.some((el) => el.type === "image")).toBe(false);

    const broken = marpToDeck("---\ntheme:\n  name: Nope\n---\n\n# Hi\n", file.content);
    expect(broken).toEqual({ error: expect.stringContaining("headingColor") });
    expect(file.content).toEqual(before);

    const color = marpToDeck("<!-- _backgroundColor: blue -->\n\n# Hi\n", file.content);
    expect(color).toEqual({ error: expect.stringContaining("Background color") });
    expect(file.content).toEqual(before);
  });

  it("turns an empty document into one title slide and reuses its id", () => {
    const file = createFile("slide", "Deck") as SlideFile;
    const id = file.content.slideOrder[0];
    const parsed = marpToDeck("   \n", file.content);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.deck.slideOrder).toEqual([id]);
    expect(parsed.deck.slides[id].layout).toBe("title");
    expect(slideIsMarpClean(parsed.deck.slides[id])).toBe(true);
  });

  it("keeps a MARP deck to one column or two div columns", () => {
    const file = createMarpFile("Pitch");
    expect(file.content.marp).toBe(true);
    expect(file.content.slides[file.content.slideOrder[0]].layout).toBe("title-body");
    const markdown = `---
marp: true
theme: meadow
---

# Ideas in the clear

Thoughtful slide design

---

# Compare

<div>

- One

</div>
<div>

- Two

</div>
`;
    const parsed = marpToDeck(markdown, file.content, { marp: true });
    if ("error" in parsed) throw new Error(parsed.error);
    const [first, second] = parsed.deck.slideOrder.map((id) => parsed.deck.slides[id]);
    expect(parsed.deck.marp).toBe(true);
    expect(first.layout).toBe("title-body");
    expect(first.elements.map((el) => el.content)).toEqual([
      "Ideas in the clear",
      "Thoughtful slide design",
    ]);
    expect(second.layout).toBe("two-column");
    expect(second.elements.map((el) => el.content)).toEqual(["Compare", "• One", "• Two"]);
    const again = deckToMarp(parsed.deck);
    expect(again).toContain("<div>");
    expect(again).not.toContain("_class");
    expect(again).not.toContain(":::");
    const round = marpToDeck(again, parsed.deck);
    if ("error" in round) throw new Error(round.error);
    expect(round.deck.slides[round.deck.slideOrder[1]].elements.map((el) => el.content)).toEqual([
      "Compare",
      "• One",
      "• Two",
    ]);
    const moved = moveToOtherColumn(second, second.elements[1].id);
    expect(moved?.elements[1].content).toBe("");
    expect(moved?.elements[2].content).toBe("• Two\n• One");
  });

  it("reorders a dragged item and will not move the title", () => {
    const slide = newSlide("title-body");
    slide.elements[0].content = "Title";
    slide.elements[1].content = "First";
    slide.elements.push({
      id: "second",
      type: "text",
      x: 80,
      y: 420,
      width: 400,
      height: 80,
      content: "Second",
      placeholder: "Click to add text",
    });
    const flowed = reflowMarp(slide);
    const first = flowed.elements.find((el) => el.content === "First")!;
    const moved = reorderMarpItem(
      flowed,
      "second",
      { x: first.x + 10, y: first.y },
      960,
      540,
    );
    expect(moved?.elements.filter((el) => !isMarpTitle(el)).map((el) => el.content)).toEqual([
      "Second",
      "First",
    ]);
    expect(isMarpTitle(moved!.elements[0])).toBe(true);
    expect(moved!.elements[0].y).toBeLessThan(moved!.elements[1].y);
    expect(reorderMarpItem(flowed, flowed.elements[0].id, { x: 100, y: 400 })).toBeNull();
  });

  it("drags an item from the left column into the right, and folds it back", () => {
    const slide = newSlide("two-column");
    slide.elements[0].content = "Title";
    slide.elements[1].content = "Left";
    slide.elements[2].content = "Right";
    const flowed = reflowMarp(slide);
    const left = flowed.elements.find((el) => el.content === "Left")!;
    const moved = reorderMarpItem(flowed, left.id, { x: 800, y: 2000 }, 960);
    const [stillLeft, nowRight] = marpColumns(moved!, 960);
    expect(stillLeft.map((el) => el.content)).not.toContain("Left");
    expect(nowRight.map((el) => el.content)).toEqual(["Right", "Left"]);

    const split = switchMarpLayout(
      reflowMarp({
        ...newSlide("title-body"),
        elements: [
          { ...newSlide("title-body").elements[0], content: "Title" },
          {
            ...newSlide("title-body").elements[1],
            content: "Only",
          },
        ],
      }),
      "two-column",
    );
    const [splitLeft, splitRight] = marpColumns(split, 960);
    expect(split.layout).toBe("two-column");
    expect(splitLeft.map((el) => el.content)).toEqual(["Only"]);
    expect(splitRight.map((el) => el.content)).toEqual([""]);

    const joined = switchMarpLayout(moved!, "title-body");
    expect(joined.layout).toBe("title-body");
    expect(marpColumns(joined, 960)[0].map((el) => el.content)).toEqual(["Right", "Left"]);
    expect(marpColumns(joined, 960)[1]).toEqual([]);
  });

  it("imports a markdown file as a MARP deck", async () => {
    const file = new File(["# Hello\n\nA column\n"], "pitch.md", {
      type: "text/markdown",
    });
    const imported = await importFile(file);
    expect(imported?.kind).toBe("slide");
    if (imported?.kind !== "slide") return;
    expect(imported.content.marp).toBe(true);
    expect(imported.content.slides[imported.content.slideOrder[0]].elements[0].content).toBe(
      "Hello",
    );
  });
});
