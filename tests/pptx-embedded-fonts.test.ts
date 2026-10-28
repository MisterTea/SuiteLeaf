import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { parseFile, serializeFile } from "../packages/core/src/index";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { loadEmbeddedFonts } from "../apps/web/src/editors/slide-fonts";

const GUID = "00112233-4455-6677-8899-AABBCCDDEEFF";
/** Little-endian GUID bytes from ECMA-376 embedded-font obfuscation. */
const KEY = Uint8Array.from([
  0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
  0xdd, 0xee, 0xff,
]);

function obfuscate(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= KEY[i % 16];
  return out;
}

function fontBytes(): Uint8Array {
  const bytes = new Uint8Array(48);
  bytes[0] = 0;
  bytes[1] = 1;
  bytes[2] = 0;
  bytes[3] = 0;
  bytes[20] = 0xab;
  return bytes;
}

function decode(data: string): Uint8Array {
  const binary = atob(data.slice(data.indexOf(",") + 1));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deck(files: Record<string, Uint8Array>, fontsXml: string) {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/>${fontsXml}</p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships>
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/${GUID}.fntdata"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font-bold.fntdata"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  for (const [path, data] of Object.entries(files)) zip.file(path, data);
  return parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
}

describe("embedded PowerPoint fonts", () => {
  it("restores an obfuscated regular face and a plain bold face", async () => {
    const regular = fontBytes();
    const bold = fontBytes();
    bold[20] = 0xcd;
    const parsed = await deck(
      {
        [`ppt/fonts/${GUID}.fntdata`]: obfuscate(regular),
        "ppt/fonts/font-bold.fntdata": bold,
      },
      `<p:embeddedFontLst><p:embeddedFont><p:font typeface="Calibri"/><p:regular r:id="rId2"/><p:bold r:id="rId3"/></p:embeddedFont></p:embeddedFontLst>`,
    );
    expect(parsed.content.fonts).toEqual([
      expect.objectContaining({
        family: "Calibri",
        style: "normal",
        weight: 400,
      }),
      expect.objectContaining({
        family: "Calibri",
        style: "normal",
        weight: 700,
      }),
    ]);
    expect(decode(parsed.content.fonts![0].data)).toEqual(regular);
    expect(decode(parsed.content.fonts![1].data)).toEqual(bold);
    const saved = parseFile(serializeFile(parsed));
    expect(saved.kind === "slide" && saved.content.fonts).toHaveLength(2);
  });

  it("skips a part that is not a font", async () => {
    const parsed = await deck(
      { [`ppt/fonts/${GUID}.fntdata`]: new Uint8Array(32).fill(7) },
      `<p:embeddedFontLst><p:embeddedFont><p:font typeface="Calibri"/><p:regular r:id="rId2"/></p:embeddedFont></p:embeddedFontLst>`,
    );
    expect(parsed.content.fonts).toBeUndefined();
  });
});

describe("loading embedded fonts in the renderer", () => {
  it("registers each face with the document before paint", async () => {
    const added: Array<{ family: string; weight: string; style: string }> = [];
    class FakeFontFace {
      constructor(
        public family: string,
        public source: ArrayBuffer,
        public descriptors: { style: string; weight: string },
      ) {}
      load() {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace);
    vi.stubGlobal("document", {
      fonts: {
        add(face: FakeFontFace) {
          added.push({
            family: face.family,
            weight: face.descriptors.weight,
            style: face.descriptors.style,
          });
        },
        ready: Promise.resolve(),
      },
    });
    const data = `data:font/ttf;base64,${btoa("font")}`;
    await loadEmbeddedFonts([
      { family: "Calibri", style: "italic", weight: 700, data },
    ]);
    await loadEmbeddedFonts([
      { family: "Calibri", style: "italic", weight: 700, data },
    ]);
    expect(added).toEqual([
      { family: "Calibri", weight: "700", style: "italic" },
    ]);
    vi.unstubAllGlobals();
  });
});
