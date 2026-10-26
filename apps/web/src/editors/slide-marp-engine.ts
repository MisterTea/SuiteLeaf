import { Marp } from "@marp-team/marp-core";
import type { SlideTheme } from "@suiteleaf/core";
import beamUtCss from "./themes/beam_ut.css?raw";
import { DECK_THEMES } from "./slide-theme";

/** Rendered blocks carry the markdown lines they came from, as `start,end`. */
export const SOURCE_LINES = "data-sl-lines";

type Token = {
  type: string;
  nesting: number;
  block: boolean;
  map: [number, number] | null;
  attrSet(name: string, value: string): void;
};
type Render = (tokens: Token[], index: number, ...rest: unknown[]) => string;
type MarkdownIt = {
  core: { ruler: { push(name: string, rule: (state: { tokens: Token[] }) => void): void } };
  renderer: { rules: Record<string, Render | undefined> };
};

function fontList(name: string) {
  return name.includes(",") || !/\s/.test(name) ? name : `"${name}"`;
}

/** A MARP theme with the colors and fonts of a SuiteLeaf theme. */
export function marpThemeCss(theme: SlideTheme): string {
  return `/* @theme ${theme.id} */
@import 'default';
section {
  --color-background: ${theme.background};
  --color-foreground: ${theme.bodyColor};
  --color-highlight: ${theme.accent};
  background-color: ${theme.background};
  color: ${theme.bodyColor};
  font-family: ${fontList(theme.bodyFont)};
}
section h1, section h2, section h3, section h4, section h5, section h6 {
  color: ${theme.headingColor};
  font-family: ${fontList(theme.headingFont)};
}
section a {
  color: ${theme.accent};
}
`;
}

function tagSourceLines(marp: Marp) {
  const md = marp.markdown as unknown as MarkdownIt;
  md.core.ruler.push("suiteleaf_source_lines", (state) => {
    for (const token of state.tokens) {
      if (!token.map || token.type.startsWith("marpit_") || token.type === "front_matter")
        continue;
      if (token.nesting === 1 || (token.nesting === 0 && token.block && token.type !== "inline"))
        token.attrSet(SOURCE_LINES, `${token.map[0]},${token.map[1]}`);
    }
  });
  const math = md.renderer.rules.marp_math_block;
  if (!math) return;
  md.renderer.rules.marp_math_block = (tokens, index, ...rest) => {
    const html = math(tokens, index, ...rest);
    const map = tokens[index].map;
    return map ? html.replace(/^<(p|div)\b/, `<$1 ${SOURCE_LINES}="${map[0]},${map[1]}"`) : html;
  };
}

/** The MARP renderer the editor uses: Beam UT and the built-in themes are available by name. */
export function marpEngine(options: { sourceLines?: boolean } = {}): Marp {
  const marp = new Marp({ html: true, math: "katex" });
  marp.themeSet.add(beamUtCss);
  for (const theme of DECK_THEMES)
    if (theme.id !== "beam_ut") marp.themeSet.add(marpThemeCss(theme));
  if (options.sourceLines) tagSourceLines(marp);
  return marp;
}
