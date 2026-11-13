import JSZip from "jszip";
import { expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import {
  assignClickAnimations,
  readClickAnimations,
  stampSlideMotion,
} from "../packages/core/src/slide-motion";

it("exports edited durations, paragraph builds and exits as independent PowerPoint events", async () => {
  const deck = (createFile("slide") as SlideFile).content;
  const slide = deck.slides[deck.slideOrder[0]];
  slide.elements = [
    {
      id: "label",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      animation: "fly-on-click",
      animationDuration: 1700,
      animationOrder: 1,
      paragraphBuilds: [
        { start: 1, end: 2, order: 2, trigger: "after", kind: "zoom-on-click" },
      ],
      animationExit: { order: 3 },
    },
  ];
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="label"/></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sld>',
  );
  const output = await stampSlideMotion(
    await zip.generateAsync({ type: "uint8array" }),
    [slide],
  );
  const xml = await (
    await JSZip.loadAsync(output)
  )
    .file("ppt/slides/slide1.xml")!
    .async("string");
  const read = readClickAnimations(xml);
  expect(read).toHaveLength(3);
  expect(read[0]).toMatchObject({ kind: "fly-on-click", duration: 1700 });
  expect(read[1]).toMatchObject({
    paragraph: { start: 1, end: 2 },
    kind: "zoom-on-click",
    trigger: "after",
  });
  expect(read[2]).toMatchObject({ exit: true });
  const elements = [{ id: "reopened", type: "text" }] as typeof slide.elements;
  assignClickAnimations(xml, elements, new Map([["2", 0]]));
  expect(elements[0]).toMatchObject({
    animation: "fly-on-click",
    animationDuration: 1700,
    paragraphBuilds: [
      { start: 1, end: 2, order: 1, trigger: "after", kind: "zoom-on-click" },
    ],
    animationExit: { order: 2 },
  });
});
