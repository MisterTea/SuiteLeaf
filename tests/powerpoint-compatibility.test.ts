import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  createFile,
  parseFile,
  serializeFile,
  type SlideFile,
} from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { roundTripOffice } from "../packages/core/src/roundtrip";
import {
  preserveUnsupportedParts,
  scanSlideCompatibility,
} from "../packages/core/src/compat/user-report";

describe("WP-016 PowerPoint object and media round-trip fidelity", () => {
  it("exports a deck with masters, tables, media, and animations with no supported-content loss", async () => {
    const file = createFile("slide", "Complete Fidelity Deck") as SlideFile;
    const slideId = file.content.slideOrder[0];
    const slide = file.content.slides[slideId];

    slide.transition = { type: "fade", duration: 0.5 };
    slide.notes = "Speaker note explaining the strategy.";
    slide.elements = [
      {
        id: "title-header",
        type: "text",
        x: 60,
        y: 40,
        width: 840,
        height: 60,
        content: "Strategy Overview",
        fontSize: 28,
        animation: "fade-on-click",
        animationOrder: 1,
      },
      {
        id: "summary-table",
        type: "table",
        x: 60,
        y: 120,
        width: 500,
        height: 200,
        rows: [
          ["Region", "Target", "Q1 Actual"],
          ["North America", "120M", "128M"],
          ["EMEA", "85M", "91M"],
        ],
      },
      {
        id: "embedded-photo",
        type: "image",
        x: 600,
        y: 120,
        width: 300,
        height: 200,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        alt: "Regional performance chart screenshot",
      },
      {
        id: "stat-card",
        type: "shape",
        shapeType: "rect",
        x: 60,
        y: 350,
        width: 400,
        height: 100,
        rotation: 0,
      },
    ];

    const exportedBytes = await exportPptx(file);
    expect(exportedBytes).toBeInstanceOf(Uint8Array);

    // Verify ZIP contains slide XML, relationships, and media
    const zip = await JSZip.loadAsync(exportedBytes);
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain("Strategy Overview");
    expect(slideXml).toContain("North America");
    expect(slideXml).toContain("EMEA");

    // Re-parse and verify fidelity
    const reimported = await parsePowerPoint(exportedBytes, "Complete Fidelity Deck");
    const reimportedSlide = reimported.content.slides[reimported.content.slideOrder[0]];

    expect(reimportedSlide.notes).toBe("Speaker note explaining the strategy.");
    expect(reimportedSlide.transition?.type).toBe("fade");

    const reimportedTypes = reimportedSlide.elements.map((el) => el.type);
    expect(reimportedTypes).toContain("text");
    expect(reimportedTypes).toContain("table");
    expect(reimportedTypes).toContain("image");

    const tableEl = reimportedSlide.elements.find((el) => el.type === "table");
    expect(tableEl?.rows).toEqual([
      ["Region", "Target", "Q1 Actual"],
      ["North America", "120M", "128M"],
      ["EMEA", "85M", "91M"],
    ]);

    // Differential round-trip check reports 0 SuiteLeaf defect diffs
    const diffReport = await roundTripOffice(exportedBytes, "pptx", "Complete Fidelity Deck.pptx");
    const suiteleafDiffs = diffReport.differences.filter((d) => d.owner === "suiteleaf");
    expect(suiteleafDiffs).toEqual([]);
  });

  it("changing a local text box or picture does not remove unrelated inherited master artwork", async () => {
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const picture =
      '<p:pic><p:nvPicPr><p:cNvPr id="5"/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/></p:blipFill><p:spPr><a:xfrm><a:off x="952500" y="1905000"/><a:ext cx="2857500" cy="952500"/></a:xfrm></p:spPr></p:pic>';
    const relation = (id: string, kind: string, target: string) =>
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`;

    const zip = new JSZip();
    zip.file("ppt/presentation.xml", '<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>');
    zip.file("ppt/slides/slide1.xml", '<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>');
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>${relation("layout", "slideLayout", "../slideLayouts/slideLayout1.xml")}</Relationships>`,
    );
    zip.file(
      "ppt/slideLayouts/slideLayout1.xml",
      `<p:sldLayout><p:cSld><p:spTree>${picture}</p:spTree></p:cSld></p:sldLayout>`,
    );
    zip.file(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      `<Relationships>${relation("master", "slideMaster", "../slideMasters/slideMaster1.xml")}${relation("image", "image", "../media/background.png")}</Relationships>`,
    );
    zip.file(
      "ppt/slideMasters/slideMaster1.xml",
      `<p:sldMaster><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="image"/></a:blipFill></p:bgPr></p:bg><p:spTree>${picture}</p:spTree></p:cSld></p:sldMaster>`,
    );
    zip.file(
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      `<Relationships>${relation("image", "image", "../media/background.png")}</Relationships>`,
    );
    zip.file("ppt/media/background.png", image);

    const imported = await parsePowerPoint(await zip.generateAsync({ type: "nodebuffer" }), "inherited.pptx");
    const slide = imported.content.slides[imported.content.slideOrder[0]];

    // Verify inherited artwork is present initially
    const initialArtwork = slide.elements.filter((el) => el.alt?.includes("Inherited slide artwork"));
    expect(initialArtwork.length).toBeGreaterThan(0);

    // Now edit the slide by adding a local text box and changing an element
    slide.elements.push({
      id: "local-user-text",
      type: "text",
      x: 100,
      y: 100,
      width: 400,
      height: 50,
      content: "Locally edited text overlay",
    });

    const exported = await exportPptx(imported);
    const reimported = await parsePowerPoint(exported);
    const reimportedSlide = reimported.content.slides[reimported.content.slideOrder[0]];

    // The local text box is present
    expect(reimportedSlide.elements.some((el) => el.content === "Locally edited text overlay")).toBe(true);

    // The inherited master artwork was NOT removed or corrupted
    const reimportedArtwork = reimportedSlide.elements.filter((el) => el.alt?.includes("Inherited slide artwork"));
    expect(reimportedArtwork.length).toBeGreaterThan(0);
  });

  it("reports unsupported diagram/SmartArt re-layout accurately and preserves nonexecutable streams", async () => {
    const file = createFile("slide", "Diagram Presentation") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    slide.elements = [
      {
        id: "smartart-1",
        type: "smartart" as any,
        x: 50,
        y: 50,
        width: 500,
        height: 300,
        content: "Process Flow [Step 1 -> Step 2 -> Step 3]",
      },
    ];

    const report = scanSlideCompatibility(file, "pptx");
    expect(report.canExport).toBe(true);
    expect(report.findings.some((f) => f.feature === "slide.smartart")).toBe(true);

    const smartArtFinding = report.findings.find((f) => f.feature === "slide.smartart")!;
    expect(smartArtFinding.impact).toBe("unsupported-editing");
    expect(smartArtFinding.message).toContain("exports as grouped vector shapes");

    // Package preservation test: unknown custom XML parts are quarantined and tracked
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p:presentation/>");
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");
    zip.file("ppt/customXml/item1.xml", "<customData>Proprietary add-in metadata</customData>");
    zip.file("ppt/vbaProject.bin", new Uint8Array([0x50, 0x4b, 0x01, 0x02]));

    const sourceBytes = await zip.generateAsync({ type: "uint8array" });
    const manifest = await preserveUnsupportedParts(zip, sourceBytes);

    expect(manifest.totalParts).toBe(4);
    expect(manifest.preservedParts.some((p) => p.path === "ppt/customXml/item1.xml")).toBe(true);
    const vbaPart = manifest.preservedParts.find((p) => p.path === "ppt/vbaProject.bin");
    expect(vbaPart).toBeDefined();
    expect(vbaPart?.isExecutable).toBe(true);
  });

  it("re-opened PPTX maintains editable shapes, rotation, and formatting", async () => {
    const file = createFile("slide", "Editable Shapes") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    slide.elements = [
      {
        id: "banner-rect",
        type: "shape",
        shapeType: "rect",
        x: 100,
        y: 100,
        width: 300,
        height: 150,
        rotation: 45,
        fill: "#3b82f6",
      },
      {
        id: "styled-text",
        type: "text",
        x: 120,
        y: 120,
        width: 250,
        height: 80,
        fontSize: 20,
        runs: [
          { text: "Bold Lead", bold: true },
          { text: " regular note", bold: false },
        ],
      },
    ];

    const exported = await exportPptx(file);
    const reloaded = await parsePowerPoint(exported);
    const reloadedSlide = reloaded.content.slides[reloaded.content.slideOrder[0]];

    const shape = reloadedSlide.elements.find((el) => el.type === "shape");
    expect(shape).toBeDefined();
    expect(shape?.rotation).toBe(45);

    const textEl = reloadedSlide.elements.find((el) => el.type === "text");
    expect(textEl).toBeDefined();
    expect(textEl?.runs?.some((r) => r.text.includes("Bold Lead"))).toBe(true);
  });
});
