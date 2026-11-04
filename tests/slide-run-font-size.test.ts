import { describe, it, expect } from "vitest";
import {
  cleanRun,
  mergeRuns,
  hasTextRuns,
  runsToHtml,
} from "../apps/web/src/editors/slide-runs";
import { runStyle } from "../apps/web/src/editors/slide-text";

describe("imported slide font sizes", () => {
  it("retains mixed point sizes through run cleaning, merging, and rendering", () => {
    const runs = [
      { text: "Title", fontSize: 24 },
      { text: "Author", fontSize: 18 },
    ];
    expect(mergeRuns(runs)).toEqual(runs);
    expect(cleanRun(runs[1])).toEqual(runs[1]);
    expect(hasTextRuns({ runs })).toBe(true);
    expect(runStyle(runs[1], 24).fontSize).toBe("0.75em");
    expect(runsToHtml(runs)).toContain('data-font-size="18"');
    const bullet = [{ text: "n ", font: "SuiteLeaf Sprig", fontSize: 28.6 }, { text: "Next" }];
    expect(mergeRuns(bullet)).toEqual(bullet);
    const html = runsToHtml(bullet);
    expect(html).toContain("font-family:'SuiteLeaf Sprig'");
    expect(html).not.toContain('font-family:"');
    expect(html).toContain('data-font="SuiteLeaf Sprig"');
    expect(runStyle(bullet[0]).fontFamily).toBe("'SuiteLeaf Sprig', 'SuiteLeaf Willow'");
    const marked = [{ text: "arXiv", highlight: "#ffff00" }];
    expect(cleanRun(marked[0])).toEqual(marked[0]);
    expect(hasTextRuns({ runs: marked })).toBe(true);
    expect(runsToHtml(marked)).toContain("background-color:#ffff00");
    expect(runStyle(marked[0]).backgroundColor).toBe("#ffff00");
    const small = [{ text: "Introduction", caps: "small" as const }];
    expect(runsToHtml(small)).toContain("font-variant-caps:small-caps");
    expect(runsToHtml(small)).toContain("font-synthesis:small-caps");
    expect(runStyle(small[0]).fontSynthesis).toBe("small-caps");
    expect(runsToHtml([{ text: "INTRODUCTION", caps: "all" }])).toContain("text-transform:uppercase");
    expect(runsToHtml([{ text: "INTRODUCTION", caps: "all" }])).not.toContain("font-synthesis");
  });

  it("shrinks a baseline shift that omitted its own size", () => {
    const html = runsToHtml([{ text: "1", baseline: 30, scriptScale: true, fontSize: 18 }]);
    expect(html).toContain("position:relative");
    expect(html).toContain("top:-0.3em");
    expect(html).not.toContain("vertical-align:0.3em");
    expect(html).toContain("line-height:0");
    expect(html).toContain("font-size:0.65em");
    expect(runStyle({ text: "1", baseline: 30, fontSize: 18 }).lineHeight).toBe(0);
    expect(runStyle({ text: "1", baseline: 30, fontSize: 18 }).top).toBe("-0.3em");
    expect(html).toContain('data-script-scale="1"');
    expect(html).toContain("font-size:calc(18 * var(--slide-pt, 1) * 1px)");
    expect(cleanRun({ text: "1", baseline: 30, scriptScale: true }).scriptScale).toBe(true);
    const sized = runsToHtml([{ text: "2", baseline: 30, fontSize: 12 }]);
    expect(sized).not.toContain("font-size:0.65em");
  });

  it("keeps a hyphenated word together when latin line breaking is off", () => {
    const tracked = runsToHtml([{ text: "Dashboard", tracking: -3 }]);
    expect(tracked).toContain("letter-spacing:calc(-3 * var(--slide-pt, 1) * 1px)");
    expect(cleanRun({ text: "Dashboard", tracking: -3 }).tracking).toBe(-3);
    const html = runsToHtml([{ text: "data-sharing agreement", unbroken: true }]);
    expect(html).toContain("white-space:nowrap");
    expect(html).toContain("data-sharing");
    expect(html).not.toContain("\u2060");
    expect(runsToHtml([{ text: "data-sharing" }])).not.toContain("nowrap");
    const url = runsToHtml([
      {
        text: "http://tiedonhinta.fi/en/2018/04/04/finnish-researchers-are-calling-for-improved-transparency",
        unbroken: true,
      },
    ]);
    expect(url).not.toContain("\u2060");
    expect(url).toContain("calling-for-improved");
  });

  it("paints a hard break as a line element so a trailing break keeps its line", () => {
    const html = runsToHtml([{ text: "Open Science" }, { text: "\n" }]);
    expect(html).toContain('min-height:1lh');
    expect(html).not.toContain(">\n<");
  });

  it("gives a smaller hard-break line its own box so the title strut does not clip it", () => {
    const html = runsToHtml([
      { text: "The Turing Way", fontSize: 40 },
      { text: "\n" },
      { text: "A handbook", fontSize: 28 },
      { text: "\n", fontSize: 28 },
      { text: "\n", fontSize: 28 },
      { text: "Kirstie", fontSize: 28 },
    ]);
    expect(html).toContain('data-slide-line="1"');
    expect(html).toContain("font-size:calc(40 * var(--slide-pt, 1) * 1px)");
    expect(html).toContain("font-size:calc(28 * var(--slide-pt, 1) * 1px)");
    expect(html.match(/data-slide-line/g)).toHaveLength(4);
    expect(html).toContain("min-height:1lh");
    expect(html).not.toContain("<br>");
  });

  it("keeps a paragraph break to one line and a hard break to one break", () => {
    const paragraphs = runsToHtml([
      { text: "Collaboration", fontSize: 36 },
      { text: "\n", paragraphBreak: true, fontSize: 36 },
      { text: "Making good practices", fontSize: 36 },
    ]);
    expect(paragraphs.match(/data-slide-para/g)).toHaveLength(2);
    expect(paragraphs).not.toContain("min-height:1lh");
    const broken = runsToHtml([{ text: "Open" }, { text: "\n" }, { text: "Science" }]);
    expect(broken).toContain("<br>");
    expect(broken).not.toContain("min-height:1lh");
  });

  it("keeps a larger symbol bullet from setting the line size", () => {
    const html = runsToHtml([
      { text: "n ", font: "SuiteLeaf Sprig", fontSize: 31, paraHang: 20 },
      { text: "Evidence", fontSize: 24 },
      { text: "\n", paragraphBreak: true, fontSize: 18, paraHang: 20 },
      { text: "n ", font: "SuiteLeaf Sprig", fontSize: 23 },
      { text: "Reports", fontSize: 18 },
      { text: "\n", fontSize: 18 },
      { text: "sets", fontSize: 16 },
    ]);
    const para = html.match(/class="slide-para"[^>]*style="([^"]*)"/);
    expect(para?.[1]).toContain("font-size:calc(24 * var(--slide-pt, 1) * 1px)");
    expect(para?.[1]).not.toContain("calc(31 ");
    expect(html).toContain("line-height:0");
    expect(html).toContain('data-font-size="31"');
    expect(html).not.toContain('data-slide-line="1" data-font-size="23"');
    expect(html).toContain('data-font-size="16"');
  });

  it("does not use a symbol bullet size when the words store none", () => {
    const html = runsToHtml([
      { text: "n ", font: "SuiteLeaf Sprig", fontSize: 31, paraHang: 12 },
      { text: "Plain" },
    ]);
    const para = html.match(/class="slide-para"[^>]*style="([^"]*)"/);
    expect(para?.[1]).not.toContain("font-size");
    expect(html).toContain('data-font-size="31"');
  });

  it("paints a run shadow as a CSS text-shadow", () => {
    const shadow = { x: 2.12, y: 2.12, blur: 3, color: "rgba(0, 0, 0, 0.431)" };
    const html = runsToHtml([{ text: "Projects", shadow }]);
    expect(html).toContain(
      "text-shadow:calc(2.12 * var(--slide-pt, 1) * 1px) calc(2.12 * var(--slide-pt, 1) * 1px) calc(3 * var(--slide-pt, 1) * 1px) rgba(0, 0, 0, 0.431)",
    );
    expect(html).toContain('data-shadow="1"');
    expect(cleanRun({ text: "Projects", shadow }).shadow).toEqual(shadow);
    expect(hasTextRuns({ runs: [{ text: "Projects", shadow }] })).toBe(true);
  });

  it("paints a gradient through the glyphs and a reflection under the paragraph", () => {
    const reflection = { startAlpha: 0.55, endAlpha: 0.003, endPos: 0.455 };
    const html = runsToHtml([
      {
        text: "Structure",
        gradient: "linear-gradient(180deg, #D0B0E8 0%, #5B2C83 100%)",
        stroke: "#112233",
        strokeWidth: 1,
        reflection,
      },
    ]);
    expect(html).toContain("background-image:linear-gradient(180deg, #D0B0E8 0%, #5B2C83 100%)");
    expect(html).toContain("background-clip:text");
    expect(html).toContain("-webkit-text-fill-color:transparent");
    expect(html).toContain('data-gradient="1"');
    expect(html).toContain('data-reflection="1"');
    expect(html).toContain("-webkit-box-reflect:below 0 linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0.003) 45.5%, rgba(0,0,0,0) 45.5%)");
    expect(cleanRun({ text: "Structure", reflection }).reflection).toEqual(reflection);
  });
});
