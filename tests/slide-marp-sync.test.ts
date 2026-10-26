import { describe, expect, it } from "vitest";
import type { Presentation, Slide, SlideElement } from "../packages/core/src";
import { duplicateSlides, deleteSlides, moveSelection, withElements, withoutElements } from "../apps/web/src/editors/slide-editing";
import { applyBackground } from "../apps/web/src/editors/slide-layouts";
import { DECK_THEMES, applyDeckTheme, slideFromTheme } from "../apps/web/src/editors/slide-theme";
import { reorderFittedMarpItem } from "../apps/web/src/editors/slide-marp";
import { styleSelection } from "../apps/web/src/editors/slide-runs";
import {
  deckFromMarkdown,
  inlineMarkdown,
  keepUnchangedParts,
  MARP_FIX_FIRST,
  MARP_HTML,
  MARP_OUT_OF_STEP,
  MARP_THEME_PART,
  MARP_UNSUPPORTED,
  syncMarpSource,
} from "../apps/web/src/editors/slide-marp-sync";
import { fakeFit, marpDeck } from "./marp-fixtures";

const DECK = `---
marp: true
theme: default
---

# Welcome

Intro with **bold** and a [link](https://example.com).

- One
- Two

<!--
Say hello.
-->

---

<!-- _class: lead -->

## Details

1. First
2. Second

\`\`\`js
const a = 1;
\`\`\`
`;

function slideAt(deck: Presentation, index: number): Slide {
  return deck.slides[deck.slideOrder[index]];
}

function boxWith(deck: Presentation, index: number, text: string): SlideElement {
  const found = slideAt(deck, index).elements.find((el) => el.content?.includes(text));
  if (!found) throw new Error(`No box with ${text}`);
  return found;
}

function edit(deck: Presentation, index: number, id: string, change: Partial<SlideElement>): Presentation {
  const slide = slideAt(deck, index);
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slide.id]: {
        ...slide,
        elements: slide.elements.map((el) => (el.id === id ? { ...el, ...change } : el)),
      },
    },
  };
}

function synced(prev: Presentation, next: Presentation, editing = false) {
  const result = syncMarpSource(prev, next, { editing });
  if ("error" in result) throw new Error(result.error);
  return result;
}

/** What the slides show after laying the new markdown out again. */
function shown(deck: Presentation) {
  const again = fakeFit(deckFromMarkdown(deck, deck.marpSource!).deck);
  return again.slideOrder.map((id) => again.slides[id].elements.map((el) => el.content ?? el.src));
}

describe("writing canvas edits into MARP markdown", () => {
  it("changes only the words typed and keeps the emphasis and link around them", () => {
    const deck = marpDeck(DECK);
    const intro = boxWith(deck, 0, "Intro");
    const next = edit(deck, 0, intro.id, {
      content: "Introduction with bold and a link.",
      runs: [{ text: "Introduction with " }, { text: "bold", bold: true }, { text: " and a link." }],
    });
    const { deck: result, relayout } = synced(deck, next, true);
    expect(relayout).toBe("later");
    expect(result.marpSource).toBe(
      DECK.replace("Intro with", "Introduction with"),
    );
    expect(result.marpFit).toBe(deck.marpFit);
    expect(boxWith(result, 0, "Introduction").marpLines).toEqual(intro.marpLines);
  });

  it("lays the slide out again at once when the edit did not come from typing", () => {
    const deck = marpDeck(DECK);
    const intro = boxWith(deck, 0, "Intro");
    const next = edit(deck, 0, intro.id, {
      content: "Intro with bold and a link!",
      runs: [{ text: "Intro with " }, { text: "bold", bold: true }, { text: " and a link!" }],
    });
    const { deck: result, relayout } = synced(deck, next);
    expect(relayout).toBe("now");
    expect(result.marpFit).toBe(false);
    expect(result.marpSource).toContain("[link](https://example.com)!");
  });

  it("writes a new title into the heading and keeps it one line", () => {
    const deck = marpDeck(DECK);
    const title = boxWith(deck, 0, "Welcome");
    const { deck: result } = synced(deck, edit(deck, 0, title.id, { content: "Welcome\naboard" }), true);
    expect(result.marpSource).toContain("\n# Welcome aboard\n");
    expect(result.marpSource).not.toContain("**Welcome");
  });

  it("writes bold chosen on the canvas as markdown emphasis", () => {
    const deck = marpDeck(DECK);
    const list = boxWith(deck, 0, "One");
    const bolded = styleSelection(list, list.content!.indexOf("Two"), list.content!.length, { type: "bold" });
    const { deck: result } = synced(deck, edit(deck, 0, list.id, bolded));
    expect(result.marpSource).toContain("- One\n- **Two**\n");
  });

  it("adds, edits, and removes list items line by line", () => {
    const deck = marpDeck(DECK);
    const list = boxWith(deck, 0, "One");
    const added = synced(deck, edit(deck, 0, list.id, { content: "• One\n• Two\n• Three" }), true).deck;
    expect(added.marpSource).toContain("- One\n- Two\n- Three\n\n<!--");
    const ordered = boxWith(deck, 1, "First");
    const numbered = synced(deck, edit(deck, 1, ordered.id, { content: "1. First\n2. Middle\n3. Second" }), true).deck;
    expect(numbered.marpSource).toContain("1. First\n2. Middle\n2. Second\n");
    const removed = synced(deck, edit(deck, 0, list.id, { content: "• Two" }), true).deck;
    expect(removed.marpSource).toContain("\n- Two\n\n<!--");
    expect(removed.marpSource).not.toContain("- One");
  });

  it("keeps the lines of boxes below an edit pointing at their markdown", () => {
    const deck = marpDeck(DECK);
    const list = boxWith(deck, 0, "One");
    const result = synced(deck, edit(deck, 0, list.id, { content: "• One\n• Two\n• Three" }), true).deck;
    const lines = result.marpSource!.split("\n");
    for (const [index, slide] of result.slideOrder.map((id) => result.slides[id]).entries())
      for (const el of slide.elements) {
        if (!el.marpLines || el.type !== "text") continue;
        const text = lines.slice(el.marpLines[0], el.marpLines[1]).join("\n");
        expect(text, `slide ${index + 1}`).toContain(el.content!.split("\n")[0].replace(/^(• |\d+\. )/, "").split(" ")[0]);
      }
    expect(boxWith(result, 1, "Details").marpLines![0]).toBe(boxWith(deck, 1, "Details").marpLines![0] + 1);
  });

  it("rewrites the inside of a code block and keeps its fences", () => {
    const deck = marpDeck(DECK);
    const slide = slideAt(deck, 1);
    const code: SlideElement = {
      id: "code",
      type: "text",
      x: 48,
      y: 400,
      width: 400,
      height: 60,
      content: "const a = 1;",
      preformatted: true,
      marpLines: [25, 28],
    };
    const withCode = { ...deck, slides: { ...deck.slides, [slide.id]: { ...slide, elements: [...slide.elements, code] } } };
    expect(withCode.marpSource!.split("\n").slice(25, 28)).toEqual(["```js", "const a = 1;", "```"]);
    const result = synced(withCode, edit(withCode, 1, "code", { content: "const a = 2;\nconst b = 3;" })).deck;
    expect(result.marpSource).toContain("```js\nconst a = 2;\nconst b = 3;\n```");
  });

  it("removes a deleted box and the blank line after it", () => {
    const deck = marpDeck(DECK);
    const intro = boxWith(deck, 0, "Intro");
    const result = synced(deck, withoutElements(deck, deck.slideOrder[0], [intro.id]));
    expect(result.relayout).toBe("now");
    expect(result.deck.marpSource).toContain("# Welcome\n\n- One");
    expect(result.deck.marpSource).not.toContain("Intro");
  });

  it("deletes a picture written beside words without deleting the words", () => {
    const deck = marpDeck("# Pictures\n\nA plot ![plot](media/plot.png) here\n");
    const picture = slideAt(deck, 0).elements.find((el) => el.type === "image")!;
    expect(picture.marpLines).toEqual(boxWith(deck, 0, "A plot").marpLines);
    const result = synced(deck, withoutElements(deck, deck.slideOrder[0], [picture.id])).deck;
    expect(result.marpSource).toContain("A plot  here");
    expect(result.marpSource).not.toContain("plot.png");
  });

  it("swaps the markdown of two boxes dragged past each other", () => {
    const deck = marpDeck("# Order\n\nFirst paragraph\n\n- a\n- b\n");
    const first = boxWith(deck, 0, "First");
    const list = boxWith(deck, 0, "• a");
    const moved = reorderFittedMarpItem(slideAt(deck, 0), list.id, { x: 100, y: first.y })!;
    const next = { ...deck, slides: { ...deck.slides, [deck.slideOrder[0]]: moved } };
    const result = synced(deck, next).deck;
    expect(result.marpSource).toContain("# Order\n\n- a\n- b\n\nFirst paragraph\n");
  });

  it("adds a text box and a picture at the end of the slide's content, before its notes", () => {
    const deck = marpDeck(DECK);
    const slideId = deck.slideOrder[0];
    const text: SlideElement = { id: "new", type: "text", x: 0, y: 0, width: 100, height: 40, content: "" };
    const picture: SlideElement = {
      id: "pic",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      src: "data:image/png;base64,iVBORw0KGgo=",
      alt: "Chart.png",
    };
    const { deck: result } = synced(deck, withElements(deck, slideId, [text, picture]));
    expect(result.marpSource).toContain("- Two\n\nText\n\n![Chart.png](media/chart.png)\n\n<!--\nSay hello.");
    expect(result.marpAssets?.["media/chart.png"]).toBe(picture.src);
    const lines = result.marpSource!.split("\n");
    const placed = result.slides[slideId].elements.find((el) => el.id === "new")!;
    expect(lines.slice(placed.marpLines![0], placed.marpLines![1])).toEqual(["Text"]);
  });

  it("adds, duplicates, moves, and deletes slides as markdown slides", () => {
    const deck = marpDeck(DECK);
    const blank = slideFromTheme("title-body", deck.theme);
    const added = synced(deck, {
      ...deck,
      slideOrder: [deck.slideOrder[0], blank.id, deck.slideOrder[1]],
      slides: { ...deck.slides, [blank.id]: blank },
    }).deck;
    expect(added.marpSource).toContain("-->\n\n---\n\n# New slide\n\n---\n\n<!-- _class: lead -->");

    const twoColumns = slideFromTheme("two-column", deck.theme);
    const columns = synced(deck, {
      ...deck,
      slideOrder: [...deck.slideOrder, twoColumns.id],
      slides: { ...deck.slides, [twoColumns.id]: twoColumns },
    }).deck;
    expect(columns.marpSource).toMatch(/# New slide\n\n<div style="display: grid;[^\n]*>\n<div>\n\nLeft column/);

    const copy = duplicateSlides(deck, [deck.slideOrder[1]], () => "copy").deck;
    const duplicated = synced(deck, copy).deck.marpSource!;
    expect(duplicated.split("## Details")).toHaveLength(3);

    const moved = synced(deck, { ...deck, slideOrder: moveSelection(deck.slideOrder, [deck.slideOrder[1]], "start") }).deck;
    expect(moved.marpSource!.indexOf("## Details")).toBeLessThan(moved.marpSource!.indexOf("# Welcome"));
    expect(moved.marpSource!.startsWith("---\nmarp: true\ntheme: default\n---\n")).toBe(true);
    expect(shown(moved).map((boxes) => boxes[0])).toEqual(["Details", "Welcome"]);

    const removed = deleteSlides(deck, [deck.slideOrder[0]]);
    if ("error" in removed) throw new Error(removed.error);
    const after = synced(deck, removed.deck).deck.marpSource!;
    expect(after).not.toContain("Welcome");
    expect(after).toContain("## Details");
    expect(shown({ ...removed.deck, marpSource: after })).toHaveLength(1);
  });

  it("writes speaker notes into the slide's note comment and leaves settings comments alone", () => {
    const deck = marpDeck(DECK);
    const first = slideAt(deck, 0);
    const second = slideAt(deck, 1);
    const changed = synced(deck, { ...deck, slides: { ...deck.slides, [first.id]: { ...first, notes: "Say hi --> loudly." } } }).deck;
    expect(changed.marpSource).toContain("<!--\nSay hi -- > loudly.\n-->");
    expect(changed.marpSource).not.toContain("Say hello.");
    const added = synced(deck, { ...deck, slides: { ...deck.slides, [second.id]: { ...second, notes: "Point at the code." } } }).deck;
    expect(added.marpSource).toContain("<!-- _class: lead -->");
    expect(added.marpSource!.trimEnd().endsWith("```\n\n<!--\nPoint at the code.\n-->")).toBe(true);
    const cleared = synced(deck, { ...deck, slides: { ...deck.slides, [first.id]: { ...first, notes: "" } } }).deck;
    expect(cleared.marpSource).not.toContain("Say hello.");
    expect(cleared.marpSource).toContain("- Two\n\n---");
  });

  it("writes a slide background as a MARP directive", () => {
    const deck = marpDeck(DECK);
    const first = slideAt(deck, 0);
    const painted = synced(deck, { ...deck, slides: { ...deck.slides, ...applyBackground({ [first.id]: first }, "#fef3c7") } }).deck;
    expect(painted.marpSource).toContain("---\n\n<!-- _backgroundColor: #fef3c7 -->\n# Welcome");
    const second = slideAt(painted, 0);
    const again = synced(painted, { ...painted, slides: { ...painted.slides, ...applyBackground({ [second.id]: second }, "#0f172a") } }).deck;
    expect(again.marpSource).toContain("<!-- _backgroundColor: #0f172a -->\n# Welcome");
    expect(again.marpSource).not.toContain("#fef3c7");
  });

  it("writes the theme and slide numbers into the front matter", () => {
    const deck = marpDeck(DECK);
    const ink = DECK_THEMES.find((theme) => theme.id === "ink")!;
    const themed = synced(deck, applyDeckTheme(deck, ink)).deck;
    expect(themed.marpSource!.startsWith("---\nmarp: true\ntheme: ink\n---\n")).toBe(true);
    expect(themed.marpFit).toBe(false);
    const numbered = synced(deck, { ...deck, slideNumbers: true }).deck;
    expect(numbered.marpSource).toContain("theme: default\npaginate: true\n---");
    const bare = marpDeck("# Only\n");
    const fresh = synced(bare, { ...bare, slideNumbers: true }).deck;
    expect(fresh.marpSource!.startsWith("---\nmarp: true\npaginate: true\n---\n")).toBe(true);
    expect(deckFromMarkdown(fresh, fresh.marpSource!).deck.slideNumbers).toBe(true);
  });

  it("refuses changes markdown cannot describe", () => {
    const deck = marpDeck(DECK);
    const title = boxWith(deck, 0, "Welcome");
    expect(syncMarpSource(deck, edit(deck, 0, title.id, { fontSize: 72 }))).toEqual({ error: MARP_UNSUPPORTED });
    expect(syncMarpSource(deck, edit(deck, 0, title.id, { fill: "#ff0000" }))).toEqual({ error: MARP_UNSUPPORTED });
    const slide = slideAt(deck, 0);
    expect(
      syncMarpSource(deck, { ...deck, slides: { ...deck.slides, [slide.id]: { ...slide, layout: "two-column" } } }),
    ).toEqual({ error: MARP_UNSUPPORTED });
    const shape: SlideElement = { id: "bar", type: "shape", x: 0, y: 0, width: 10, height: 10, shapeType: "rect" };
    const withShape = { ...deck, slides: { ...deck.slides, [slide.id]: { ...slide, elements: [...slide.elements, shape] } } };
    expect(syncMarpSource(withShape, withoutElements(withShape, slide.id, ["bar"]))).toEqual({ error: MARP_THEME_PART });
    expect(syncMarpSource(deck, withElements(deck, slide.id, [shape]))).toEqual({ error: MARP_UNSUPPORTED });
  });

  it("refuses canvas edits while the markdown is invalid or the boxes are out of step", () => {
    const deck = marpDeck(DECK);
    const broken = { ...deck, marpSource: `${DECK}\n\`\`\`\nnever closed\n` };
    const title = boxWith(deck, 0, "Welcome");
    expect(syncMarpSource(broken, edit(broken, 0, title.id, { content: "Hi" }))).toEqual({ error: MARP_FIX_FIRST });
    const stale = edit(deck, 0, title.id, { marpLines: boxWith(deck, 0, "Intro").marpLines });
    expect(syncMarpSource(stale, edit(stale, 0, title.id, { content: "Hi" }))).toEqual({ error: MARP_OUT_OF_STEP });
  });

  it("keeps geometry-only changes out of the markdown and lays the slide out again", () => {
    const deck = marpDeck(DECK);
    const title = boxWith(deck, 0, "Welcome");
    const result = synced(deck, edit(deck, 0, title.id, { x: title.x + 30 }));
    expect(result.deck.marpSource).toBe(deck.marpSource);
    expect(result.relayout).toBe("now");
  });

  it("writes a table cell edit into its row only", () => {
    const source = "# Table\n\n| Name | `code` |\n|:---|---:|\n| a | 1 |\n| b | 2 |\n";
    const deck = marpDeck(source);
    const slide = slideAt(deck, 0);
    const table: SlideElement = {
      id: "table",
      type: "table",
      x: 0,
      y: 100,
      width: 400,
      height: 100,
      rows: [["Name", "`code`"], ["a", "1"], ["b", "2"]],
      marpLines: [2, 6],
    };
    const withTable = { ...deck, slides: { ...deck.slides, [slide.id]: { ...slide, elements: [...slide.elements, table] } } };
    const result = synced(withTable, edit(withTable, 0, "table", { rows: [["Name", "`code`"], ["a | b", "1"], ["b", "2"]] })).deck;
    expect(result.marpSource).toBe("# Table\n\n| Name | `code` |\n|:---|---:|\n| a \\| b | 1 |\n| b | 2 |\n");
  });

  it("converts a setext heading when its words change", () => {
    const deck = marpDeck("Big title\n=========\n\nBody\n");
    const title = boxWith(deck, 0, "Big title");
    const result = synced(deck, edit(deck, 0, title.id, { content: "Bigger title" }), true).deck;
    expect(result.marpSource).toBe("Bigger title\n=========\n\nBody\n");
  });
});

describe("writing harder canvas edits into MARP markdown", () => {
  it("writes the whole box again when a line break changes inside a paragraph", () => {
    const deck = marpDeck("# Lines\n\nline one<br>line two\n");
    const para = boxWith(deck, 0, "line one");
    expect(para.content).toBe("line one\nline two");
    const result = synced(deck, edit(deck, 0, para.id, { content: "line one\nline two\nline three" }), true).deck;
    expect(result.marpSource).toBe("# Lines\n\nline one\n\nline two\n\nline three\n");
    expect(shown(result)[0]).toEqual(["Lines", "line one", "line two", "line three"]);
  });

  it("turns typed bullet lines into list items and numbers a new ordered item", () => {
    const deck = marpDeck("# Plan\n\nIntro\n");
    const intro = boxWith(deck, 0, "Intro");
    const listed = synced(deck, edit(deck, 0, intro.id, { content: "Intro\n• first\n• second" }), true).deck;
    expect(listed.marpSource).toBe("# Plan\n\nIntro\n\n- first\n- second\n");
    const steps = marpDeck("# Steps\n\n3. three\n");
    const three = boxWith(steps, 0, "three");
    const more = synced(steps, edit(steps, 0, three.id, { content: "3. three\n4. four\n5. five" }), true).deck;
    expect(more.marpSource).toBe("# Steps\n\n3. three\n4. four\n5. five\n");
  });

  it("writes italic, and leaves a heading's own weight alone", () => {
    const deck = marpDeck(DECK);
    const intro = boxWith(deck, 0, "Intro");
    const italic = styleSelection(intro, 0, 5, { type: "italic" });
    const result = synced(deck, edit(deck, 0, intro.id, italic)).deck;
    expect(result.marpSource).toContain("*Intro* with **bold**");
    const title = boxWith(deck, 0, "Welcome");
    const plain = synced(deck, edit(deck, 0, title.id, { bold: false })).deck;
    expect(plain.marpSource).toBe(deck.marpSource);
  });

  it("keeps a picture when the words beside it are deleted, and deletes an HTML picture", () => {
    const deck = marpDeck("# Pictures\n\nA plot ![plot](media/plot.png)\n");
    const words = boxWith(deck, 0, "A plot");
    const result = synced(deck, withoutElements(deck, deck.slideOrder[0], [words.id])).deck;
    expect(result.marpSource).toBe("# Pictures\n\n![plot](media/plot.png)\n");
    const html = marpDeck('# Html\n\nSee <img src="media/a.png" alt="a"> here\n');
    const slide = slideAt(html, 0);
    const lines = boxWith(html, 0, "See").marpLines!;
    const picture: SlideElement = { id: "img", type: "image", x: 0, y: 300, width: 10, height: 10, src: "media/a.png", marpLines: lines };
    const withPicture = { ...html, slides: { ...html.slides, [slide.id]: { ...slide, elements: [...slide.elements, picture] } } };
    expect(synced(withPicture, withoutElements(withPicture, slide.id, ["img"])).deck.marpSource).toBe("# Html\n\nSee  here\n");
  });

  it("rewrites display math as typed", () => {
    const deck = marpDeck("# Math\n\n$$\nx^2\n$$\n");
    const slide = slideAt(deck, 0);
    const math: SlideElement = { id: "m", type: "text", x: 0, y: 200, width: 100, height: 40, content: "$$\nx^2\n$$", math: true, marpLines: [2, 5] };
    const withMath = { ...deck, slides: { ...deck.slides, [slide.id]: { ...slide, elements: [...slide.elements, math] } } };
    expect(synced(withMath, edit(withMath, 0, "m", { content: "$$\ny^3\n$$" })).deck.marpSource).toBe("# Math\n\n$$\ny^3\n$$\n");
  });

  it("adds a box to a slide with nothing on it, above its notes", () => {
    const deck = marpDeck("# One\n\n---\n\n<!-- Notes for two -->\n");
    const second = slideAt(deck, 1);
    expect(second.elements).toHaveLength(0);
    const text: SlideElement = { id: "t", type: "text", x: 0, y: 0, width: 100, height: 40, content: "Hello" };
    const result = synced(deck, withElements(deck, second.id, [text])).deck;
    expect(result.marpSource).toBe("# One\n\n---\n\nHello\n\n<!-- Notes for two -->\n");
  });

  it("changes one setting in a comment that holds several and removes a background", () => {
    const source = "<!--\n_class: lead\n_backgroundColor: #ffffff\n-->\n# Hi\n";
    const deck = marpDeck(source);
    const slide = slideAt(deck, 0);
    const painted = synced(deck, { ...deck, slides: { ...deck.slides, [slide.id]: { ...slide, background: { color: "#0f172a" } } } }).deck;
    expect(painted.marpSource).toBe("<!--\n_class: lead\n_backgroundColor: #0f172a\n-->\n# Hi\n");
    const cleared = synced(deck, { ...deck, slides: { ...deck.slides, [slide.id]: { ...slide, background: undefined } } }).deck;
    expect(cleared.marpSource).toBe("<!--\n_class: lead\n-->\n# Hi\n");
    const single = marpDeck("<!-- _backgroundColor: #ffffff -->\n# Hi\n");
    const only = slideAt(single, 0);
    expect(
      synced(single, { ...single, slides: { ...single.slides, [only.id]: { ...only, background: undefined } } }).deck.marpSource,
    ).toBe("# Hi\n");
  });

  it("writes a pasted slide whose boxes no longer match the markdown from its boxes", () => {
    const deck = marpDeck(DECK);
    const copy: Slide = {
      ...structuredClone(slideAt(deck, 0)),
      id: "pasted",
      notes: "Pasted notes",
      background: { color: "#112233", pinned: true },
    };
    copy.elements = copy.elements.map((el, i) => ({ ...el, id: `p${i}`, content: el.content ? `${el.content}!` : el.content, runs: undefined }));
    copy.elements.push({ id: "pic", type: "image", x: 0, y: 900, width: 10, height: 10, src: "data:image/gif;base64,R0lGOD", alt: "dot" });
    const result = synced(deck, { ...deck, slideOrder: [...deck.slideOrder, "pasted"], slides: { ...deck.slides, pasted: copy } }).deck;
    expect(result.marpSource).toContain(
      "---\n\n<!-- _backgroundColor: #112233 -->\n# Welcome!\n\nIntro with bold and a link.!\n\n- One\n- Two!\n\n![dot](media/dot.gif)\n\n<!--\nPasted notes\n-->\n",
    );
  });

  it("starts front matter for a theme and writes a custom theme's colors", () => {
    const bare = marpDeck("# Only\n");
    const custom = { ...DECK_THEMES[0], id: "night", name: "Night", background: "#010203" };
    const result = synced(bare, applyDeckTheme(bare, custom)).deck;
    expect(result.marpSource!.startsWith("---\nmarp: true\ntheme:\n  id: night\n  name: Night\n  background: \"#010203\"")).toBe(true);
    expect(deckFromMarkdown(result, result.marpSource!).deck.theme).toMatchObject({ id: "night", background: "#010203" });
  });

  it("refuses edits it cannot place in the markdown", () => {
    const deck = marpDeck("# Pictures\n\n![plot](media/plot.png)\n\nText\n");
    const picture = slideAt(deck, 0).elements.find((el) => el.type === "image")!;
    expect(syncMarpSource(deck, edit(deck, 0, picture.id, { src: "media/other.png" }))).toEqual({ error: MARP_UNSUPPORTED });
    expect(syncMarpSource(deck, { ...deck, width: 1280 })).toEqual({ error: MARP_UNSUPPORTED });
    expect(syncMarpSource(deck, { ...deck, master: { elements: [] } })).toEqual({ error: MARP_UNSUPPORTED });
    const art: SlideElement = { id: "art", type: "text", x: 0, y: 0, width: 10, height: 10, content: "Wow", wordArt: "gold" };
    expect(syncMarpSource(deck, withElements(deck, deck.slideOrder[0], [art]))).toEqual({ error: MARP_UNSUPPORTED });
    const short = { ...deck, slideOrder: [...deck.slideOrder, "extra"], slides: { ...deck.slides, extra: slideFromTheme("title-body") } };
    expect(syncMarpSource(short, short)).toEqual({ error: MARP_OUT_OF_STEP });
    const lost = edit(deck, 0, picture.id, { marpLines: undefined });
    expect(syncMarpSource(lost, withoutElements(lost, lost.slideOrder[0], [picture.id]))).toEqual({ error: MARP_OUT_OF_STEP });
  });

  it("leaves a non-MARP deck alone", () => {
    const deck = { ...marpDeck("# A\n"), marp: false };
    const next = { ...deck, slideNumbers: true };
    expect(syncMarpSource(deck, next)).toEqual({ deck: next, relayout: "none" });
  });

  it("reports a header the markdown pane cannot read", () => {
    const deck = marpDeck("# A\n");
    expect(deckFromMarkdown(deck, "<!-- _backgroundColor: blue -->\n# A").problem).toMatch(/Background color/);
  });
});

describe("underline and color as inline HTML", () => {
  const ACCENT = "#bf5700";

  it("writes underline as <u> and color as a styled span", () => {
    const deck = marpDeck(DECK);
    const intro = boxWith(deck, 0, "Intro");
    const underlined = styleSelection(intro, 0, 5, { type: "underline" });
    const first = synced(deck, edit(deck, 0, intro.id, underlined)).deck;
    expect(first.marpSource).toContain("\n<u>Intro</u> with **bold** and a [link](https://example.com).\n");
    const colored = styleSelection(intro, 11, 15, { type: "color", color: ACCENT });
    const second = synced(deck, edit(deck, 0, intro.id, colored)).deck;
    expect(second.marpSource).toContain(
      `Intro with <span style="color: ${ACCENT}">**bold**</span> and a [link](https://example.com).`,
    );
  });

  it("underlines a whole line that already has some bold, keeping its link", () => {
    const deck = marpDeck(DECK);
    const intro = boxWith(deck, 0, "Intro");
    const underlined = styleSelection(intro, 0, intro.content!.length, { type: "underline" });
    const result = synced(deck, edit(deck, 0, intro.id, underlined)).deck;
    expect(result.marpSource).toContain("\n<u>Intro with **bold** and a [link](https://example.com).</u>\n");
  });

  it("nests color, underline, and emphasis so MARP reads all three", () => {
    const deck = marpDeck("# Mix\n\nplain words\n");
    const box = boxWith(deck, 0, "plain");
    const styled = {
      ...box,
      runs: [{ text: "plain " }, { text: "words", bold: true, italic: true, underline: true, color: ACCENT }],
    };
    const result = synced(deck, edit(deck, 0, box.id, styled)).deck;
    expect(result.marpSource).toBe(`# Mix\n\nplain <span style="color: ${ACCENT}"><u>***words***</u></span>\n`);
    const again = marpDeck(result.marpSource!);
    expect(boxWith(again, 0, "plain").runs).toEqual([
      { text: "plain " },
      { text: "words", bold: true, italic: true, underline: true, color: ACCENT },
    ]);
  });

  it("keeps typing inside a colored span, and removes the span when the color is taken off", () => {
    const deck = marpDeck('# Hi\n\nSay <span style="color: red">hello</span> now\n');
    const box = boxWith(deck, 0, "Say");
    expect(box.runs).toEqual([{ text: "Say " }, { text: "hello", color: "red" }, { text: " now" }]);
    const typed = synced(
      deck,
      edit(deck, 0, box.id, {
        content: "Say hello there now",
        runs: [{ text: "Say " }, { text: "hello there", color: "#ff0000" }, { text: " now" }],
      }),
      true,
    ).deck;
    expect(typed.marpSource).toBe('# Hi\n\nSay <span style="color: red">hello there</span> now\n');
    const cleared = synced(deck, edit(deck, 0, box.id, { runs: undefined })).deck;
    expect(cleared.marpSource).toBe("# Hi\n\nSay hello now\n");
  });

  it("colors every word when a whole box is given a color", () => {
    const deck = marpDeck(DECK);
    const list = boxWith(deck, 0, "One");
    const result = synced(deck, edit(deck, 0, list.id, { color: "#ff0000" })).deck;
    expect(result.marpSource).toContain(
      '- <span style="color: #ff0000">One</span>\n- <span style="color: #ff0000">Two</span>\n',
    );
  });

  it("never writes a color that could break out of the style attribute", () => {
    const deck = marpDeck("# Safe\n\nword\n");
    const box = boxWith(deck, 0, "word");
    const result = synced(
      deck,
      edit(deck, 0, box.id, { runs: [{ text: "word", color: 'red" onmouseover="alert(1)' }] }),
    ).deck;
    expect(result.marpSource).toBe("# Safe\n\nword\n");
  });
});

describe("HTML blocks and inline HTML", () => {
  const SOURCE = `# Raw

Text with H<sup>2</sup>O inside.

<div class="note" style="position: absolute; right: 40px">Note</div>

<svg width="10" height="10"><rect width="10" height="10"/></svg>

Last line
`;

  it("lays HTML out as locked blocks that keep their markdown lines", () => {
    const deck = marpDeck(SOURCE);
    const locked = slideAt(deck, 0).elements.filter((el) => el.marpHtml);
    const lines = SOURCE.split("\n");
    expect(locked.map((el) => lines.slice(el.marpLines![0], el.marpLines![1]).join("\n"))).toEqual([
      '<div class="note" style="position: absolute; right: 40px">Note</div>',
      '<svg width="10" height="10"><rect width="10" height="10"/></svg>',
    ]);
  });

  it("deletes and moves an HTML block whole, byte for byte", () => {
    const deck = marpDeck(SOURCE);
    const [note] = slideAt(deck, 0).elements.filter((el) => el.marpHtml);
    const removed = synced(deck, withoutElements(deck, deck.slideOrder[0], [note.id])).deck;
    expect(removed.marpSource).toBe(SOURCE.replace('<div class="note" style="position: absolute; right: 40px">Note</div>\n\n', ""));
    const text = boxWith(deck, 0, "Text with");
    const moved = reorderFittedMarpItem(slideAt(deck, 0), note.id, { x: 100, y: text.y })!;
    const result = synced(deck, { ...deck, slides: { ...deck.slides, [deck.slideOrder[0]]: moved } }).deck;
    expect(result.marpSource).toBe(
      '# Raw\n\n<div class="note" style="position: absolute; right: 40px">Note</div>\n\nText with H<sup>2</sup>O inside.\n\n<svg width="10" height="10"><rect width="10" height="10"/></svg>\n\nLast line\n',
    );
  });

  it("keeps inline tags it cannot write while typing near them", () => {
    const deck = marpDeck(SOURCE);
    const text = boxWith(deck, 0, "Text with");
    expect(text.content).toBe("Text with H2O inside.");
    const typed = synced(deck, edit(deck, 0, text.id, { content: "Text with H2O inside it." }), true).deck;
    expect(typed.marpSource).toContain("Text with H<sup>2</sup>O inside it.");
  });

  it("refuses a rewrite that would drop an inline tag it cannot write", () => {
    const deck = marpDeck(SOURCE);
    const text = boxWith(deck, 0, "Text with");
    expect(syncMarpSource(deck, edit(deck, 0, text.id, { content: "Text with\nH2O inside." }), { editing: true })).toEqual({
      error: MARP_HTML,
    });
    expect(syncMarpSource(deck, edit(deck, 0, text.id, { content: "Water inside." }))).toEqual({ error: MARP_HTML });
  });

  it("does not read a block drawn out of markdown order as a reorder", () => {
    const laid = marpDeck(SOURCE);
    const [note] = slideAt(laid, 0).elements.filter((el) => el.marpHtml);
    const deck = edit(laid, 0, note.id, { x: 700, y: 480 });
    const text = boxWith(deck, 0, "Last line");
    const result = synced(deck, edit(deck, 0, text.id, { content: "Last line!" }), true);
    expect(result.deck.marpSource).toBe(SOURCE.replace("Last line", "Last line!"));
    expect(result.relayout).toBe("later");
  });

  it("keeps a pasted HTML block's markdown", () => {
    const deck = marpDeck(SOURCE);
    const [note] = slideAt(deck, 0).elements.filter((el) => el.marpHtml);
    const copy = { ...note, id: "copy" };
    const result = synced(deck, withElements(deck, deck.slideOrder[0], [copy])).deck;
    expect(result.marpSource!.split('<div class="note"')).toHaveLength(3);
  });
});

describe("markdown pane edits", () => {
  it("keeps invalid markdown as typed and leaves the slides alone", () => {
    const deck = marpDeck(DECK);
    const result = deckFromMarkdown(deck, `${DECK}\n<!-- unfinished`);
    expect(result.problem).toMatch(/comment that starts on line \d+ is never closed/);
    expect(result.deck.marpSource).toBe(`${DECK}\n<!-- unfinished`);
    expect(result.deck.slides).toBe(deck.slides);
    expect(result.deck.marpFit).toBe(deck.marpFit);
  });

  it("keeps the laid-out boxes until the new markdown is laid out, with their lines moved", () => {
    const deck = marpDeck(DECK);
    const details = boxWith(deck, 1, "Details");
    const result = deckFromMarkdown(deck, DECK.replace("# Welcome\n", "# Welcome\n\nNew line\n"));
    expect(result.problem).toBeNull();
    expect(result.deck.marpFit).toBe(false);
    const kept = result.deck.slides[deck.slideOrder[1]].elements.find((el) => el.id === details.id)!;
    expect(kept.marpLines).toEqual([details.marpLines![0] + 2, details.marpLines![1] + 2]);
    const welcome = boxWith(result.deck, 0, "Welcome");
    expect(welcome.marpLines).toEqual(boxWith(deck, 0, "Welcome").marpLines);
  });

  it("normalizes Windows line endings and drops the compiled companion page", () => {
    const deck = { ...marpDeck(DECK), marpAssets: { "@marp/compiled.html": "data:text/html,x", "a.png": "data:image/png;base64,AA" } };
    const result = deckFromMarkdown(deck, "# One\r\n\r\nTwo\r\n");
    expect(result.deck.marpSource).toBe("# One\n\nTwo\n");
    expect(result.deck.marpAssets).toEqual({ "a.png": "data:image/png;base64,AA" });
  });
});

describe("inline markdown", () => {
  it("escapes markdown characters and keeps spaces outside emphasis", () => {
    const plain = { bold: false, italic: false };
    const bold = { bold: true, italic: false };
    const both = { bold: true, italic: true };
    expect(inlineMarkdown("a *b* [c]", new Array(9).fill(plain))).toBe("a \\*b\\* \\[c\\]");
    expect(inlineMarkdown("x bold y", [plain, plain, bold, bold, bold, bold, bold, plain])).toBe("x **bold** y");
    expect(inlineMarkdown("hi", [both, both])).toBe("***hi***");
    expect(inlineMarkdown("hi", [bold, bold], { bold: true, italic: false })).toBe("hi");
  });
});

describe("keeping unchanged slides", () => {
  it("takes each slide that did not change from the previous deck", () => {
    const before = marpDeck("# One\n\n---\n\n# Two\n");
    const [first, second] = before.slideOrder;
    const next: Presentation = {
      ...before,
      slides: {
        [first]: structuredClone(before.slides[first]),
        [second]: { ...structuredClone(before.slides[second]), notes: "Changed" },
      },
    };
    const kept = keepUnchangedParts(before, next);
    expect(kept.slides[first]).toBe(before.slides[first]);
    expect(kept.slides[second]).toBe(next.slides[second]);
    expect(keepUnchangedParts(before, before)).toBe(before);
  });
});

describe("keeping unchanged assets", () => {
  it("keeps the assets object when a layout copies it unchanged", () => {
    const before = { ...marpDeck("# One\n"), marpAssets: { "a.png": "data:image/png;base64,AA==" } };
    const next = { ...before, marpAssets: { ...before.marpAssets } };
    expect(keepUnchangedParts(before, next).marpAssets).toBe(before.marpAssets);
    const changed = { ...before, marpAssets: { "a.png": "data:image/png;base64,AB==" } };
    expect(keepUnchangedParts(before, changed).marpAssets).toBe(changed.marpAssets);
  });
});
