import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";

it("preserves mixed text styles, hard breaks, and supplementary numeric characters", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr b="1" u="sng"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Bold</a:t></a:r><a:br/><a:r><a:rPr b="0" u="none"/><a:t>Plain &#x1F600; &#128512;</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>`,
  );
  const first = await parsePowerPoint(
    await zip.generateAsync({ type: "uint8array" }),
  );
  const element = first.content.slides[first.content.slideOrder[0]].elements[0];
  expect(element.content).toBe("Bold\nPlain 😀 😀");
  expect(element.runs).toEqual([
    {
      text: "Bold",
      bold: true,
      italic: false,
      underline: true,
      color: "#FF0000",
    },
    { text: "\n" },
    { text: "Plain 😀 😀", bold: false, italic: false, underline: false },
  ]);
  const second = await parsePowerPoint(await exportPptx(first));
  const output =
    second.content.slides[second.content.slideOrder[0]].elements[0];
  expect(output.content).toBe(element.content);
  const plain = output.runs?.find((run) => run.text.startsWith("Plain"));
  expect(plain?.bold).toBe(false);
  expect(plain?.underline).toBe(false);
});
