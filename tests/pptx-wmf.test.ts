import { expect, it } from "vitest";
import JSZip from "jszip";
import { parseFile, serializeFile } from "../packages/core/src/index";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

it.each([false, true])(
  "preserves native Windows metafile bytes with placeable header=%s",
  async (placeable) => {
    const offset = placeable ? 22 : 0;
    const bytes = Buffer.alloc(offset + 24);
    if (placeable) bytes.set([0xd7, 0xcd, 0xc6, 0x9a]);
    bytes.set([1, 0, 9, 0, 0, 3], offset);
    bytes.writeUInt32LE(12, offset + 6);
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><p:pic><p:nvPicPr><p:cNvPr id="2"/></p:nvPicPr><p:blipFill><a:blip r:embed="picture"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm></p:spPr></p:pic></p:sld>',
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      '<Relationships><Relationship Id="picture" Type="x/image" Target="../media/native.wmf"/></Relationships>',
    );
    zip.file("ppt/media/native.wmf", bytes);
    const imported = await parsePowerPoint(
      await zip.generateAsync({ type: "nodebuffer" }),
      "native.pptx",
    );
    expect(() => parseFile(serializeFile(imported))).not.toThrow();
    const element =
      imported.content.slides[imported.content.slideOrder[0]].elements[0];
    expect(element.src).toBe(
      `data:image/wmf;base64,${bytes.toString("base64")}`,
    );
    const output = await JSZip.loadAsync(await exportPptx(imported), {
      checkCRC32: true,
    });
    const media = Object.keys(output.files).filter(
      (name) => name.startsWith("ppt/media/") && !output.files[name].dir,
    );
    const data = await Promise.all(
      media.map((name) => output.file(name)!.async("nodebuffer")),
    );
    expect(data.some((value) => value.equals(bytes))).toBe(true);
    expect(await output.file("[Content_Types].xml")!.async("string")).toMatch(
      /Extension="wmf" ContentType="image\/(?:x-)?wmf"/,
    );
  },
);
