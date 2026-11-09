import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { SlideElement } from "../packages/core/src";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { assignPaintedShapeAnimations } from "../packages/core/src/pptx-slide-motion";
import { animationClicks } from "../packages/core/src/slide-motion";
import { showAudienceHooks } from "../apps/web/src/editors/slide-show-audience";

const geometry = `<a:xfrm><a:off x="100000" y="100000"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`;
const textBox = `<p:sp><p:nvSpPr><p:cNvPr id="5" name="Label"/></p:nvSpPr><p:spPr>${geometry}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Headline</a:t></a:r></a:p></p:txBody></p:sp>`;
const picture = `<p:pic><p:nvPicPr><p:cNvPr id="6" name="Clipping"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${geometry}</p:spPr></p:pic>`;
const effect = (id: string, exit = false, paragraph = false) =>
  `<p:par><p:cTn nodeType="clickEffect"${exit ? ' presetClass="exit"' : ""}><p:childTnLst><p:animEffect transition="${exit ? "out" : "in"}" filter="fade"><p:cBhvr><p:tgtEl><p:spTgt spid="${id}">${paragraph ? '<p:txEl><p:pRg st="0" end="0"/></p:txEl>' : ""}</p:spTgt></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;

async function importedSlide(shapes: string, timing: string) {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld><p:timing>${timing}</p:timing></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>');
  zip.file("ppt/media/image1.png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", { base64: true });
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  return file.content.slides[file.content.slideOrder[0]];
}

describe("animations on a shape's painted parts", () => {
  it("reveals each picture together with its backdrop and border on one click", async () => {
    const slide = await importedSlide(picture, effect("6"));
    expect(slide.elements.map((el) => el.type)).toEqual(["shape", "image", "shape"]);
    expect(slide.elements.every((el) => el.animation === "fade-on-click" && el.animationOrder === 1)).toBe(true);
    expect(animationClicks(slide.elements)).toHaveLength(1);
    for (const revealed of [0, 3, 0]) {
      const hooks = showAudienceHooks(slide, { slideIndex: 0, revealed, enteringId: null });
      for (const el of slide.elements)
        expect(hooks.box!(el).props?.["data-fade"]).toBe(revealed ? "visible" : "hidden");
    }
  });

  it("reveals and exits the text and artwork together without animating another shape", async () => {
    const staticBox = textBox.replace('id="5"', 'id="9"');
    const slide = await importedSlide(textBox + staticBox, effect("5") + effect("5", true));
    expect(slide.elements).toHaveLength(4);
    const animated = slide.elements.slice(0, 2);
    expect(animated.map((el) => el.type)).toEqual(["shape", "text"]);
    for (const el of animated) {
      expect(el).toMatchObject({ animation: "fade-on-click", animationOrder: 1, animationExit: { order: 2 } });
      expect(showAudienceHooks(slide, { slideIndex: 0, revealed: 4, enteringId: null }).box!(el).props?.["data-fade"]).toBe("hidden");
    }
    expect(slide.elements.slice(2).every((el) => !el.animation && !el.animationExit)).toBe(true);
    expect(animationClicks(slide.elements)).toHaveLength(2);
  });

  it("applies group animations to all parts while preserving a child's own entrance", async () => {
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10"/></p:nvGrpSpPr>${textBox}${picture}</p:grpSp>`;
    const slide = await importedSlide(group, effect("10") + effect("6") + effect("10", true));
    expect(slide.elements.filter((el) => el.type === "text")).toHaveLength(1);
    expect(slide.elements.every((el) => el.animation && el.animationExit?.order === 3)).toBe(true);
    expect(slide.elements.slice(0, 2).every((el) => el.animationOrder === 1)).toBe(true);
    expect(slide.elements.slice(2).every((el) => el.animationOrder === 2)).toBe(true);
  });

  it("assigns paragraph builds only to text, leaving the shape artwork visible", async () => {
    const slide = await importedSlide(textBox, effect("5", false, true));
    const text = slide.elements.find((el) => el.type === "text")!;
    const art = slide.elements.find((el) => el.type === "shape")!;
    expect(text.paragraphBuilds).toEqual([{ start: 0, end: 0, order: 1 }]);
    expect(art.paragraphBuilds).toBeUndefined();
    expect(art.animation).toBeUndefined();
    expect(animationClicks(slide.elements)).toHaveLength(1);
  });

  it("handles shapes without drawing-order metadata or a painted element", () => {
    const elements = [{ id: "text", type: "text" }] as SlideElement[];
    expect(assignPaintedShapeAnimations(`<p:timing>${effect("5")}</p:timing>`, elements, new Map([["5", 0], ["missing", 99]]), new Map())).toBe(1);
    expect(elements[0].animation).toBe("fade-on-click");
  });
});
