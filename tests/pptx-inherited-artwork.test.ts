import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const picture =
  '<p:pic><p:nvPicPr><p:cNvPr id="5"/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/></p:blipFill><p:spPr><a:xfrm><a:off x="952500" y="1905000"/><a:ext cx="2857500" cy="952500"/></a:xfrm></p:spPr></p:pic>';
const relation = (id: string, kind: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`;
async function fixture(
  options: {
    hiddenMaster?: boolean;
    localBackground?: boolean;
    layoutArtwork?: boolean;
  } = {},
) {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    '<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld${options.hiddenMaster ? ' showMasterSp="0"' : ""}><p:cSld>${options.localBackground ? '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:bgPr></p:bg>' : ""}<p:spTree/></p:cSld></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships>${relation("layout", "slideLayout", "../slideLayouts/slideLayout1.xml")}</Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout><p:cSld><p:spTree>${options.layoutArtwork ? picture + picture.replace('<p:cNvPr id="5"/>', '<p:cNvPr id="6"/><p:nvPr><p:ph type="pic"/></p:nvPr>') : ""}</p:spTree></p:cSld></p:sldLayout>`,
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
  return parsePowerPoint(
    await zip.generateAsync({ type: "nodebuffer" }),
    "inherited.pptx",
  );
}

describe("inherited PowerPoint artwork", () => {
  it("preserves master background and artwork behind local slide content through export", async () => {
    const parsed = await fixture();
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.elements).toMatchObject([
      {
        type: "image",
        x: 0,
        y: 0,
        width: 960,
        height: 720,
        alt: "Slide background",
      },
      {
        type: "image",
        x: 100,
        y: 200,
        width: 300,
        height: 100,
        alt: "Inherited slide artwork",
      },
    ]);
    const output = await JSZip.loadAsync(await exportPptx(parsed));
    const media = Object.keys(output.files).filter(
      (p) => p.startsWith("ppt/media/") && !output.files[p].dir,
    );
    expect(media.length).toBeGreaterThan(0);
    expect(await output.file(media[0])!.async("nodebuffer")).toEqual(image);
  });
  it("hides layout artwork when the slide hides background graphics", async () => {
    const parsed = await fixture({
      hiddenMaster: true,
      localBackground: true,
      layoutArtwork: true,
    });
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.background?.color).toBe("#FF0000");
    expect(slide.elements).toHaveLength(0);
  });
  it("honors a nearer solid background and hidden master artwork", async () => {
    const parsed = await fixture({ hiddenMaster: true, localBackground: true });
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.background?.color).toBe("#FF0000");
    expect(slide.elements).toHaveLength(0);
  });
  it("keeps a later layout shape above a picture and scales a grouped picture", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      '<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>${relation("layout", "slideLayout", "../slideLayouts/slideLayout1.xml")}</Relationships>`,
    );
    const card = `<p:sp><p:nvSpPr><p:cNvPr id="7" name="Card"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
    const grouped = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="914400" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="1828800"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="9"/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="1828800"/></a:xfrm></p:spPr></p:pic></p:grpSp>`;
    zip.file(
      "ppt/slideLayouts/slideLayout1.xml",
      `<p:sldLayout><p:cSld><p:spTree>${picture}${card}${grouped}</p:spTree></p:cSld></p:sldLayout>`,
    );
    zip.file(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      `<Relationships>${relation("master", "slideMaster", "../slideMasters/slideMaster1.xml")}${relation("image", "image", "../media/background.png")}</Relationships>`,
    );
    zip.file(
      "ppt/slideMasters/slideMaster1.xml",
      `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`,
    );
    zip.file("ppt/media/background.png", image);
    const parsed = await parsePowerPoint(
      await zip.generateAsync({ type: "nodebuffer" }),
      "layered.pptx",
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    expect(slide.elements.map((el) => el.type)).toEqual(["image", "shape", "image"]);
    expect(slide.elements[1]?.fill).toBe("rgba(255, 255, 255, 0.5)");
    expect(slide.elements[2]).toMatchObject({ x: 96, y: 0, width: 96, height: 96 });
  });

  it("keeps a layout picture's rotation", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      '<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
    );
    zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>`);
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>${relation("layout", "slideLayout", "../slideLayouts/slideLayout1.xml")}</Relationships>`,
    );
    const turned = picture.replace(
      "<a:xfrm>",
      '<a:xfrm rot="10800000">',
    );
    zip.file(
      "ppt/slideLayouts/slideLayout1.xml",
      `<p:sldLayout><p:cSld><p:spTree>${turned}</p:spTree></p:cSld></p:sldLayout>`,
    );
    zip.file(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      `<Relationships>${relation("master", "slideMaster", "../slideMasters/slideMaster1.xml")}${relation("image", "image", "../media/background.png")}</Relationships>`,
    );
    zip.file(
      "ppt/slideMasters/slideMaster1.xml",
      `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`,
    );
    zip.file("ppt/media/background.png", image);
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const photo = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
    expect(photo?.rotation).toBe(180);
  });
});
