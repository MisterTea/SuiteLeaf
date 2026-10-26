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
  });
});
