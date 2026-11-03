import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { animationClicks, animationSequence, readClickAnimations, readSlideMotion, shapeGroupAncestors, stampSlideMotion } from "../packages/core/src/slide-motion";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { transitionMs } from "../apps/web/src/editors/slide-theme";
import type { Slide } from "../packages/core/src";
import { fadeOnClickIds, hiddenParagraphIndexes, exitConcealed } from "../apps/web/src/editors/slide-fade-in";

describe("animation click order", () => {
  it("uses the same order for the slideshow and the exported sequence", () => {
    const elements = [
      { id: "title", animation: "fade-on-click" },
      { id: "photo", animation: "fly-on-click", animationOrder: 0 },
      { id: "note" },
    ];
    const sequence = animationSequence(elements);
    expect(sequence.map((item) => item.id)).toEqual(["photo", "title"]);
    expect(fadeOnClickIds(elements)).toEqual(["photo", "title"]);
    expect(elements[0].id).toBe("title");
    expect(elements[2].animation).toBeUndefined();
  });

  it("plays two objects on one click and writes the second with the previous one", async () => {
    const elements = [
      { id: "title", animation: "fade-on-click", animationOrder: 1 },
      { id: "photo", animation: "fly-on-click", animationOrder: 1 },
      { id: "note" },
    ];
    expect(animationClicks(elements)).toEqual([{ ids: ["title", "photo"], order: 1 }]);
    expect(fadeOnClickIds(elements)).toEqual(["title", "photo"]);
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3"/></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const slide = { elements } as Slide;
    const stamped = await stampSlideMotion(await zip.generateAsync({ type: "uint8array" }), [slide]);
    const xml = await JSZip.loadAsync(stamped).then((out) => out.file("ppt/slides/slide1.xml")!.async("string"));
    expect(xml.match(/nodeType="clickEffect"/g)).toHaveLength(1);
    expect(xml.match(/nodeType="withEffect"/g)).toHaveLength(1);
    expect(readClickAnimations(xml).map((item) => item.order)).toEqual([1, 1]);
    expect(xml).not.toContain("secret-value");
    expect(elements[2].id).toBe("note");
  });

  it("writes an object that starts after the previous one", async () => {
    const elements = [
      { id: "title", animation: "fade-on-click", animationOrder: 1 },
      { id: "photo", animation: "fly-on-click", animationOrder: 2, animationTrigger: "after" as const },
      { id: "note" },
    ];
    expect(animationClicks(elements)).toEqual([{ ids: ["title", "photo"], order: 1 }]);
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3"/></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    const stamped = await stampSlideMotion(await zip.generateAsync({ type: "uint8array" }), [
      { elements } as Slide,
    ]);
    const xml = await JSZip.loadAsync(stamped).then((out) => out.file("ppt/slides/slide1.xml")!.async("string"));
    expect(xml.match(/nodeType="clickEffect"/g)).toHaveLength(1);
    expect(xml.match(/nodeType="afterEffect"/g)).toHaveLength(1);
    expect(xml).not.toContain("secret-value");
    const read = readClickAnimations(xml);
    expect(read.map((item) => item.trigger)).toEqual(["click", "after"]);
    expect(read.map((item) => item.order)).toEqual([1, 1]);
  });

  it("treats a PowerPoint cut as instant and writes that cut back", async () => {
    const read = readSlideMotion(
      '<p:sld><p:transition spd="slow"><p:cut/></p:transition></p:sld>',
    );
    expect(read.transition?.type).toBe("none");
    expect(read.transition?.office).toBe("<p:cut/>");
    expect(transitionMs(read.transition, false)).toBe(0);
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "<p:sld></p:sld>");
    const stamped = await stampSlideMotion(await zip.generateAsync({ type: "uint8array" }), [
      { elements: [], transition: read.transition } as Slide,
    ]);
    const xml = await JSZip.loadAsync(stamped).then((out) =>
      out.file("ppt/slides/slide1.xml")!.async("string"),
    );
    expect(xml).toContain("<p:cut/>");
  });

  it("gives a group's click entrance to the shapes inside it", async () => {
    const box = (id: string, label: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${label}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="800000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${label}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const click = (spid: string) =>
      `<p:par><p:cTn nodeType="clickEffect"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>`;
    const xml = `<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Pair"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>
        ${box("5", "Stem")}${box("6", "Leaf")}
      </p:grpSp>
      <p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Outer"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>
        ${box("13", "Outer")}
        <p:grpSp><p:nvGrpSpPr><p:cNvPr id="11" name="Inner"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="1000000"/></a:xfrm></p:grpSpPr>
          ${box("12", "Nest")}
        </p:grpSp>
      </p:grpSp>
    </p:spTree></p:cSld><p:timing>${click("4")}${click("6")}${click("10")}${click("11")}</p:timing></p:sld>`;
    expect(shapeGroupAncestors(xml).get("12")).toEqual(["11", "10"]);
    expect(shapeGroupAncestors(xml).has("4")).toBe(false);
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", xml);
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const slide = parsed.content.slides[parsed.content.slideOrder[0]];
    const named = (label: string) => slide.elements.find((el) => el.content === label);
    expect(named("Stem")).toMatchObject({ animation: "appear-on-click", animationOrder: 1 });
    expect(named("Leaf")).toMatchObject({ animation: "appear-on-click", animationOrder: 2 });
    expect(named("Outer")).toMatchObject({ animation: "appear-on-click", animationOrder: 3 });
    expect(named("Nest")).toMatchObject({ animation: "appear-on-click", animationOrder: 4 });
    expect(named("Leaf")?.animationTrigger).toBeUndefined();
  });

  it("lets a with-previous step at the start of the slide stay visible", () => {
    const clicks = readClickAnimations(`<p:timing>
      <p:par><p:cTn nodeType="withEffect"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="5"><p:txEl><p:pRg st="0" end="0"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
      <p:par><p:cTn nodeType="clickEffect"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="5"><p:txEl><p:pRg st="2" end="2"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
    </p:timing>`);
    expect(clicks.map((item) => [item.paragraph?.start, item.order, item.trigger])).toEqual([
      [0, 0, "with"],
      [2, 1, "click"],
    ]);
  });

  it("keeps each paragraph of a text box on its own click", async () => {
    const timing = `<p:timing>
      <p:par><p:cTn nodeType="clickEffect"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="5"><p:txEl><p:pRg st="1" end="1"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
      <p:par><p:cTn nodeType="withEffect"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="5"><p:txEl><p:pRg st="2" end="2"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
      <p:par><p:cTn nodeType="clickEffect"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="5"><p:txEl><p:pRg st="3" end="3"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
    </p:timing>`;
    const clicks = readClickAnimations(timing);
    expect(clicks.map((item) => item.paragraph?.start)).toEqual([1, 2, 3]);
    expect(clicks.map((item) => item.order)).toEqual([1, 1, 2]);
    expect(clicks.map((item) => item.trigger)).toEqual(["click", "with", "click"]);
    const box = (id: string, text: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Body"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p><a:p><a:r><a:t>One</a:t></a:r></a:p><a:p><a:r><a:t>Two</a:t></a:r></a:p><a:p><a:r><a:t>Three</a:t></a:r></a:p></p:txBody></p:sp>`;
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree>${box("5", "Title")}</p:spTree></p:cSld>${timing}</p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const text = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.content?.includes("Title"),
    );
    expect(text?.animation).toBeUndefined();
    expect(text?.paragraphBuilds).toEqual([
      { start: 1, end: 1, order: 1 },
      { start: 2, end: 2, order: 1, trigger: "with" },
      { start: 3, end: 3, order: 2 },
    ]);
    const sequence = animationSequence([text!]);
    expect(fadeOnClickIds([text!])).toEqual([text!.id, text!.id, text!.id]);
    expect(animationClicks([text!])).toHaveLength(2);
    expect(hiddenParagraphIndexes(text!, sequence, 0)).toEqual([1, 2, 3]);
    expect(hiddenParagraphIndexes(text!, sequence, 2)).toEqual([3]);
    expect(hiddenParagraphIndexes(text!, sequence, 3)).toEqual([]);
  });

  it("hides a shape on an exit click instead of waiting to appear", async () => {
    const timing = `<p:timing><p:par><p:cTn presetClass="exit" nodeType="clickEffect"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="5"/></p:tgtEl></p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:timing>`;
    const read = readClickAnimations(timing);
    expect(read).toMatchObject([{ spid: "5", exit: true, order: 1, trigger: "click" }]);
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="5" name="Gone"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="800000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Gone</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>${timing}</p:sld>`,
    );
    const parsed = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const text = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
      (el) => el.content === "Gone",
    );
    expect(text?.animation).toBeUndefined();
    expect(text?.animationExit).toEqual({ order: 1 });
    const sequence = animationSequence([text!]);
    expect(fadeOnClickIds([text!])).toEqual([text!.id]);
    expect(exitConcealed(text!.id, sequence, 0)).toBe(false);
    expect(exitConcealed(text!.id, sequence, 1)).toBe(true);
  });
});
