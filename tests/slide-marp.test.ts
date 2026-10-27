import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  slideElementSchema,
  type Presentation,
  type Slide,
  type SlideElement,
  type SlideFile,
} from "../packages/core/src";
import { newSlide } from "../apps/web/src/editors/slide-layouts";
import { DECK_THEMES, paintSlide } from "../apps/web/src/editors/slide-theme";
import {
  createMarpFile,
  deckToMarp,
  isMarpTitle,
  marpToDeck,
  moveToOtherColumn,
  marpColumns,
  mergeConsecutiveText,
  reorderFittedMarpItem,
  reorderMarpItem,
  reflowMarp,
  slideIsMarpClean,
  switchMarpLayout,
} from "../apps/web/src/editors/slide-marp";
import { importFile } from "../apps/web/src/imports";
import {
  dataUriFor,
  filesBeside,
  listRelativeFiles,
  markdownInFolder,
  marpAssetPaths,
  normalizeFolderFiles,
  preferredMarkdown,
  selectMarpAssetFiles,
} from "../apps/web/src/editors/slide-marp-import";

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
    const themeClass = marpToDeck(
      "<!-- _class: body-clearance -->\n\n# Hello\n\n- One\n",
      file.content,
    );
    expect(themeClass).not.toHaveProperty("error");

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

  it("keeps fitted boxes in place and only exchanges their contents", () => {
    const slide = newSlide("title-body");
    slide.elements[0].content = "Title";
    slide.elements[1] = {
      ...slide.elements[1],
      id: "a",
      content: "First",
      x: 48,
      y: 140,
      width: 800,
      height: 40,
    };
    slide.elements.push(
      {
        id: "b",
        type: "text",
        x: 48,
        y: 200,
        width: 800,
        height: 40,
        content: "Second",
        placeholder: "Click to add text",
      },
      {
        id: "bar",
        type: "shape",
        x: 0,
        y: 0,
        width: 960,
        height: 50,
        shapeType: "rect",
        fill: "#BF5700",
      },
    );
    expect(reorderFittedMarpItem(slide, "b", { x: 200, y: 210 }, 960)).toBeNull();
    const moved = reorderFittedMarpItem(slide, "b", { x: 80, y: 140 }, 960);
    expect(moved?.elements.find((el) => el.id === "b")).toMatchObject({
      x: 48,
      y: 140,
      content: "Second",
    });
    expect(moved?.elements.find((el) => el.id === "a")).toMatchObject({
      x: 48,
      y: 200,
      content: "First",
    });
    expect(moved?.elements.find((el) => el.id === "bar")).toMatchObject({ x: 0, y: 0 });
  });

  it("reorders an image into an existing slot instead of the pointer", () => {
    const slide = newSlide("title-body");
    slide.elements[0].content = "Title";
    slide.elements[1] = {
      ...slide.elements[1],
      id: "copy",
      content: "• Points",
      x: 48,
      y: 140,
      width: 420,
      height: 160,
    };
    slide.elements.push({
      id: "pic",
      type: "image",
      x: 520,
      y: 150,
      width: 380,
      height: 220,
      src: "media/plot.png",
    });
    expect(reorderFittedMarpItem(slide, "pic", { x: 700, y: 400 })).toBeNull();
    const moved = reorderFittedMarpItem(slide, "pic", { x: 700, y: 40 });
    expect(moved?.elements.find((el) => el.id === "pic")).toMatchObject({
      x: 48,
      y: 140,
      width: 420,
      height: 160,
    });
    expect(moved?.elements.find((el) => el.id === "copy")).toMatchObject({
      x: 520,
      y: 150,
      width: 380,
      height: 220,
    });
  });

  it("merges consecutive body text and leaves the title, pictures, and other columns alone", () => {
    const text = (
      id: string,
      content: string,
      y: number,
      x = 48,
    ): SlideElement => ({
      id,
      type: "text",
      x,
      y,
      width: 400,
      height: 36,
      content,
      fontSize: 20,
      color: "#141414",
      align: "left",
    });
    const merged = mergeConsecutiveText([
      {
        id: "title",
        type: "text",
        x: 0,
        y: 0,
        width: 960,
        height: 52,
        content: "Title",
        fontSize: 32,
        color: "#ffffff",
        fill: "#BF5700",
        placeholder: "Click to add title",
      },
      text("a", "• One", 140),
      text("b", "• Two", 184),
      text("c", "• Three", 228),
      { id: "pic", type: "image", x: 520, y: 140, width: 300, height: 180, src: "media/a.png" },
      text("right", "Aside", 140, 520),
    ]);
    expect(merged.map((el) => el.id)).toEqual(["title", "a", "pic", "right"]);
    expect(merged[1].content).toBe("• One\n• Two\n• Three");
    expect(merged[1]).toMatchObject({ x: 48, y: 140, height: 228 + 36 - 140 });
    expect(merged[0].content).toBe("Title");
  });

  it("spaces merged bullets by their wrapped rows, so a long list still saves", () => {
    const bullet = (id: string, y: number): SlideElement => ({
      id,
      type: "text",
      x: 48,
      y,
      width: 400,
      height: 84,
      content: "• A bullet long enough to wrap onto three rows of its column",
      fontSize: 20,
      lineHeight: 1.4,
      color: "#141414",
      align: "left",
    });
    const [merged] = mergeConsecutiveText([bullet("a", 140), bullet("b", 234)]);
    expect(merged.height).toBe(178);
    expect(merged.lineHeight).toBeCloseTo(178 / (6 * 20), 2);
    expect(slideElementSchema.safeParse(merged).success).toBe(true);
  });

  it("joins list items into one box only when one hanging indent fits them all", () => {
    const item = (id: string, y: number, x = 48, hang: number | undefined = 9): SlideElement => ({
      id,
      type: "text",
      x,
      y,
      width: 400,
      height: 36,
      content: hang ? `• Item ${id}` : `Paragraph ${id}`,
      fontSize: 20,
      color: "#141414",
      align: "left",
      ...(hang ? { hang } : {}),
    });
    const merged = mergeConsecutiveText([
      item("a", 140),
      item("b", 184),
      item("nested", 228, 80),
      item("after", 272),
      item("ten", 316, 44, 13),
      item("words", 360, 48, undefined),
    ]);
    expect(merged.map((el) => el.id)).toEqual(["a", "nested", "after", "ten", "words"]);
    expect(merged[0]).toMatchObject({ content: "• Item a\n• Item b", hang: 9 });
    expect(slideElementSchema.safeParse(merged[0]).success).toBe(true);
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

  it("keeps the Beam UT theme and the pictures a markdown file points at", async () => {
    const png = dataUriFor("media/plot.png", Uint8Array.from([137, 80, 78, 71]));
    expect(marpAssetPaths("# Hi\n\n![](media/plot.png)\n\n![](https://example.com/a.png)\n")).toEqual([
      "media/plot.png",
    ]);
    expect(marpAssetPaths("![](../secret.png)")).toEqual([]);
    const deck = selectMarpAssetFiles(
      ["media/plot.png", "media/logo.svg"],
      [
        { relativePath: "lecture/media/plot.png" },
        { relativePath: "other/media/plot.png" },
        { relativePath: "logo.svg" },
      ],
    );
    expect(deck.ambiguous).toBe(true);
    expect(deck.chosen.map((item) => item.path)).toEqual(["media/logo.svg"]);
    const folder = selectMarpAssetFiles(
      ["media/plot.png"],
      [{ relativePath: "media/plot.png" }, { relativePath: "notes.txt" }],
    );
    expect(folder.ambiguous).toBe(false);
    expect(folder.chosen.map((item) => item.path)).toEqual(["media/plot.png"]);
    const listed = await listRelativeFiles({
      entries: async function* () {
        yield [
          "media",
          {
            kind: "directory",
            entries: async function* () {
              yield ["plot.png", { kind: "file", getFile: async () => new File([png], "plot.png") }];
            },
          },
        ] as const;
      },
    });
    expect(listed.map((item) => item.relativePath)).toEqual(["media/plot.png"]);
    expect(
      markdownInFolder([
        { relativePath: "13_Feature_Engineering/13_Feature_Engineering.md" },
        { relativePath: "13_Feature_Engineering/media/plot.png" },
        { relativePath: "13_Feature_Engineering/node_modules/readme.md" },
        { relativePath: "notes.md" },
      ]),
    ).toEqual(["notes.md", "13_Feature_Engineering/13_Feature_Engineering.md"]);
    expect(preferredMarkdown(["13_Feature_Engineering.md", "notes.md"], "13_Feature_Engineering")).toBe(
      "13_Feature_Engineering.md",
    );
    expect(preferredMarkdown(["a.md", "b.md"], "")).toBeNull();
    const flat = normalizeFolderFiles([
      { relativePath: "13_Feature_Engineering/13_Feature_Engineering.md" },
      { relativePath: "13_Feature_Engineering/media/plot.png" },
    ]);
    expect(flat.folderName).toBe("13_Feature_Engineering");
    expect(filesBeside("13_Feature_Engineering.md", flat.files).map((item) => item.relativePath)).toEqual([
      "media/plot.png",
    ]);
    const file = new File(
      ["---\ntheme: beam_ut\n---\n\n# Hello\n\n![](media/plot.png)\n"],
      "lecture.md",
      { type: "text/markdown" },
    );
    const imported = await importFile(file, undefined, { "media/plot.png": png });
    expect(imported?.kind).toBe("slide");
    if (imported?.kind !== "slide") return;
    expect(imported.content.theme?.id).toBe("beam_ut");
    expect(imported.content.marpSource).toContain("media/plot.png");
    expect(imported.content.marpAssets?.["media/plot.png"]).toBe(png);
    expect(imported.content.marpFit).toBe(false);
    const picture = Object.values(imported.content.slides)
      .flatMap((slide) => slide.elements)
      .find((el) => el.type === "image");
    expect(picture?.src).toBe("media/plot.png");
    const again = parseFile(serializeFile(imported));
    expect(again.kind).toBe("slide");
  });
});
