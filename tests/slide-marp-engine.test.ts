import { describe, expect, it, vi } from "vitest";
import { DECK_THEMES } from "../apps/web/src/editors/slide-theme";
import { marpEngine, marpThemeCss, SOURCE_LINES } from "../apps/web/src/editors/slide-marp-engine";

vi.mock("../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */\nsection { background: #fff; }",
}));

describe("the editor's MARP renderer", () => {
  it("marks each rendered block with the markdown lines it came from", () => {
    const { html } = marpEngine({ sourceLines: true }).render(
      "# Title\n\n- one\n  - two\n\n$$\nx^2\n$$\n\n```js\nconst a = 1;\n```\n\n| a |\n|---|\n| 1 |\n",
    );
    const marks = new Map(
      [...html.matchAll(new RegExp(`<(\\w+)[^>]*${SOURCE_LINES}="(\\d+),\\d+"`, "g"))].map(
        (match) => [`${match[1]} ${match[2]}`, true],
      ),
    );
    for (const mark of ["h1 0", "ul 2", "li 2", "li 3", "p 5", "code 9", "table 13"])
      expect(marks.has(mark), mark).toBe(true);
    expect(html).not.toMatch(/<section[^>]*data-sl-lines/);
    expect(marpEngine().render("# Title").html).not.toContain(SOURCE_LINES);
  });

  it("draws the built-in themes by name with their colors and fonts", () => {
    const ink = DECK_THEMES.find((theme) => theme.id === "ink")!;
    const css = marpThemeCss(ink);
    expect(css).toContain("/* @theme ink */");
    expect(css).toContain(`background-color: ${ink.background}`);
    expect(css).toContain('font-family: "Trebuchet MS"');
    const { css: rendered } = marpEngine().render("---\ntheme: ink\n---\n\n# Dark");
    expect(rendered).toContain(ink.background);
    expect(rendered).toContain(ink.headingColor);
  });
});
