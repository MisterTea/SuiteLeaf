import { expect, it } from "vitest";
import JSZip from "jszip";
import { parseFile, serializeFile } from "../packages/core/src/index";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const object = Buffer.concat([
  Buffer.from("d0cf11e0a1b11ae1", "hex"),
  Buffer.from("Think-cell editable source payload"),
]);
const frame =
  '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="think-cell Slide"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1905000" y="952500"/><a:ext cx="9525" cy="9525"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj name="think-cell Slide" r:id="object" progId="TCLayout.ActiveDocument.1"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="5" name="Preview"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="preview"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1905000" y="952500"/><a:ext cx="9525" cy="9525"/></a:xfrm></p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>';
const relations =
  '<Relationship Id="object" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="../embeddings/thinkcell.bin"/><Relationship Id="preview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/preview.png"/>';

it.each([false, true])(
  "preserves tiny native think-cell OLE payload and preview from inherited=%s",
  async (inherited) => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Default Extension="png" ContentType="image/png"/></Types>',
    );
    zip.file(
      "ppt/presentation.xml",
      '<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree>${inherited ? "" : frame}</p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships>${inherited ? '<Relationship Id="layout" Type="x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' : relations}</Relationships>`,
    );
    if (inherited) {
      zip.file(
        "ppt/slideLayouts/slideLayout1.xml",
        `<p:sldLayout><p:cSld><p:spTree>${frame}</p:spTree></p:cSld></p:sldLayout>`,
      );
      zip.file(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        `<Relationships>${relations}</Relationships>`,
      );
    }
    zip.file("ppt/embeddings/thinkcell.bin", object);
    zip.file("ppt/media/preview.png", png);
    const model = await parsePowerPoint(
      await zip.generateAsync({ type: "nodebuffer" }),
      "thinkcell.pptx",
    );
    const elements = model.content.slides[model.content.slideOrder[0]].elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: "image",
      x: 200,
      y: 100,
      width: 1,
      height: 1,
    });
    expect(elements[0].nativeDrawing).toBeDefined();
    expect(() => parseFile(serializeFile(model))).not.toThrow();
    const output = await JSZip.loadAsync(await exportPptx(model), {
      checkCRC32: true,
    });
    const blobs = await Promise.all(
      Object.keys(output.files)
        .filter(
          (name) =>
            !output.files[name].dir &&
            /^ppt\/(?:.*\/)?(?:media|embeddings)\//.test(name),
        )
        .map((name) => output.file(name)!.async("nodebuffer")),
    );
    expect(blobs.some((bytes) => bytes.equals(object))).toBe(true);
    expect(blobs.some((bytes) => bytes.equals(png))).toBe(true);
    expect(
      await output.file("ppt/slides/slide1.xml")!.async("string"),
    ).toContain("TCLayout.ActiveDocument.1");
  },
);
