import { describe, expect, it } from "vitest";
import type { TextRun } from "../packages/core/src";
import {
  cleanRun,
  glueShortHyphenHtml,
  hasTextRuns,
  mergeRuns,
  normalizeColor,
  replaceRunRange,
  runsToHtml,
  textInnerHtml,
} from "../apps/web/src/editors/slide-runs";
import {
  formatRange,
  rangeColor,
  rangeHas,
  styleSelection,
  styleWholeBox,
} from "../apps/web/src/editors/slide-run-format";

describe("replacing part of the words", () => {
  const runs: TextRun[] = [{ text: "Hello", bold: true }, { text: " world" }];

  it("inserts typed text at the end, the start, and between runs in the style before it", () => {
    expect(replaceRunRange(runs, 11, 11, "!")).toEqual([{ text: "Hello", bold: true }, { text: " world!" }]);
    expect(replaceRunRange(runs, 5, 5, "!")).toEqual([{ text: "Hello!", bold: true }, { text: " world" }]);
    expect(replaceRunRange(runs, 0, 0, ">")).toEqual([{ text: ">Hello", bold: true }, { text: " world" }]);
    expect(replaceRunRange([{ text: "• one" }], 5, 5, "\n• ")).toEqual([{ text: "• one" }, { text: "\n• " }]);
  });

  it("replaces a slice that crosses runs with the first run's style", () => {
    expect(replaceRunRange(runs, 3, 8, "p wo")).toEqual([{ text: "Help wo", bold: true }, { text: "rld" }]);
    expect(replaceRunRange(runs, 6, 11, "there")).toEqual([{ text: "Hello", bold: true }, { text: " there" }]);
  });
});

describe("cleaning and joining runs", () => {
  it("keeps every mark a run can carry and drops empty ones", () => {
    const full: TextRun = {
      text: "x",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      color: "#111111",
      highlight: "#222222",
      stroke: "#333333",
      strokeWidth: 1,
      shadow: { x: 1, y: 1, blur: 2, color: "#000" },
      gradient: "linear-gradient(red, blue)",
      reflection: { startAlpha: 0.5, endAlpha: 0, endPos: 0.5 },
      fontSize: 20,
      caps: "all",
      baseline: 30,
      scriptScale: true,
      font: "Arial",
      paragraphBreak: true,
      paraMargin: 1,
      paraHang: 2,
      paraFirst: 3,
      paraTab: 36,
      paraTabs: [{ pos: 72, align: "l" }],
      spaceBefore: 4,
      paraAlign: "center",
      paraLine: 1.2,
      unbroken: true,
      tracking: 2,
      fraction: { num: [{ text: "1" }], den: [{ text: "2" }] },
      bulletSrc: "data:image/png;base64,AA==",
      href: "https://example.com",
    };
    expect(cleanRun(full)).toEqual(full);
    expect(cleanRun({ text: "y", bold: false, paraTabs: [], color: "" })).toEqual({ text: "y" });
  });

  it("joins neighbours with one style and keeps hard breaks apart", () => {
    expect(mergeRuns([{ text: "a" }, { text: "" }, { text: "b" }, { text: "\n" }, { text: "c" }])).toEqual([
      { text: "ab" },
      { text: "\n" },
      { text: "c" },
    ]);
    expect(hasTextRuns({ runs: [{ text: "a", tracking: 1 }] })).toBe(true);
    expect(hasTextRuns({ runs: [{ text: "a", unbroken: true }] })).toBe(true);
  });

  it("reads hex and rgb colours", () => {
    expect(normalizeColor(" #ABCDEF ")).toBe("#abcdef");
    expect(normalizeColor("rgb(255, 0, 300)")).toBe("#ff00ff");
    expect(normalizeColor("rgba(1,2,3,0.5)")).toBe("#010203");
    expect(normalizeColor("red")).toBeUndefined();
  });
});

describe("painting runs as HTML", () => {
  it("writes each mark as style and data the editor can read back", () => {
    const html = runsToHtml(
      [
        { text: "s", strike: true, underline: true },
        { text: "t", color: "transparent" },
        { text: "h", highlight: "rgb(255, 255, 0)" },
        { text: "o", stroke: "#000000", strokeWidth: 2, gradient: "linear-gradient(red, blue)" },
        { text: "w", shadow: { x: 1, y: 2, blur: 3, color: "#000" } },
        { text: "k", fontSize: 24 },
        { text: "c", caps: "small" },
        { text: "2", baseline: -25, scriptScale: true },
        { text: "sp", tracking: 3 },
        { text: "f", font: 'Bad"Font<' },
        { text: "link", href: "https://example.com/a" },
        { text: "nolink", href: "javascript:alert(1)" },
        { text: "x-ray", unbroken: true },
        { text: "e\u0302\u0301 ok" },
      ],
      100,
    );
    expect(html).toContain("text-decoration:underline line-through");
    expect(html).toContain('data-strike="1"');
    expect(html).toContain("color:transparent");
    expect(html).toContain('data-highlight="#ffff00"');
    expect(html).toContain("-webkit-text-fill-color:transparent");
    expect(html).toContain('data-stroke-width="2"');
    expect(html).toContain('data-shadow="1"');
    expect(html).toContain('data-gradient="1"');
    expect(html).toContain("font-kerning:");
    expect(html).toContain("font-variant-caps:small-caps");
    expect(html).toContain('data-script-scale="1"');
    expect(html).toContain('<span style="font-size:0.65em">2</span>');
    expect(html).toContain('data-tracking="3"');
    expect(html).toContain('data-font="BadFont"');
    expect(html).toContain('<a href="https://example.com/a" target="_blank"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<span style="white-space:nowrap">x-ray</span>');
    expect(html).toContain("\u02C6\u0301");
  });

  it("stacks fractions and keeps an inline limit on the line", () => {
    const stacked = runsToHtml([
      { text: "1/2", fraction: { num: [{ text: "a" }, { text: "2", script: "sup" }], den: [{ text: "b", script: "sub" }] } },
    ]);
    expect(stacked).toContain("flex-direction:column");
    expect(stacked).toContain("vertical-align:0.4em");
    expect(stacked).toContain("vertical-align:-0.25em");
    const inline = runsToHtml([{ text: "lim", fraction: { bar: false, num: [{ text: "lim" }], den: [] } }]);
    expect(inline).toContain("white-space:nowrap");
    expect(inline).toContain("&#8203;");
  });

  it("lays out paragraphs with indents, spacing, line height, reflections, and blank lines", () => {
    const html = runsToHtml(
      [
        { text: "First", paraFirst: 10, paraTab: 36, spaceBefore: 6, paraAlign: "justify", paraLine: 1.5 },
        { text: "\n", paragraphBreak: true, paraLine: 2 },
        { text: "\n", paragraphBreak: true, fontSize: 20 },
        { text: "Mirror", reflection: { startAlpha: 0.5, endAlpha: 0.1, endPos: 0.35 } },
      ],
      undefined,
      undefined,
      { lineHeight: 1.2 },
    );
    const paras = html.split('<span class="slide-para"').slice(1);
    expect(paras).toHaveLength(3);
    expect(paras[0]).toContain("text-indent:calc(10px");
    expect(paras[0]).toContain('data-para-tab="36"');
    expect(paras[0]).toContain("margin-top:calc(6px");
    expect(paras[0]).toContain("text-align:justify");
    expect(paras[0]).toContain("line-height:1.5");
    expect(paras[1]).toContain('line-height:2"');
    expect(paras[1]).toContain("<br>");
    expect(paras[2]).toContain("line-height:1.2");
    expect(paras[2]).toContain("-webkit-box-reflect:below 0 linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0.1) 35%");
    expect(paras[2]).toContain('data-reflection="1"');
  });

  it("puts a list marker in the gutter, as a picture or a glyph, and sizes it to the words", () => {
    const marp = runsToHtml([{ text: "• Point one" }], undefined, 24);
    expect(marp).toContain("slide-bullet-fixed");
    expect(marp).toContain("display:inline-block;width:0;white-space:pre;transform:translateX(calc(-24px");
    const picture = runsToHtml(
      [{ text: "• ", bulletSrc: "data:image/png;base64,AA==", paraHang: 18 }, { text: "Word", fontSize: 30 }],
    );
    expect(picture).toContain('data-bullet-src="data:image/png;base64,AA=="');
    expect(picture).toContain("<img");
    expect(picture).toContain("display:inline-block;min-width:calc(18px");
    const strut = (html: string) => /class="slide-para"[^>]*style="([^"]*)"/.exec(html)?.[1];
    const symbol = { text: "§ ", font: "Wingdings", fontSize: 40, paraHang: 18 };
    expect(strut(runsToHtml([symbol, { text: "Word", fontSize: 30 }]))).toContain("font-size:calc(30 ");
    expect(strut(runsToHtml([symbol, { text: "Word" }]))).not.toContain("font-size");
    expect(strut(runsToHtml([{ ...symbol, font: undefined }, { text: "Word" }]))).toContain("font-size:calc(40 ");
  });

  it("advances tabs to the stops, after the marker in the gutter", () => {
    const html = runsToHtml([
      { text: "•\tName\tScore", paraHang: 18, paraTabs: [{ pos: 144, align: "l" }] },
      { text: "\n" },
      { text: "\tnext", paraTab: 36 },
    ]);
    expect(html.match(/display:inline-block;width:calc\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Name");
    expect(html).toContain("<br>");
  });

  it("measures continuation tabs from the box inset including the hanging gutter", () => {
    const html = runsToHtml([
      { text: "• Text", paraHang: 18, paraTab: 72 },
      { text: "\n" },
      { text: "\tcode" },
    ]);
    expect(html).toContain("width:calc(54 *");
    expect(html).not.toContain("width:calc(72 *");
    expect(html).toContain('class="slide-bullet-slot"');
  });

  it("uses a new paragraph's font for its line strut in a mixed-font box", () => {
    const html = textInnerHtml({
      content: "Title\nBody", fontFamily: "Nunito", fontSize: 18, lineHeight: 1.2,
      runs: [
        { text: "Title", font: "Nunito", fontSize: 18 },
        { text: "\n", paragraphBreak: true, fontSize: 18 },
        { text: "Body", font: "Assistant", fontSize: 18 },
      ],
    });
    const body = html.split('data-para-index="1"')[1];
    expect(body.split("><span")[0]).toContain("font-family:'Assistant'");
  });

  it("paints a tight line's words higher, as PowerPoint takes the missing height from above", () => {
    const box = (lineHeight: number) =>
      textInnerHtml({
        content: "Tight",
        runs: [{ text: "Tight", fontSize: 20 }],
        fontFamily: "SuiteLeaf Willow",
        fontSize: 20,
        lineHeight,
      });
    const tight = box(1.2 * 0.8);
    expect(tight).toContain("position:relative");
    expect(tight).toContain("- 20 * var(--slide-pt, 1) * 1.2 * 1px) / 2)");
    expect(box(1.2)).not.toContain("position:relative");
    expect(box(1.2 * 1.5)).not.toContain("position:relative");
  });

  it("writes a box with no marks as escaped text and a marked one as paragraphs", () => {
    expect(textInnerHtml({ content: "a < b" })).toBe("a &lt; b");
    expect(textInnerHtml({ content: "ab", runs: [{ text: "a", bold: true }, { text: "b" }], fontSize: 20 })).toContain(
      'data-bold="1"',
    );
    expect(glueShortHyphenHtml("a-b c/d-e")).toBe('<span style="white-space:nowrap">a-b</span> c/d-e');
  });
});

describe("styling a range of words", () => {
  const runs: TextRun[] = [{ text: "Red", color: "#ff0000" }, { text: " and" }, { text: " blue", color: "#0000ff" }];

  it("reads which marks and colour the whole range shares", () => {
    expect(rangeColor(runs, 0, 3)).toBe("#ff0000");
    expect(rangeColor(runs, 0, 6)).toBeUndefined();
    expect(rangeColor(runs, 4, 7)).toBeUndefined();
    expect(rangeColor(runs, 2, 2)).toBeUndefined();
    expect(rangeHas([{ text: "ab", bold: true }], 1, 1, "bold")).toBe(false);
    expect(rangeHas([{ text: "ab", bold: true }, { text: "c" }], 0, 3, "bold")).toBe(false);
    expect(rangeHas([], 0, 3, "bold")).toBe(false);
  });

  it("colours a range and takes the colour off when it is already that colour", () => {
    expect(formatRange(runs, 1, 1, { bold: true })).toEqual(runs);
    expect(formatRange(runs, 0, 3, { color: "" })).toEqual([{ text: "Red and" }, { text: " blue", color: "#0000ff" }]);
    const el = { content: "Red and blue", runs };
    expect(styleSelection(el, 0, 3, { type: "color", color: "#FF0000" }).runs?.[0]).toEqual({ text: "Red and" });
    expect(styleSelection(el, 4, 7, { type: "color", color: "rgb(0, 128, 0)" }).runs).toContainEqual({ text: "and", color: "#008000" });
    expect(styleSelection({ content: "" }, 0, 0, { type: "bold" })).toEqual({
      content: "",
      runs: undefined,
      bold: false,
      italic: false,
      underline: false,
    });
  });

  it("styles every word of a box and keeps the theme for plain words", () => {
    expect(styleWholeBox({ content: "Hi" }, "bold")).toEqual({ bold: true, themeOverride: true });
    expect(styleWholeBox({ content: "Hi", italic: true }, "italic")).toEqual({ italic: false });
    expect(styleWholeBox({ content: "ab", runs: [{ text: "a", bold: true }, { text: "b", bold: true }] }, "bold")).toEqual({
      bold: false,
      runs: undefined,
      italic: false,
      underline: false,
    });
    expect(styleWholeBox({ content: "ab", runs: [{ text: "a", italic: true }, { text: "b" }] }, "underline")).toEqual({
      underline: true,
      runs: [
        { text: "a", italic: true, underline: true },
        { text: "b", underline: true },
      ],
    });
  });
});


it("hangs trailing ordinary spaces at hard line ends without dropping their text", () => {
  const html = runsToHtml([{text:"Centered ",fontSize:60},{text:"\n"},{text:"Second"}]);
  expect(html).toContain('data-slide-hanging-space="1"');
  expect(html).toContain('width:0;overflow:hidden;font-size:0;line-height:0"> </span>');
  expect(html).toContain("Centered");
  expect(runsToHtml([{text:"Internal space remains"}])).not.toContain("data-slide-hanging-space");
});

it("aligns overflowing nowrap text around its full line width", () => {
  expect(runsToHtml([{text:"01",fontSize:60}], undefined, undefined, {nowrap:true,align:"center"})).toContain("transform:translateX(-50%)");
  expect(runsToHtml([{text:"01",fontSize:60}], undefined, undefined, {nowrap:true,align:"right"})).toContain("transform:translateX(-100%)");
  expect(runsToHtml([{text:"01",fontSize:60}], undefined, undefined, {align:"center"})).not.toContain("width:max-content");
  expect(hasTextRuns({runs:[{text:"distributed",paraDistributed:true}]})).toBe(true);
  expect(hasTextRuns({runs:[{text:"tracked",tracking:3}]})).toBe(true);
});

it("keeps multi-character list markers unwrapped inside a zero-width hanging slot", () => {
 const html=textInnerHtml({content:"a) Item",fontSize:18,hang:36,runs:[{text:"a) ",font:"Arial"},{text:"Item",fontSize:18}]});
 expect(html).toContain("width:0;white-space:pre;transform:");
 expect(html).toContain(">a)</span>");
});
