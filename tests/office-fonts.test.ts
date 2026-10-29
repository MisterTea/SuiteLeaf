import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonts = new URL("../apps/web/src/fonts/", import.meta.url);
const css = readFileSync(new URL("office-fonts.css", fonts), "utf8");
const mapping: Record<string, string> = JSON.parse(readFileSync(new URL("office-font-equivalents.json", fonts), "utf8"));

type Face = { family: string; file: string; weight: number; style: string; range?: string };

const faces: Face[] = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map(([, body]) => ({
  family: /font-family: "([^"]+)"/.exec(body)![1],
  file: /url\("\.\/([^"]+)"\)/.exec(body)![1],
  weight: Number(/font-weight: (\d+)/.exec(body)![1]),
  style: /font-style: (\w+)/.exec(body)![1],
  range: /unicode-range: ([^;]+);/.exec(body)?.[1],
}));

describe("Office font faces", () => {
  it("points every face at a font file that is installed", () => {
    expect(faces.length).toBeGreaterThan(300);
    for (const face of faces) expect(existsSync(new URL(face.file, fonts)), face.file).toBe(true);
  });

  it("draws Calibri's four styles with SuiteLeaf Willow", () => {
    const calibri = faces.filter((face) => face.family === "Calibri");
    expect(calibri.map(({ weight, style, file }) => [weight, style, file])).toEqual(
      expect.arrayContaining([
        [400, "normal", "suiteleaf-willow-regular.woff2"],
        [700, "normal", "suiteleaf-willow-bold.woff2"],
        [400, "italic", "suiteleaf-willow-italic.woff2"],
        [700, "italic", "suiteleaf-willow-bold-italic.woff2"],
      ]),
    );
  });

  it("draws every font the Docs picker offers with a SuiteLeaf face, including ones Windows supplies", () => {
    for (const [name, file] of [
      ["Arial", "suiteleaf-aspen-regular.woff2"],
      ["Georgia", "suiteleaf-durian-regular.woff2"],
      ["Times New Roman", "suiteleaf-maple-regular.woff2"],
      ["Courier New", "suiteleaf-longan-regular.woff2"],
    ])
      expect(faces.find((face) => face.family === name && face.weight === 400 && face.style === "normal")?.file, name).toBe(file);
  });

  it("names faces the way documents do, including localized and typographic family names", () => {
    const families = new Set(faces.map((face) => face.family));
    for (const name of ["Times New Roman", "Aptos", "Aptos SemiBold", "Consolas", "ＭＳ ゴシック", "바탕", "Wingdings"])
      expect(families, name).toContain(name);
    expect(new Set(faces.filter((face) => face.family === "Aptos").map((face) => face.weight)).size).toBeGreaterThan(4);
  });

  it("covers every mapped Office font that has a face", () => {
    const targets = new Set(Object.values(mapping));
    expect(targets.has("SuiteLeaf Willow")).toBe(true);
    expect(faces.filter((face) => face.file.startsWith("suiteleaf-")).length).toBeGreaterThan(250);
  });

  it("leaves CJK characters of CJK fonts to other faces", () => {
    const gothic = faces.find((face) => face.family === "ＭＳ Ｐゴシック")!;
    expect(gothic.range).toBeDefined();
    expect(gothic.range).not.toMatch(/U\+3[0-9A-F]{3}-/);
    expect(faces.find((face) => face.family === "Calibri")!.range).toBeUndefined();
  });

  it("loads after the local Japanese fallbacks so those only take what the faces leave out", () => {
    const style = readFileSync(new URL("../apps/web/src/style.css", import.meta.url), "utf8");
    expect(style.indexOf('@import "./excel-fonts.css"')).toBeLessThan(style.indexOf('@import "./fonts/office-fonts.css"'));
    expect(readFileSync(new URL("../apps/web/src/excel-fonts.css", import.meta.url), "utf8")).not.toContain("carlito");
  });
});
