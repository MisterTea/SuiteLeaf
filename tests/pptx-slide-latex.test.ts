import { describe, expect, it } from "vitest";
import {
  latexMathML,
  latexOfficeMath,
  officeMathLatex,
} from "../packages/core/src/slide-latex";

describe("slide LaTeX conversion", () => {
  it.each([
    [String.raw`\binom{n}{k}`, '<m:type m:val="noBar"/>'],
    [String.raw`x_i^2`, "<m:sSubSup>"],
    [String.raw`x_i`, "<m:sSub>"],
    [String.raw`\sqrt[3]{x}`, "<m:deg>"],
    [String.raw`\underset{a}{x}`, "<m:limLow>"],
    [String.raw`\overset{a}{x}`, "<m:limUpp>"],
    [String.raw`\hat{x}`, "<m:acc>"],
    [String.raw`\sum_{i=1}^{n}`, "<m:limUpp>"],
    [String.raw`\begin{matrix}a&b\\c&d\end{matrix}`, "<m:mr>"],
    [String.raw`x\quad y`, '<m:t xml:space="preserve"> </m:t>'],
  ])("exports %s with editable equation structure", (source, marker) => {
    const xml = latexOfficeMath(source);
    expect(xml).toContain(marker);
    expect(latexMathML(officeMathLatex(xml))).toContain("<math ");
  });

  it("keeps an imported integral and its limits editable", () => {
    const source = officeMathLatex(
      '<m:oMath><m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>',
    );
    expect(source).toBe(String.raw`\int_{0}^{1}x`);
    expect(latexMathML(source)).toContain("<math ");
  });
});
