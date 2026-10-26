import { describe, expect, it } from "vitest";
import {
  colorKey,
  isHtmlOnly,
  unknownTags,
  comparableText,
  mapMarpSource,
  markdownText,
  markdownUnits,
  marpProblem,
  normalizeMarp,
} from "../apps/web/src/editors/slide-marp-source";
import { isMarpDirective, marpToDeck } from "../apps/web/src/editors/slide-marp";
import { createMarpFile } from "../apps/web/src/editors/slide-marp";

describe("MARP source map", () => {
  it("splits slides where MARP does, not at rules inside code or under a heading", () => {
    const source = [
      "---",
      "marp: true",
      "---",
      "",
      "# One",
      "",
      "```yaml",
      "---",
      "```",
      "",
      "Two",
      "---",
      "",
      "***",
      "",
      "# Three",
      "<!-- _class: lead -->",
      "<!-- Speaker notes -->",
      "",
    ].join("\n");
    const map = mapMarpSource(source);
    expect(map.front).toEqual([0, 3]);
    expect(map.slides.map((slide) => [slide.rule, slide.lines])).toEqual([
      [null, [3, 13]],
      [13, [14, 19]],
    ]);
    expect(map.slides[1].comments).toEqual([
      { lines: [16, 17], text: "_class: lead", directive: true },
      { lines: [17, 18], text: "Speaker notes", directive: false },
    ]);
  });

  it("has one slide for a deck without front matter or rules", () => {
    const map = mapMarpSource("# Only\n\nText");
    expect(map.front).toBeNull();
    expect(map.slides).toHaveLength(1);
    expect(map.slides[0].lines).toEqual([0, 3]);
  });

  it("reads the lines each heading, paragraph, item, and quote shows", () => {
    const units = markdownUnits(
      "## Title *here*\n\nPara with **bold**\nwrapped $x$ and ![p](a.png)\n\n- a\n  1. b\n- c\n\n> q1\n>\n> q2\n",
    );
    expect(units.map((unit) => [unit.kind, unit.lines, unit.prefix])).toEqual([
      ["heading", [0, 1], "## "],
      ["paragraph", [2, 4], ""],
      ["item", [5, 6], "- "],
      ["item", [6, 7], "  1. "],
      ["item", [7, 8], "- "],
      ["quote", [9, 12], "> "],
    ]);
    expect(units[0].runs).toEqual([{ text: "Title " }, { text: "here", italic: true }]);
    expect(units[1].runs.map((run) => run.text).join("")).toBe("Para with bold wrapped $x$ and ");
    expect(units[5].runs.map((run) => run.text).join("")).toBe("q1 q2");
  });

  it("reads underline and color written as inline HTML", () => {
    const [unit] = markdownUnits(
      'Say <u>this</u>, <span style="color: #BF5700">that</span>, <font color="red">old</font>, ' +
        '<span style="text-decoration: underline; color: rgb(0, 0, 255)">both <b>x</b></span> <img src="a.png"> end',
    );
    expect(unit.runs).toEqual([
      { text: "Say " },
      { text: "this", underline: true },
      { text: ", " },
      { text: "that", color: "#bf5700" },
      { text: ", " },
      { text: "old", color: "red" },
      { text: ", " },
      { text: "both x", underline: true, color: "#0000ff" },
      { text: "  end" },
    ]);
    expect(colorKey("#ABC")).toBe("#aabbcc");
    expect(colorKey("rgba(255, 0, 16, 0.5)")).toBe("#ff0010");
    expect(colorKey(" Red ")).toBe("red");
    expect(colorKey(undefined)).toBeUndefined();
  });

  it("compares shown text without list markers or extra spaces", () => {
    expect(comparableText("• One\n  2. Two  words\n\n")).toBe("One\nTwo words");
    expect(markdownText("- One\n  1. Two\n    words\n")).toBe("One\nTwo words");
  });

  it("normalizes a byte order mark and Windows line endings", () => {
    expect(normalizeMarp("\uFEFF# A\r\nB\rC")).toBe("# A\nB\nC");
  });
});

describe("invalid MARP markdown", () => {
  it("accepts ordinary decks, including comments and fences written correctly", () => {
    expect(marpProblem("---\nmarp: true\n---\n\n# A\n\n<!-- note\nmore -->\n\n```\n<!--\n```\n")).toBeNull();
    expect(marpProblem("Use `<!--` to start a comment.")).toBeNull();
    expect(marpProblem("")).toBeNull();
  });

  it("names the line of a code block or comment that is never closed", () => {
    expect(marpProblem("# A\n\n```js\nconst a = 1;\n")).toBe(
      "The code block that starts on line 3 is never closed with ```.",
    );
    expect(marpProblem("# A\n\n~~~~\ncode\n~~~\n")).toBe(
      "The code block that starts on line 3 is never closed with ~~~~.",
    );
    expect(marpProblem("# A\n\n<!-- _class: lead\n\n# B")).toBe(
      "The comment that starts on line 3 is never closed with -->.",
    );
  });

  it("reports header and directive mistakes", () => {
    expect(marpProblem("---\nmarp: true\ntheme: default\n")).toMatch(/missing its closing ---/);
    expect(marpProblem("---\ntheme:\n  name: Half\n---\n# A")).toMatch(/needs/);
    expect(marpProblem("<!-- _backgroundColor: blue -->\n# A")).toMatch(/^Slide 1: Background color/);
  });
});

describe("HTML in MARP markdown", () => {
  it("reports a container tag that is never closed, or closed without opening, by line", () => {
    expect(marpProblem("# A\n\n<div class=\"box\">\n\nInside\n")).toBe("The <div> on line 3 is never closed.");
    expect(marpProblem("# A\n\nText\n\n</section>\n")).toBe("The </section> on line 5 has no opening <section>.");
    expect(marpProblem("# A\n\n<div>\n<figure>\n</div>\n")).toBe("The <figure> on line 4 is never closed.");
    expect(marpProblem("# A\n\n<div>\n\n---\n\n</div>\n")).toBe("The <div> on line 3 is never closed.");
  });

  it("accepts balanced HTML, optional end tags, void tags, and tags inside code or comments", () => {
    expect(
      marpProblem(
        [
          '<div style="display: grid">',
          "<div>",
          "",
          "Left <br> <img src=\"a.png\"> <span>open",
          "",
          "</div>",
          "</div>",
          "",
          "<table><tr><td>a<td>b</table>",
          "",
          "`<div>` in code, \\<div> escaped, <https://example.com> linked",
          "",
          "```html",
          "<div>",
          "```",
          "",
          "<!-- <section> -->",
          "<p>Paragraph without its end tag",
          "<svg><rect/></svg>",
        ].join("\n"),
      ),
    ).toBeNull();
  });

  it("lists only self-contained HTML blocks for each slide", () => {
    const map = mapMarpSource(
      '# A\n\n<div class="mermaid">graph LR\nA-->B</div>\n\n<div style="display: grid">\n<div>\n\nText\n\n</div>\n</div>\n\n---\n\n<figure>\n<img src="a.png">\n</figure>\n',
    );
    expect(map.slides.map((slide) => slide.html)).toEqual([[[2, 4]], [[15, 18]]]);
  });

  it("knows which inline tags it can write and which paragraphs are only HTML", () => {
    expect(unknownTags('a <u>b</u> <span style="color: red">c</span> <sup>2</sup> <span class="x">d</span>')).toEqual([
      "</sup>",
      '<span class="x">',
      "<sup>",
    ]);
    expect(unknownTags('<span style="font-size: 40px">x</span>')).toEqual(['<span style="font-size: 40px">']);
    expect(isHtmlOnly('<svg width="10"><rect/></svg>')).toBe(true);
    expect(isHtmlOnly("<u>Underlined line</u>")).toBe(false);
    expect(isHtmlOnly("<sup>1</sup> footnote text")).toBe(false);
    expect(isHtmlOnly("Plain words")).toBe(false);
  });
});

describe("MARP comments and front matter", () => {
  it("tells settings comments from speaker notes", () => {
    expect(isMarpDirective("paginate: true")).toBe(true);
    expect(isMarpDirective("_class: lead\n_backgroundColor: #fff")).toBe(true);
    expect(isMarpDirective("Remember: smile")).toBe(false);
    expect(isMarpDirective("Just notes")).toBe(false);
    const file = createMarpFile("Deck");
    const parsed = marpToDeck("# A\n\n<!-- paginate: true -->\n<!-- Real notes -->\n", file.content, { marp: true });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.deck.slides[parsed.deck.slideOrder[0]].notes).toBe("Real notes");
  });

  it("starts a new MARP deck from markdown with its title", () => {
    const file = createMarpFile("Quarterly review");
    expect(file.content.marpSource).toBe("---\nmarp: true\n---\n\n# Quarterly review\n");
    expect(file.content.marpFit).toBe(false);
    const slide = file.content.slides[file.content.slideOrder[0]];
    expect(slide.elements[0].content).toBe("Quarterly review");
  });

  it("reads a two-column grid as two columns", () => {
    const file = createMarpFile("Deck");
    const parsed = marpToDeck(
      '# Split\n\n<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1em;">\n<div>\n\nLeft\n\n</div>\n<div>\n\nRight\n\n</div>\n</div>\n',
      file.content,
      { marp: true },
    );
    if ("error" in parsed) throw new Error(parsed.error);
    const slide = parsed.deck.slides[parsed.deck.slideOrder[0]];
    expect(slide.layout).toBe("two-column");
    expect(slide.elements.map((el) => el.content)).toEqual(["Split", "Left", "Right"]);
  });
});
