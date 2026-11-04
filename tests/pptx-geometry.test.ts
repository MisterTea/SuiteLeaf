import { describe, expect, it } from "vitest";
import { shapeArtwork } from "../packages/core/src/pptx-geometry";
import { svgFillMarkup } from "../packages/core/src/pptx-theme";
import { lineTextBox, presetTextBox, presetVector } from "../packages/core/src/pptx-preset-geometry";
import type { ShapePaint } from "../packages/core/src/pptx-theme";
import { deck, svg } from "./pptx-geometry-fixtures";

describe("PowerPoint geometry", () => {
  it("draws preset outlines that are not rectangles", () => {
    const paint: ShapePaint = { fill: "#90c226", stroke: "#000000", strokeEmu: 9525 };
    const box = { x: 0, y: 0, width: 100, height: 80 };
    const slide = { width: 960, emuWidth: 12192000 };
    const shape = (name: string) =>
      shapeArtwork(
        `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="${name}"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
        paint,
        box,
        slide,
      );
    for (const name of [
      "chevron",
      "homePlate",
      "parallelogram",
      "diamond",
      "rightArrow",
      "leftArrow",
      "curvedLeftArrow",
      "curvedRightArrow",
      "bentUpArrow",
      "upDownArrow",
      "donut",
      "cube",
      "flowChartDecision",
      "star7",
      "round2SameRect",
      "mathMultiply",
      "funnel",
      "leftRightArrowCallout",
      "leftArrowCallout", "rightArrowCallout", "upArrowCallout", "downArrowCallout", "bentArrow", "quadArrow",
      "swooshArrow",
      "curvedUpArrow",
      "curvedDownArrow",
      "uturnArrow",
    ]) {
      const art = shape(name);
      expect(art?.type, name).toBe("image");
      expect(svg(art?.src), name).toContain("<path");
    }
    expect(svg(shape("star7")?.src).match(/L /g)?.length).toBeGreaterThan(8);
    expect(svg(shape("round2SameRect")?.src)).toContain("A ");
    const multiply = svg(shape("mathMultiply")?.src);
    expect(multiply.replace(/<path[^>]*non-scaling-stroke[^>]*\/>/g, "").match(/Z/g)?.length).toBe(2);
    // The 1px copy is the same outline, so a thin pen never disappears.
    expect(multiply).toContain('vector-effect="non-scaling-stroke"');
    expect(svg(shape("funnel")?.src)).toContain("A ");
    expect(svg(shape("leftRightArrowCallout")?.src).match(/L /g)?.length).toBeGreaterThan(10);
    expect(svg(shape("bentArrow")?.src)).toContain("A ");
    const calloutText = presetTextBox(
      `<p:sp><a:prstGeom prst="rightArrowCallout"><a:avLst/></a:prstGeom></p:sp>`,
      { x: 0, y: 0, width: 200, height: 80 },
    );
    expect(calloutText && calloutText.width).toBeLessThan(160);
    const swoosh = svg(shape("swooshArrow")?.src);
    expect(swoosh).toContain("Q ");
    expect(swoosh).toContain("M 0 1000000");
    expect(swoosh).not.toContain("M 0 0 L 2000000 0");
    expect(svg(shape("curvedUpArrow")?.src)).toContain("A ");
    expect(svg(shape("uturnArrow")?.src)).toContain("A ");
    const turned = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="674797" cy="6598750"/></a:xfrm><a:prstGeom prst="round2SameRect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
      paint,
      box,
      slide,
    );
    expect(turned?.rotation).toBe(90);
    const unknown = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm rot="5400000"><a:off x="0" y="0"/><a:ext cx="1000" cy="4000"/></a:xfrm><a:prstGeom prst="notAShape"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
      paint,
      box,
      slide,
    );
    expect(unknown).toMatchObject({ type: "shape", shapeType: "rect", rotation: 90 });
    const skewed = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="parallelogram"><a:avLst><a:gd fmla="val 79312" name="adj"/></a:avLst></a:prstGeom></p:spPr></p:sp>`,
      paint,
      box,
      slide,
    );
    expect(svg(skewed?.src)).toContain("M 39.66 0");
    expect(svg(skewed?.src)).toContain('stroke-width="0.75"');
    expect(svg(shape("donut")?.src)).toContain("evenodd");
    const line = shapeArtwork(
      `<p:cxnSp><p:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="9525"><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`,
      paint,
      box,
      slide,
    );
    expect(line).toMatchObject({ type: "shape", shapeType: "arrow", flipH: true, rotation: 90 });
  });

  it("keeps a roundRect corner radius from the adjust, including fmla before name", () => {
    const paint: ShapePaint = { fill: "#92D050" };
    const box = { x: 10, y: 20, width: 200, height: 80 };
    const slide = { width: 960, emuWidth: 12192000 };
    const art = (av: string) =>
      shapeArtwork(
        `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst>${av}</a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="92D050"/></a:solidFill></p:spPr></p:sp>`,
        paint,
        box,
        slide,
      );
    expect(art(`<a:gd name="adj" fmla="val 50000"/>`)).toMatchObject({
      type: "shape",
      shapeType: "roundRect",
      radius: 40,
    });
    expect(art(`<a:gd fmla="val 50000" name="adj"/>`)).toMatchObject({ radius: 40 });
    expect(art("")).toMatchObject({ shapeType: "roundRect", radius: (80 * 16667) / 100000 });
    expect(art(`<a:gd name="adj" fmla="val 0"/>`)).toMatchObject({ shapeType: "rect" });
    expect(art(`<a:gd name="adj" fmla="val 0"/>`)?.radius).toBeUndefined();
    const diag = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="800000"/></a:xfrm><a:prstGeom prst="round2DiagRect"><a:avLst><a:gd name="adj1" fmla="val 16667"/><a:gd name="adj2" fmla="val 0"/></a:avLst></a:prstGeom></p:spPr></p:sp>`,
      paint,
      box,
      slide,
    );
    expect(diag?.type).toBe("image");
    expect(svg(diag?.src)).toContain("A ");
  });

  it("draws a cloud callout with its tail and keeps a large top inset off the other edges", async () => {
    const paint: ShapePaint = { fill: "#f4c430", stroke: "#000000", strokeEmu: 12700 };
    const box = { x: 40, y: 30, width: 200, height: 140 };
    const cloud = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2736304" cy="2553147"/></a:xfrm>
        <a:prstGeom prst="cloudCallout"><a:avLst><a:gd name="adj1" fmla="val 0"/><a:gd name="adj2" fmla="val 150000"/></a:avLst></a:prstGeom>
        <a:solidFill><a:srgbClr val="F4C430"/></a:solidFill></p:spPr></p:sp>`,
      paint,
      box,
      { width: 960, emuWidth: 12192000 },
    );
    expect(cloud?.type).toBe("image");
    const markup = svg(cloud?.src);
    expect(markup.match(/<path /g)?.length).toBeGreaterThan(2);
    expect(markup).toContain(" A ");
    expect((cloud?.y ?? 0) + (cloud?.height ?? 0)).toBeGreaterThan(box.y + box.height);

    const parsed = await deck(
      `<p:sld><p:cSld><p:spTree>
        <p:sp><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="5B9BD5"/></a:solidFill></p:spPr>
          <p:txBody><a:bodyPr tIns="2560320" bIns="45720" lIns="91440" rIns="91440" anchor="ctr"/><a:lstStyle/>
            <a:p><a:r><a:rPr sz="1800"/><a:t>Inset</a:t></a:r></a:p></p:txBody></p:sp>
        <p:sp><p:spPr><a:xfrm><a:off x="500000" y="400000"/><a:ext cx="3000000" cy="1800000"/></a:xfrm>
          <a:prstGeom prst="bentConnector3"><a:avLst><a:gd name="adj1" fmla="val 50000"/></a:avLst></a:prstGeom>
          <a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp>
      </p:spTree></p:cSld></p:sld>`,
      `<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>`,
    );
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const text = slide.elements.find((el) => el.content === "Inset");
    expect(text?.inset).toBeGreaterThan(200);
    expect(text?.padBottom).toBeCloseTo((45720 / 12192000) * 960, 3);
    expect(text?.padRight).toBeUndefined();
    const bend = slide.elements.find((el) => el.alt === "Slide shape");
    expect(bend?.type).toBe("image");
    expect(svg(bend?.src)).toContain("L ");
    expect(svg(bend?.src)).not.toContain('fill="#');
  });

  it("keeps an oval callout on the ellipse", () => {
    const w = 400;
    const h = 200;
    const drawn = presetVector(
      "wedgeEllipseCallout",
      `<a:prstGeom prst="wedgeEllipseCallout"><a:avLst/></a:prstGeom>`,
      w,
      h,
      "#78bcd0",
      "#245a78",
      20,
    );
    const path = svg(drawn?.src);
    const arc = /A [\d.]+ [\d.]+ 0 \d \d ([\d.-]+) ([\d.-]+)/.exec(path);
    expect(arc).toBeTruthy();
    const ex = Number(arc?.[1]);
    const ey = Number(arc?.[2]);
    const nx = (ex - w / 2) / (w / 2);
    const ny = (ey - h / 2) / (h / 2);
    expect(nx * nx + ny * ny).toBeCloseTo(1, 2);
    expect(path).toContain('fill="#78bcd0"');
    const sized = presetVector(
      "wedgeEllipseCallout",
      `<a:prstGeom prst="wedgeEllipseCallout"><a:avLst/></a:prstGeom>`,
      4_000_000,
      2_000_000,
      "#78bcd0",
      "none",
      0,
      { x: 200 / 4_000_000, y: 100 / 2_000_000 },
    );
    const sizedSvg = svg(sized?.src);
    expect(sizedSvg).toContain('width="200"');
    expect(sizedSvg).toContain('height="125"');
    const large = presetVector(
      "wedgeEllipseCallout",
      `<a:prstGeom prst="wedgeEllipseCallout"><a:avLst/></a:prstGeom>`,
      4_000_000,
      2_000_000,
      "linear-gradient(0deg, #69c1ec 0%, #bbe5ff 100%)",
      "#245a78",
      9525,
    );
    const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg(large?.src));
    expect(Number(view?.[1])).toBeLessThanOrEqual(1024);
    expect(Number(view?.[2])).toBeLessThanOrEqual(1024);
  });

  it("rotates a pie wedge about the shape center", () => {
    const box = { x: 40, y: 30, width: 160, height: 150 };
    const art = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm rot="10379217"><a:off x="0" y="0"/><a:ext cx="2123110" cy="2114565"/></a:xfrm>
        <a:prstGeom prst="pie"><a:avLst><a:gd name="adj1" fmla="val 3691650"/><a:gd name="adj2" fmla="val 14119269"/></a:avLst></a:prstGeom>
        <a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="65000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>`,
      { fill: "rgba(255,255,255,0.65)" },
      box,
      { width: 960, emuWidth: 12192000 },
    );
    expect(art?.type).toBe("image");
    expect(art!.x + art!.width / 2).toBeCloseTo(box.x + box.width / 2, 3);
    expect(art!.y + art!.height / 2).toBeCloseTo(box.y + box.height / 2, 3);
    expect(art?.rotation).toBeCloseTo(10379217 / 60000, 3);
    expect(svg(art?.src)).toContain("A ");
  });

  it("paints a pie wedge as a quarter disk with the apex at the bottom-right", () => {
    const xml = `<p:sp><p:spPr><a:prstGeom prst="pieWedge"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="CCFF99"/></a:solidFill></p:spPr></p:sp>`;
    const drawn = presetVector("pieWedge", xml, 200, 200, "#CCFF99", "none", 0);
    const path = svg(drawn?.src);
    expect(path).toContain("M 0 200");
    expect(path).toContain("A 200 200");
    expect(path).toContain("L 200 200");
    expect(path).not.toContain("M 0 0");
    const box = { x: 10, y: 20, width: 100, height: 100 };
    const text = presetTextBox(xml, box);
    expect(text && text.x).toBeGreaterThan(box.x + 20);
    expect(text && text.y).toBeGreaterThan(box.y + 20);
    expect(text && text.x + text.width).toBeCloseTo(box.x + box.width, 3);
    const art = shapeArtwork(xml, { fill: "#CCFF99" }, box, { width: 960, emuWidth: 9144000 });
    expect(art?.type).toBe("image");
    expect(art?.shapeType).toBeUndefined();
  });

  it("lays a line's words out from the frame's top-left point", () => {
    const line = `<p:sp><a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:sp>`;
    const box = { x: 60, y: 150, width: 100, height: 100 };
    expect(lineTextBox(line, box, "center", "middle")).toEqual({ x: 10, y: 100, width: 100, height: 100 });
    expect(lineTextBox(line, box, "left", undefined)).toEqual(box);
    expect(lineTextBox(line, box, "right", "bottom")).toEqual({ x: -40, y: 50, width: 100, height: 100 });
    expect(lineTextBox(`<p:sp><a:prstGeom prst="rect"/></p:sp>`, box, "center", "middle")).toBeUndefined();
  });

  it("insets cloud-callout text and draws the callout bubbles", () => {
    const xml = `<p:sp><a:prstGeom prst="cloudCallout"><a:avLst><a:gd name="adj1" fmla="val 0"/><a:gd name="adj2" fmla="val 150000"/></a:avLst></a:prstGeom></p:sp>`;
    const box = { x: 10, y: 20, width: 200, height: 120 };
    const text = presetTextBox(xml, box);
    expect(text && text.width).toBeLessThan(box.width);
    expect(text && text.x).toBeGreaterThan(box.x);
    expect(presetTextBox(`<p:sp><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:sp>`, box)).toBeUndefined();
    const drawn = presetVector("cloudCallout", xml, 400, 240, "#ffc000", "#000000", 0);
    expect(drawn?.src.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(svg(drawn?.src)).toContain("A ");
    expect(presetVector("notAShape", xml, 10, 10, "#000", "none", 0)).toBeUndefined();
    const curve = presetVector(
      "curvedConnector3",
      `<a:prstGeom prst="curvedConnector3"><a:avLst/></a:prstGeom>`,
      300,
      80,
      "none",
      "#1217E4",
      12700,
    );
    expect(svg(curve?.src)).toContain("C ");
    expect(svg(curve?.src)).toContain('fill="none"');
  });

  it("paints a triangle at the end of a stroked arc", () => {
    const drawn = presetVector(
      "arc",
      `<a:prstGeom prst="arc"><a:avLst><a:gd name="adj1" fmla="val 16200000"/><a:gd name="adj2" fmla="val 3080415"/></a:avLst></a:prstGeom><a:ln><a:tailEnd type="triangle" w="med" len="med"/></a:ln>`,
      954156,
      817924,
      "none",
      "#ff0000",
      57150,
    );
    const xml = svg(drawn?.src);
    expect(xml).toContain('fill="#ff0000"');
    expect(xml).toMatch(/<path d="M [^"]*Z" fill="#ff0000"/);
  });

  it("measures a frame from the transform when an extension list comes first", () => {
    const art = shapeArtwork(
      `<p:sp><p:nvSpPr><p:cNvPr id="10" name="Rahmen"><a:extLst><a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"/></a:extLst></p:cNvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="2490951" y="2806262"/><a:ext cx="788276" cy="346842"/></a:xfrm>
          <a:prstGeom prst="frame"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
          <a:ln><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr></p:sp>`,
      { fill: "#FF0000", stroke: "#FF0000", strokeEmu: 12700 },
      { x: 196, y: 294, width: 62, height: 27 },
      { width: 960, emuWidth: 12192000 },
    );
    expect(art?.type).toBe("image");
    expect(art!.width).toBeLessThan(120);
    expect(art!.x).toBeGreaterThan(100);
    const view = /viewBox="0 0 ([0-9.]+)/.exec(svg(art?.src));
    expect(Number(view?.[1])).toBeGreaterThan(700000);
  });

  it("paints a preset gradient as SVG instead of a black CSS fill", () => {
    const fill = "linear-gradient(45deg, rgba(10, 20, 30, 0.06) 0%, #0070c0 100%)";
    const markup = svgFillMarkup(fill);
    expect(markup.value).toBe("url(#sl-fill)");
    expect(markup.defs).toContain("stop-opacity=\"0.06\"");
    expect(markup.defs).toContain("stop-color=\"#0070c0\"");
    const art = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5904656" cy="1872208"/></a:xfrm><a:prstGeom prst="snip2DiagRect"><a:avLst/></a:prstGeom></p:spPr></p:sp>`,
      { fill, stroke: "#1f4e79", strokeEmu: 12700 },
      { x: 10, y: 20, width: 400, height: 120 },
      { width: 960, emuWidth: 12192000 },
    );
    expect(art?.type).toBe("image");
    const svg = Buffer.from(String(art?.src).split(",")[1] || "", "base64").toString("utf8");
    expect(svg).toContain("<linearGradient");
    expect(svg).not.toContain("linear-gradient(");
  });

  it("scales a grouped preset stroke into the shape's own coordinates", () => {
    const art = shapeArtwork(
      `<p:sp><p:spPr><a:xfrm><a:off x="576" y="2256"/><a:ext cx="192" cy="912"/></a:xfrm>
        <a:prstGeom prst="rightBrace"><a:avLst/></a:prstGeom>
        <a:noFill/><a:ln w="28575"><a:solidFill><a:srgbClr val="009900"/></a:solidFill></a:ln></p:spPr></p:sp>`,
      { stroke: "#009900", strokeEmu: 28575 },
      { x: 72, y: 282, width: 32, height: 152 },
      { width: 960, emuWidth: 9144000 },
    );
    expect(art?.type).toBe("image");
    expect(art!.width).toBeLessThan(80);
    expect(art!.height).toBeLessThan(200);
    const svgText = svg(art?.src);
    const width = Number(/stroke="#009900" stroke-width="([0-9.]+)"/.exec(svgText)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(40);
  });
});
