import { expect, it } from "vitest";
import JSZip from "jszip";
import { parsePowerPoint } from "../packages/core/src/pptx";

it("keeps a section numeral at its stored display size", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:spTree>
      <p:sp><p:spPr><a:xfrm><a:off x="100000" y="-300000"/><a:ext cx="2700000" cy="6200000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr wrap="none"><a:spAutoFit/></a:bodyPr><a:lstStyle/>
      <a:p><a:r><a:rPr sz="40000"><a:solidFill><a:srgbClr val="2E8857"/></a:solidFill></a:rPr><a:t>4</a:t></a:r></a:p>
      </p:txBody></p:sp>
      <p:sp><p:spPr><a:xfrm><a:off x="4500000" y="-1400000"/><a:ext cx="4600000" cy="9000000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr><a:spAutoFit/></a:bodyPr><a:lstStyle/>
      <a:p><a:r><a:rPr sz="60000"/><a:t>?</a:t></a:r></a:p>
      </p:txBody></p:sp>
    </p:spTree></p:sld>`,
  );
  const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
  const [numeral, mark] = file.content.slides[file.content.slideOrder[0]].elements;
  expect(numeral.content).toBe("4");
  expect(numeral.fontSize).toBe(400);
  expect(numeral.runs?.[0]?.fontSize).toBe(400);
  expect(mark.content).toBe("?");
  expect(mark.fontSize).toBe(600);
});
