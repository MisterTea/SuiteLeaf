import { describe, expect, it } from "vitest";
import { slideSchema } from "../packages/core/src";
import { newSlide } from "../apps/web/src/editors/slide-layouts";
import {
  createMarpFile,
  deckToMarp,
  marpToDeck,
  marpColumns,
  reflowMarp,
  reorderMarpItem,
  switchMarpLayout,
} from "../apps/web/src/editors/slide-marp";
import { writeSlide } from "../apps/web/src/editors/slide-marp-diff";
import {
  deckFromMarkdown,
  syncMarpSource,
} from "../apps/web/src/editors/slide-marp-sync";
import { marpDeck } from "./marp-fixtures";

function three() {
  const slide = newSlide("three-column");
  slide.elements.forEach((el, i) => {
    el.content = ["Compare", "Alpha", "Beta", "Gamma"][i];
  });
  return reflowMarp(slide);
}

function parse(source: string, marp = true) {
  const result = marpToDeck(source, createMarpFile().content, { marp });
  if ("error" in result) throw new Error(result.error);
  return result.deck.slides[result.deck.slideOrder[0]];
}

const contents = (slide: ReturnType<typeof three>) =>
  marpColumns(slide).map((col) => col.map((el) => el.content));

describe("three-column MARP slides", () => {
  it("accepts three columns in saved slides and round-trips all content through Markdown", () => {
    const slide = three();
    expect(slideSchema.parse(slide).layout).toBe("three-column");
    for (const marp of [true, false]) {
      const deck = {
        ...createMarpFile().content,
        marp,
        slides: { [slide.id]: slide },
        slideOrder: [slide.id],
      };
      const source = deckToMarp(deck);
      const again = parse(source, marp);
      expect(again.layout).toBe("three-column");
      expect(contents(again)).toEqual([["Alpha"], ["Beta"], ["Gamma"]]);
      if (marp) expect(source).toContain('<div class="three-columns">');
    }
  });

  it("keeps a three-column class with an empty middle column", () => {
    const slide = parse(
      "<!-- _class: three-column -->\n# Compare\n:::left\nAlpha\n:::\n:::right\nGamma\n:::",
      false,
    );
    expect(slide.layout).toBe("three-column");
    expect(contents(slide)).toEqual([["Alpha"], [""], ["Gamma"]]);
  });

  it("adds an editable grid and preserves it when the slide is duplicated", () => {
    const deck = marpDeck("# Existing\n");
    const slide = newSlide("three-column");
    const result = syncMarpSource(deck, {
      ...deck,
      slides: { ...deck.slides, [slide.id]: slide },
      slideOrder: [...deck.slideOrder, slide.id],
    });
    if ("error" in result) throw new Error(result.error);
    const source = result.deck.marpSource!;
    expect(source).toContain('<div class="three-columns">');
    const back = deckFromMarkdown(result.deck, source).deck;
    const added = back.slides[back.slideOrder[1]];
    expect(added.layout).toBe("three-column");
    expect(contents(added)).toEqual([
      ["Left column"],
      ["Middle column"],
      ["Right column"],
    ]);
    const copy = { ...added, id: "copy" };
    const duplicated = syncMarpSource(result.deck, {
      ...result.deck,
      slideOrder: [...result.deck.slideOrder, copy.id],
      slides: { ...result.deck.slides, [copy.id]: copy },
    });
    if ("error" in duplicated) throw new Error(duplicated.error);
    expect(
      duplicated.deck.marpSource!.split('<div class="three-columns">'),
    ).toHaveLength(3);
  });

  it("writes populated new slides into their respective grid columns", () => {
    const source = writeSlide(three(), {})!.join("\n");
    expect(contents(parse(source))).toEqual([["Alpha"], ["Beta"], ["Gamma"]]);
  });

  it("keeps column reading order when shrinking or expanding layouts", () => {
    const original = three();
    const two = switchMarpLayout(original, "two-column");
    expect(contents(two)).toEqual([["Alpha"], ["Beta", "Gamma"]]);
    const one = switchMarpLayout(original, "title-body");
    expect(contents(one)[0]).toEqual(["Alpha", "Beta", "Gamma"]);
    const expanded = switchMarpLayout(one, "three-column");
    expect(contents(expanded)).toEqual([
      ["Alpha", "Beta", "Gamma"],
      [""],
      [""],
    ]);
    expect(switchMarpLayout(original, "three-column")).toBe(original);
  });

  it("moves an item into the middle or last column and leaves titles fixed", () => {
    const slide = three();
    const alpha = slide.elements[1];
    const middle = reorderMarpItem(slide, alpha.id, { x: 480, y: 0 })!;
    expect(contents(middle)).toEqual([[], ["Alpha", "Beta"], ["Gamma"]]);
    const right = reorderMarpItem(middle, alpha.id, { x: 960, y: 999 })!;
    expect(contents(right)).toEqual([[], ["Beta"], ["Gamma", "Alpha"]]);
    expect(
      reorderMarpItem(slide, slide.elements[0].id, { x: 700, y: 200 }),
    ).toBeNull();
    expect(reorderMarpItem(slide, alpha.id, { x: 0, y: 130 })).toBeNull();
  });
});
