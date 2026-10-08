import { expect, it } from "vitest";
import JSZip from "jszip";
import { importOffice } from "../packages/core/src/office";

it("checks original XLSB expansion before the binary reader inflates it", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/workbook.bin", new Uint8Array(16));
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  // An adversarial central directory advertises an enormous binary workbook.
  // Reject the declared expansion before invoking the binary reader.
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
    if (name === "xl/workbook.bin") bytes.writeUInt32LE(0x40000001, offset + 24);
  }
  await expect(importOffice(bytes, "xlsb", "oversized.xlsb")).rejects.toMatchObject({
    code: "expanded-limit",
  });
});
