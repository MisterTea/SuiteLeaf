import { expect, it } from "vitest";
import {
  loadMarpBundle,
  marpBundlePaths,
  missingMarpTheme,
} from "../apps/web/src/editors/slide-marp-bundle";

const picked = (relativePath: string, content: string) => ({
  relativePath,
  file: new File([content], relativePath.split("/").pop()!),
});
it("resolves parent paths within the chosen folder and embeds theme-relative resources", async () => {
  const files = [
    picked("decks/talk.md", "# Talk"),
    picked("images/plot.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    picked(
      "themes/custom.css",
      "/* @theme custom */\nsection { background-image: url('../images/plot.svg') }",
    ),
  ];
  const result = await loadMarpBundle(
    "decks/talk.md",
    "![](../images/plot.svg)",
    files,
  );
  expect(result["../images/plot.svg"]).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(result["@asset/images/plot.svg"]).toMatch(
    /^data:image\/svg\+xml;base64,/,
  );
  const css = atob(result["themes/custom.css"].split(",")[1]);
  expect(css).toContain("background-image: url('@asset/images/plot.svg");
});
it("cannot resolve a path outside the explicitly selected folder", async () => {
  const result = await loadMarpBundle("talk.md", "![](../private.png)", [
    picked("private.png", "secret"),
  ]);
  expect(result).toEqual({});
});
it("prompts for custom themes even when the Markdown contains no image paths", () => {
  expect(
    marpBundlePaths("---\nmarp: true\ntheme: custom\n---\n# Talk"),
  ).toEqual(["custom.css"]);
  expect(
    marpBundlePaths("---\nmarp: true\ntheme: default\n---\n# Talk"),
  ).toEqual([]);
  expect(marpBundlePaths("---\nmarp: true\ntheme: ink\n---\n# Talk")).toEqual([]);
  expect(missingMarpTheme("---\ntheme: meadow\n---\n# Talk", {})).toBeNull();
  expect(missingMarpTheme("---\ntheme: custom\n---\n# Talk", {})).toBe("custom");
});
it("keeps the per-file folder import limit", async () => {
  const file = {
    size: 26 * 1024 * 1024,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  };
  await expect(
    loadMarpBundle("talk.md", "![](plot.png)", [
      { relativePath: "plot.png", file },
    ]),
  ).rejects.toThrow("larger than 25 MB");
});

it("retains a matching rendered Marp companion and resolves its document-relative resources", async () => {
  const html =
    '<style>@font-face{src:url(../../fonts/book.otf)}</style><div class="marpit"><svg data-marpit-svg="" viewBox="0 0 1280 720"></svg></div>';
  const result = await loadMarpBundle("slides/week1/talk.md", "# Talk", [
    picked("slides/week1/talk.html", html),
    picked("fonts/book.otf", "font data"),
  ]);
  expect(result["@marp/compiled.html"]).toMatch(/^data:text\/html;base64,/);
  expect(result["../../fonts/book.otf"]).toMatch(/^data:font\/otf;base64,/);
});
