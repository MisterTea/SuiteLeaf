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
    expect(runStyle(bullet[0]).fontFamily).toBe("SuiteLeaf Sprig");
    const marked = [{ text: "arXiv", highlight: "#ffff00" }];
    expect(cleanRun(marked[0])).toEqual(marked[0]);
    expect(hasTextRuns({ runs: marked })).toBe(true);
    expect(runsToHtml(marked)).toContain("background-color:#ffff00");
    expect(runStyle(marked[0]).backgroundColor).toBe("#ffff00");
  });

  it("keeps a hyphenated word together when latin line breaking is off", () => {
    const tracked = runsToHtml([{ text: "Dashboard", tracking: -3 }]);
    expect(tracked).toContain("letter-spacing:calc(-3 * var(--slide-pt, 1) * 1px)");
    expect(cleanRun({ text: "Dashboard", tracking: -3 }).tracking).toBe(-3);
    const html = runsToHtml([{ text: "data-sharing agreement", unbroken: true }]);
    expect(html).toContain("data-\u2060sharing");
    expect(runsToHtml([{ text: "data-sharing" }])).not.toContain("\u2060");
    const url = runsToHtml([
      {
        text: "http://tiedonhinta.fi/en/2018/04/04/finnish-researchers-are-calling-for-improved-transparency",
        unbroken: true,
      },
    ]);
    expect(url).not.toContain("\u2060");
    expect(url).toContain("calling-for-improved");
  });
});
