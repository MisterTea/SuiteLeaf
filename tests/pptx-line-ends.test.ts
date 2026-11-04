import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { lineMarkerEnds, readLineEnd } from "../packages/core/src/pptx-line-ends";
import { parsePowerPoint } from "../packages/core/src/pptx";

describe("connector ends", () => {
  it("puts an oval on the start and keeps a legacy arrow at the end", () => {
    expect(readLineEnd(`<a:ln><a:headEnd type="oval"/></a:ln>`, "head")).toBe("oval");
    expect(readLineEnd(`<a:ln><a:tailEnd type="triangle"/></a:ln>`, "tail")).toBe("triangle");
    expect(lineMarkerEnds({ shapeType: "line", lineHead: "oval" })).toEqual({ start: "oval" });
    expect(lineMarkerEnds({ shapeType: "arrow", lineTail: "triangle" })).toEqual({
      end: "triangle",
    });
    expect(lineMarkerEnds({ shapeType: "arrow" })).toEqual({ end: "triangle" });
    expect(lineMarkerEnds({ shapeType: "line", lineHead: "stealth" })).toEqual({
      start: "stealth",
    });
    expect(lineMarkerEnds({ shapeType: "line" })).toEqual({});
  });

  it("paints an elbow as its path and a dotted connector at the head", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/presentation.xml",
      `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree>
        <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Elbow"/></p:nvCxnSpPr>
          <p:spPr><a:xfrm rot="5400000"><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
            <a:prstGeom prst="bentConnector3"><a:avLst/></a:prstGeom>
            <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="oval"/></a:ln>
          </p:spPr>
        </p:cxnSp>
        <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Dot"/></p:nvCxnSpPr>
          <p:spPr><a:xfrm flipH="1"><a:off x="3000000" y="2000000"/><a:ext cx="1000000" cy="500000"/></a:xfrm>
            <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
            <a:ln w="12700"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:headEnd type="oval"/></a:ln>
          </p:spPr>
        </p:cxnSp>
      </p:spTree></p:cSld></p:sld>`,
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<Relationships><Relationship Id="l" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    );
    zip.file("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`);
    zip.file(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      `<Relationships><Relationship Id="m" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    );
    zip.file("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster><p:cSld><p:spTree/></p:cSld></p:sldMaster>`);
    zip.file(
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      `<Relationships><Relationship Id="t" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
    );
    zip.file(
      "ppt/theme/theme1.xml",
      `<a:theme><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const elements = parsed.content.slides[parsed.content.slideOrder[0]].elements;
    const elbow = elements.find((el) => el.type === "image");
    const dot = elements.find((el) => el.lineHead === "oval");
    expect(elbow?.type).toBe("image");
    expect(elbow?.rotation).toBe(90);
    const svg = Buffer.from((elbow?.src || "").split(",")[1] || "", "base64").toString("utf8");
    expect(svg).toContain("L ");
    expect(svg).toContain('stroke-linejoin="miter"');
    expect(svg).toContain('stroke-linecap="butt"');
    expect(dot).toMatchObject({ shapeType: "line", lineHead: "oval", flipH: true });
    expect(dot?.shapeType).not.toBe("arrow");
  });

  it("keeps the arrowhead on the start of a line shape", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Arrow"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="0"/></a:xfrm>
        <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="triangle"/></a:ln>
      </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const line = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.lineHead === "triangle" || el.shapeType === "arrow" || el.shapeType === "line",
    );
    expect(line).toMatchObject({ lineHead: "triangle" });
    expect(line?.lineTail).toBeUndefined();
    expect(lineMarkerEnds(line ?? {})).toEqual({ start: "triangle" });
  });

  it("keeps a large arrowhead size", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Arrow"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="0"/></a:xfrm>
        <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle" w="lg" len="lg"/></a:ln>
      </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const line = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.lineTail === "triangle",
    );
    expect(line?.lineTailSize).toBe("lg");
    expect(line?.lineHeadSize).toBeUndefined();
  });

  it("draws a large freeform arrowhead bigger than a normal one", async () => {
    const shape = (size: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Line"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="100000"/></a:xfrm>
        <a:custGeom><a:pathLst><a:path w="1000000" h="100000"><a:moveTo><a:pt x="0" y="50000"/></a:moveTo><a:lnTo><a:pt x="1000000" y="50000"/></a:lnTo></a:path></a:pathLst></a:custGeom>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="triangle"${size}/></a:ln>
      </p:spPr></p:sp>`;
    const spanOf = async (size: string) => {
      const one = new JSZip();
      one.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree>${shape(size)}</p:spTree></p:cSld></p:sld>`);
      const parsed = await parsePowerPoint(await one.generateAsync({ type: "uint8array" }));
      const line = parsed.content.slides[parsed.content.slideOrder[0]].elements.find((el) => el.type === "image");
      const svg = Buffer.from((line?.src || "").split(",")[1] || "", "base64").toString("utf8");
      expect(svg).not.toContain("marker");
      const head = /<path d="([^"]+)" fill="#000000"/.exec(svg)?.[1] || "";
      const nums = head.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
      const xs = nums.filter((_, index) => index % 2 === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    const medium = await spanOf("");
    const large = await spanOf(' w="lg" len="lg"');
    expect(large).toBeGreaterThan(medium * 1.4);
  });

  it("draws a triangle on the start of a bent connector", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree>
        <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Elbow"/></p:nvCxnSpPr>
          <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm>
            <a:prstGeom prst="bentConnector3"><a:avLst/></a:prstGeom>
            <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="triangle"/></a:ln>
          </p:spPr>
        </p:cxnSp>
      </p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const elbow = parsed.content.slides[parsed.content.slideOrder[0]].elements.find((el) => el.type === "image");
    const svg = Buffer.from((elbow?.src || "").split(",")[1] || "", "base64").toString("utf8");
    expect(svg.match(/<path /g)?.length).toBeGreaterThan(1);
  });

  it("draws a triangle on a freeform connector", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Line"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="100000"/></a:xfrm>
        <a:custGeom><a:pathLst><a:path w="1000000" h="100000"><a:moveTo><a:pt x="0" y="50000"/></a:moveTo><a:lnTo><a:pt x="1000000" y="50000"/></a:lnTo></a:path></a:pathLst></a:custGeom>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:headEnd type="triangle"/></a:ln>
      </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const line = parsed.content.slides[parsed.content.slideOrder[0]].elements.find((el) => el.type === "image");
    const svg = Buffer.from((line?.src || "").split(",")[1] || "", "base64").toString("utf8");
    expect(svg).not.toContain("marker");
    expect(svg).toMatch(/\bwidth="/);
    expect(svg).toMatch(/\bheight="/);
    const head = svg.match(/<path d="M [^"]+Z" fill="#000000"/);
    expect(head).toBeTruthy();
    const xs = [...(head?.[0].matchAll(/-?\d+(?:\.\d+)?/g) || [])].map((n) => Number(n[0]));
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeGreaterThan(20000);
    expect(span).toBeLessThan(80000);
    expect(svg).toContain('stroke-linecap="butt"');
    expect(svg).toContain('stroke-linejoin="miter"');
    expect(svg).toContain('stroke-miterlimit="8"');
  });

  it("rounds a freeform corner when the line asks for it", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Line"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="100000"/></a:xfrm>
        <a:custGeom><a:pathLst><a:path w="1000000" h="100000"><a:moveTo><a:pt x="0" y="50000"/></a:moveTo><a:lnTo><a:pt x="1000000" y="0"/></a:lnTo></a:path></a:pathLst></a:custGeom>
        <a:ln w="12700" cap="flat"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:round/></a:ln>
      </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const line = parsed.content.slides[parsed.content.slideOrder[0]].elements.find((el) => el.type === "image");
    const svg = Buffer.from((line?.src || "").split(",")[1] || "", "base64").toString("utf8");
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('stroke-linecap="butt"');
  });

  it("draws a flat freeform stroke as a line instead of a zero-height image", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Connection Line"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="371476" cy="0"/></a:xfrm>
        <a:custGeom><a:pathLst><a:path w="21600"><a:moveTo><a:pt x="21600" y="0"/></a:moveTo><a:cubicBezTo><a:pt x="14400" y="0"/><a:pt x="7200" y="0"/><a:pt x="0" y="0"/></a:cubicBezTo></a:path></a:pathLst></a:custGeom>
        <a:ln w="50800"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>
      </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const line = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
    expect(line?.type).toBe("shape");
    expect(line?.shapeType).toBe("arrow");
    expect(line?.lineTail).toBe("triangle");
    expect(line?.height).toBe(0);
    expect(line?.flipH).toBe(true);
  });

  it("draws a nearly vertical freeform stroke as a line", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Connection Line"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="10253" cy="766067"/></a:xfrm>
        <a:custGeom><a:pathLst><a:path w="21600" h="21600"><a:moveTo><a:pt x="21600" y="0"/></a:moveTo><a:lnTo><a:pt x="0" y="21600"/></a:lnTo></a:path></a:pathLst></a:custGeom>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>
      </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const line = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
    expect(line?.type).toBe("shape");
    expect(line?.shapeType).toBe("arrow");
    expect(line?.lineTail).toBe("triangle");
    expect(line?.width).toBeLessThan(2);
    expect(line?.flipV).toBeUndefined();
  });

  it("draws a corner-to-corner freeform as a line so the arrow stays the pen size", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="9" name="Connection Line"/></p:nvSpPr><p:spPr>
        <a:xfrm><a:off x="1467333" y="2698724"/><a:ext cx="1408734" cy="2370192"/></a:xfrm>
        <a:custGeom><a:pathLst><a:path w="21600" h="21600"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="21600" y="21600"/></a:lnTo></a:path></a:pathLst></a:custGeom>
        <a:ln w="57150"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:prstDash val="sysDot"/><a:tailEnd type="triangle"/></a:ln>
      </p:spPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const line = parsed.content.slides[parsed.content.slideOrder[0]].elements[0];
    expect(line?.type).toBe("shape");
    expect(line?.shapeType).toBe("arrow");
    expect(line?.lineTail).toBe("triangle");
    expect(line?.strokeStyle).toBe("sysDot");
    expect(line?.stroke).toBe("#C00000");
    expect(line?.flipH).toBeUndefined();
    expect(line?.flipV).toBeUndefined();
    expect(line?.width).toBeGreaterThan(50);
    expect(line?.height).toBeGreaterThan(50);
  });
});
