import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { parseFile, serializeFile } from "../packages/core/src/index";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { embeddedWindowsLineGrids, windowsLineGrid } from "../packages/core/src/pptx-fonts";
import { officeSingleSpacing } from "../packages/core/src/office-fonts";
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

/** Version-1 EOT wrapper around an uncompressed TrueType payload. */
function embeddedOpenType(font: Uint8Array): Uint8Array {
  const body: number[] = [];
  const u16 = (n: number) => body.push(n & 255, (n >> 8) & 255);
  const u32 = (n: number) =>
    body.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
  u32(0);
  body.push(...new Uint8Array(10), 0, 0);
  u32(400);
  u16(0);
  u16(0x504c);
  body.push(...new Uint8Array(16 + 8 + 4 + 18));
  for (let i = 0; i < 4; i++) {
    u16(0);
    if (i < 3) u16(0);
  }
  const header = 12 + body.length;
  const out = new Uint8Array(header + font.length);
  const set32 = (at: number, n: number) => {
    out[at] = n & 255;
    out[at + 1] = (n >> 8) & 255;
    out[at + 2] = (n >> 16) & 255;
    out[at + 3] = (n >>> 24) & 255;
  };
  set32(0, out.length);
  set32(4, font.length);
  set32(8, 0x00010000);
  out.set(body, 12);
  out.set(font, header);
  return out;
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

  it("turns an Embedded OpenType part into TrueType", async () => {
    const ttf = fontBytes();
    ttf[20] = 0x11;
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:embeddedFontLst><p:embeddedFont><p:font typeface="Nunito"/><p:regular r:id="rId2"/></p:embeddedFont></p:embeddedFontLst></p:presentation>`,
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<Relationships>
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.fntdata"/>
      </Relationships>`,
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    zip.file("ppt/fonts/font1.fntdata", embeddedOpenType(ttf));
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    expect(parsed.content.fonts).toEqual([
      expect.objectContaining({ family: "Nunito", style: "normal", weight: 400 }),
    ]);
    expect(decode(parsed.content.fonts![0].data)).toEqual(ttf);
  });

  it("skips an Embedded OpenType part that does not decode", async () => {
    const broken = embeddedOpenType(fontBytes());
    broken[8] = 0xff;
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:embeddedFontLst><p:embeddedFont><p:font typeface="Nunito"/><p:regular r:id="rId2"/></p:embeddedFont></p:embeddedFontLst></p:presentation>`,
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<Relationships>
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.fntdata"/>
      </Relationships>`,
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    zip.file("ppt/fonts/font1.fntdata", broken);
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    expect(parsed.content.fonts).toBeUndefined();
  });

  it("skips a part that is not a font", async () => {
    const parsed = await deck(
      { [`ppt/fonts/${GUID}.fntdata`]: new Uint8Array(32).fill(7) },
      `<p:embeddedFontLst><p:embeddedFont><p:font typeface="Calibri"/><p:regular r:id="rId2"/></p:embeddedFont></p:embeddedFontLst>`,
    );
    expect(parsed.content.fonts).toBeUndefined();
  });
});

/** A tiny sfnt with head.unitsPerEm and OS/2 win ascent/descent. */
function measuredFace(units: number, ascent: number, descent: number): Uint8Array {
  const head = new Uint8Array(54);
  head[18] = (units >> 8) & 255;
  head[19] = units & 255;
  const os2 = new Uint8Array(86);
  os2[74] = (ascent >> 8) & 255;
  os2[75] = ascent & 255;
  os2[76] = (descent >> 8) & 255;
  os2[77] = descent & 255;
  const records = [
    { tag: "OS/2", data: os2 },
    { tag: "head", data: head },
  ];
  const header = 12 + records.length * 16;
  let cursor = header;
  const placed = records.map((record) => {
    const offset = cursor;
    cursor += record.data.length;
    return { ...record, offset };
  });
  const out = new Uint8Array(cursor);
  out[1] = 1;
  out[5] = records.length;
  let rec = 12;
  for (const record of placed) {
    for (let i = 0; i < 4; i++) out[rec + i] = record.tag.charCodeAt(i);
    out[rec + 8] = (record.offset >>> 24) & 255;
    out[rec + 9] = (record.offset >>> 16) & 255;
    out[rec + 10] = (record.offset >>> 8) & 255;
    out[rec + 11] = record.offset & 255;
    out[rec + 12] = (record.data.length >>> 24) & 255;
    out[rec + 13] = (record.data.length >>> 16) & 255;
    out[rec + 14] = (record.data.length >>> 8) & 255;
    out[rec + 15] = record.data.length & 255;
    out.set(record.data, record.offset);
    rec += 16;
  }
  return out;
}

describe("embedded font line grid", () => {
  it("reads the Windows grid and ignores a face that is not a font", () => {
    const lato = measuredFace(2000, 1974, 426);
    expect(windowsLineGrid(lato)).toBeCloseTo(1.2, 5);
    expect(windowsLineGrid(fontBytes())).toBeUndefined();
    expect(windowsLineGrid(measuredFace(2000, 10, 10))).toBeUndefined();
    // OS/2 is the first table. USE_TYPO_METRICS prefers the typographic grid
    // over a Windows descent that only exists to clip ink.
    const face = measuredFace(1000, 1000, 490);
    const os2 = 12 + 2 * 16;
    face[os2 + 62] = 0x00;
    face[os2 + 63] = 0x80;
    face[os2 + 68] = 0x03;
    face[os2 + 69] = 0xe8;
    face[os2 + 70] = 0xff;
    face[os2 + 71] = 0x06;
    expect(windowsLineGrid(face)).toBeCloseTo(1.25, 5);
    const noOs2 = measuredFace(2000, 1974, 426);
    noOs2[12] = "n".charCodeAt(0);
    expect(windowsLineGrid(noOs2)).toBeUndefined();
  });

  it("spaces an embedded face from its own grid and keeps a shipped face", async () => {
    const lato = measuredFace(2000, 1974, 426);
    const latoBold = measuredFace(1000, 800, 700);
    const arial = measuredFace(1000, 900, 600);
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
        <p:embeddedFontLst>
          <p:embeddedFont><p:font typeface="Lato"/><p:bold r:id="rId3"/><p:regular r:id="rId2"/></p:embeddedFont>
          <p:embeddedFont><p:font typeface="Arial"/><p:regular r:id="rId4"/></p:embeddedFont>
        </p:embeddedFontLst>
      </p:presentation>`,
    );
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<Relationships>
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/${GUID}.fntdata"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/lato-bold.fntdata"/>
        <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/arial.fntdata"/>
      </Relationships>`,
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="90000"/></a:lnSpc></a:pPr>
            <a:r><a:rPr sz="1800"><a:latin typeface="Lato"/></a:rPr><a:t>Ninety</a:t></a:r></a:p></p:txBody></p:sp>
        <p:sp><p:spPr><a:xfrm><a:off x="0" y="2000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:pPr>
            <a:r><a:rPr sz="1800"><a:latin typeface="Lato"/></a:rPr><a:t>Exact</a:t></a:r></a:p></p:txBody></p:sp>
        <p:sp><p:spPr><a:xfrm><a:off x="0" y="3000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
          <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
            <a:r><a:rPr sz="1800"><a:latin typeface="Arial"/></a:rPr><a:t>Shipped</a:t></a:r></a:p></p:txBody></p:sp>
      </p:spTree></p:cSld></p:sld>`,
    );
    zip.file(`ppt/fonts/${GUID}.fntdata`, obfuscate(lato));
    zip.file("ppt/fonts/lato-bold.fntdata", latoBold);
    zip.file("ppt/fonts/arial.fntdata", arial);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const grids = await embeddedWindowsLineGrids(await JSZip.loadAsync(bytes));
    expect(grids.get("Lato")).toBeCloseTo(1.2, 5);
    expect(grids.get("Arial")).toBeCloseTo(1.5, 5);
    expect(officeSingleSpacing("Lato", grids)).toBeCloseTo(1.2, 5);
    expect(officeSingleSpacing("Arial", grids)).toBeCloseTo(1.214, 4);
    const parsed = await parsePowerPoint(bytes);
    const texts = parsed.content.slides[parsed.content.slideOrder[0]].elements.filter(
      (el) => el.type === "text",
    );
    const byText = (needle: string) => texts.find((el) => el.content?.includes(needle));
    expect(byText("Ninety")?.lineHeight).toBeCloseTo(1.2 * 0.9, 5);
    expect(byText("Exact")?.lineHeight).toBeCloseTo(24 / 18, 5);
    expect(byText("Shipped")?.lineHeight).toBeCloseTo(1.214, 4);
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
