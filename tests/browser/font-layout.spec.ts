import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Layout HarfBuzz gives each SuiteLeaf face (scripts/fonts/suiteleaf_browser_fixture.py): the fonts are
// built and checked against Office with HarfBuzz, so the browser must lay them out as HarfBuzz does.
type Measure = [advance: number, control: number[] | null, ink: number[] | null];
type Face = {
  file: string;
  family: string;
  weight: number;
  style: string;
  upem: number;
  texts: [text: string, kerned: Measure, unkerned: Measure][];
};

const faces: Face[] = JSON.parse(
  readFileSync(new URL("../fixtures/font-layout.json", import.meta.url), "utf8"),
);
const PARTS = 6;

for (let part = 0; part < PARTS; part++) {
  test(`canvas text in SuiteLeaf faces matches HarfBuzz, part ${part + 1} of ${PARTS}`, async ({ page }) => {
    test.setTimeout(180_000);
    const mine = faces.filter((_, i) => i % PARTS === part);
    await page.goto("/");
    const failures = await page.evaluate(async (mine: Face[]) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      if (!("fontKerning" in ctx)) return ["canvas has no fontKerning"];
      const out: string[] = [];
      // A canvas pixel per font unit, or a power of two of them where Firefox caps the size at 2000px.
      // An engine may bound ink by outline points or by the curves, and on Linux it rounds the box
      // outward, to a 64th of the em or 32 pixels.
      const near = (got: number[], want: number[] | null, scale: number, grain: number) =>
        want !== null &&
        got.every((v, i) => {
          const outward = i < 2 ? want[i] - v : v - want[i];
          return outward >= -scale && outward <= grain + scale;
        });
      for (const face of mine) {
        const fontAt = (px: number) => `${face.style} ${face.weight} ${px}px "${face.family}"`;
        await document.fonts.load(fontAt(face.upem), face.texts.map(([text]) => text).join(""));
        if (!document.fonts.check(fontAt(face.upem))) {
          out.push(`${face.file}: not loaded`);
          continue;
        }
        // Where a full-size face measures short of twice its half size, the size was capped: a power
        // of two smaller is a whole number of pixels (Firefox rounds a fractional size). Elsewhere the
        // full size, since Chromium on Linux rounds each glyph's advance to a pixel.
        const [sample] = face.texts[0];
        const widthAt = (px: number) => ((ctx.font = fontAt(px)), ctx.measureText(sample).width);
        const capped = Math.abs(widthAt(face.upem) / widthAt(face.upem / 2) - 2) > 0.01;
        const scale = capped ? 2 ** Math.max(1, Math.ceil(Math.log2(face.upem / 2000))) : 1;
        const grain = Math.max(face.upem / 64, 32 * scale);
        ctx.font = fontAt(face.upem / scale);
        for (const [text, ...modes] of face.texts) {
          modes.forEach(([advance, control, ink], m) => {
            ctx.fontKerning = m === 0 ? "normal" : "none";
            const t = ctx.measureText(text);
            const width = t.width * scale;
            const box = [-t.actualBoundingBoxLeft, -t.actualBoundingBoxDescent, t.actualBoundingBoxRight, t.actualBoundingBoxAscent]
              .map((v) => v * scale);
            const blank = control === null;
            if (Math.abs(width - advance) > scale || (!blank && !near(box, control, scale, grain) && !near(box, ink, scale, grain))) {
              const codes = [...text].map((c) => c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");
              out.push(`${face.file} ${m === 0 ? "kerned" : "unkerned"} ${codes}: advance ${width.toFixed(1)} for ${advance}, ` +
                `box ${box.map((v) => Math.round(v)).join(",")} for ${control?.join(",")}`);
            }
          });
        }
      }
      return out;
    }, mine);
    expect(failures.slice(0, 20), `${failures.length} texts laid out differently`).toEqual([]);
  });
}
