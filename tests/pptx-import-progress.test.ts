import { expect, it } from "vitest";
import JSZip from "jszip";
import { openOfficeFile } from "../packages/core/src/open-office";

it("reports completed slides through the Office import entry point", async () => {
  const zip = new JSZip();
  for (let i = 1; i <= 3; i++) {
    zip.file(`ppt/slides/slide${i}.xml`,
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Slide ${i}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  }
  const progress: number[][] = [];
  const file = await openOfficeFile(await zip.generateAsync({ type: "uint8array" }), "pptx", "Lecture.pptx", {
    onProgress: (completed, total) => progress.push([completed, total]),
  });
  expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  expect(file.kind).toBe("slide");
  if (file.kind === "slide") expect(file.content.slideOrder).toHaveLength(3);
});
