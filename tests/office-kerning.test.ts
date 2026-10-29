import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile, fontKerning, kernFeature, kerningThreshold, type DocFile, type SlideElement } from "../packages/core/src";
import { documentHtml, documentPageSettings } from "../packages/core/src/document-layout";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";
import { moveKerningToBoxes, runKern } from "../packages/core/src/pptx-kerning";
import { wordKerning } from "../packages/core/src/word-kerning";
import { runsToHtml, textInnerHtml } from "../apps/web/src/editors/slide-runs";
import { wordDocument } from "./word-margin-fixtures";

const STYLES = (inner: string) =>
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${inner}</w:styles>`;
const DEFAULTS_1PT = `<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault></w:docDefaults>`;

describe("kerning threshold", () => {
  it("kerns only at or above a positive size", () => {
    expect(fontKerning(12, 12)).toBe("normal");
    expect(fontKerning(12, 11.5)).toBe("none");
    expect(fontKerning(0, 40)).toBe("none");
    expect(fontKerning(undefined, 40)).toBe("none");
  });

  it("turns the kern feature off wherever text is not kerned", () => {
    expect(kernFeature(12, 12)).toBe("normal");
    expect(kernFeature(12, 11.5)).toBe('"kern" 0');
    expect(kernFeature(undefined, 40)).toBe('"kern" 0');
  });

  it("stores only finite positive sizes", () => {
    expect(kerningThreshold(1)).toBe(1);
    expect(kerningThreshold(9000)).toBe(4000);
    expect(kerningThreshold(-2)).toBe(0);
    expect(kerningThreshold("12")).toBe(0);
    expect(kerningThreshold(Number.NaN)).toBe(0);
  });
});

describe("Word kerning", () => {
  it("reads the document defaults, in half-points", () => {
    expect(wordKerning(STYLES(DEFAULTS_1PT))).toBe(1);
  });

  it("lets the default paragraph style override the document defaults", () => {
    const normal = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:kern w:val="28"/></w:rPr></w:style>`;
    expect(wordKerning(STYLES(DEFAULTS_1PT + normal))).toBe(14);
  });

  it("is absent when neither sets it", () => {
    const normal = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:sz w:val="22"/></w:rPr></w:style>`;
    expect(wordKerning(STYLES(normal))).toBeUndefined();
    expect(wordKerning("")).toBeUndefined();
  });

  async function kernedDocx(styles: string) {
    const zip = await JSZip.loadAsync(await wordDocument({ paragraphs: [{ text: "AVATAR Wolf" }] }));
    zip.file("word/styles.xml", styles);
    return zip.generateAsync({ type: "uint8array" });
  }

  it("imports Word 365's 1pt kerning and writes it back", async () => {
    const { file } = await importOffice(await kernedDocx(STYLES(DEFAULTS_1PT)), "docx", "Kerned.docx");
    if (file.kind !== "doc") throw new Error("expected a document");
    const settings = documentPageSettings(file.content);
    expect(settings.kern).toBe(1);
    expect(documentHtml("Kerned", "<p>AV</p>", settings)).toContain("font-kerning: normal");

    const out = await JSZip.loadAsync(await exportDocx(file));
    const styles = await out.file("word/styles.xml")!.async("string");
    expect(styles).toMatch(/<w:rPrDefault>[\s\S]*<w:kern w:val="2"\/>/);
  });

  it("leaves a document without w:kern unkerned", async () => {
    const { file } = await importOffice(await kernedDocx(STYLES("")), "docx", "Plain.docx");
    if (file.kind !== "doc") throw new Error("expected a document");
    const settings = documentPageSettings(file.content);
    expect(settings.kern).toBe(0);
    expect(documentHtml("Plain", "<p>AV</p>", settings)).toContain("font-kerning: none");

    const out = await JSZip.loadAsync(await exportDocx(createFile("doc", "New") as DocFile));
    expect(await out.file("word/styles.xml")!.async("string")).not.toContain("<w:kern");
  });
});

describe("PowerPoint kerning", () => {
  const slideXml = (rPr: string, size = "1800") =>
    `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="${size}" ${rPr}/><a:t>AVATAR</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`;

  async function deck(xml: string) {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", xml);
    return parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  }
  const firstBox = (file: Awaited<ReturnType<typeof deck>>) =>
    file.content.slides[file.content.slideOrder[0]].elements[0];

  it("moves a run's kern onto its box and keeps it through export", async () => {
    const file = await deck(slideXml('kern="1200"'));
    const box = firstBox(file);
    expect(box.kern).toBe(12);
    expect(box.runs?.every((run) => run.kern === undefined)).toBe(true);

    const bytes = await exportPptx(file);
    const xml = await (await JSZip.loadAsync(bytes)).file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain('kern="1200"');
    expect(xml).not.toContain("SuiteLeaf kern");
    expect(firstBox(await parsePowerPoint(bytes)).kern).toBe(12);
  });

  it("treats kern=0 and a missing kern as never kerning", async () => {
    expect(firstBox(await deck(slideXml('kern="0"'))).kern).toBeUndefined();
    const plain = await deck(slideXml(""));
    expect(firstBox(plain).kern).toBeUndefined();
    const xml = await (await JSZip.loadAsync(await exportPptx(plain))).file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).not.toContain("kern=");
  });

  it("parses kern sizes and skips runs without text", () => {
    expect(runKern("1200")).toBe(12);
    expect(runKern(undefined)).toBeUndefined();
    expect(runKern("x")).toBeUndefined();
    const els = [
      { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, runs: [{ text: "• " }, { text: " ", kern: 20 }, { text: "Hi", kern: 14 }] },
      { id: "b", type: "table", x: 0, y: 0, width: 1, height: 1, runs: [{ text: "Cell", kern: 9 }] },
    ] as SlideElement[];
    moveKerningToBoxes(els);
    expect(els[0].kern).toBe(14);
    expect(els[1].kern).toBeUndefined();
    expect(els.flatMap((el) => el.runs ?? []).some((run) => run.kern !== undefined)).toBe(false);
  });

  it("gives a sized run its own kerning against the box threshold", () => {
    const html = runsToHtml([{ text: "Big", fontSize: 24 }, { text: "small", fontSize: 10 }, { text: "plain" }], 12);
    expect(html).toContain("font-kerning:normal");
    expect(html).toContain("font-kerning:none");
    expect(runsToHtml([{ text: "Big", fontSize: 24 }])).not.toContain("font-kerning");
    expect(textInnerHtml({ runs: [{ text: "Big", fontSize: 24 }], kern: 12 })).toContain("font-kerning:normal");
  });
});
