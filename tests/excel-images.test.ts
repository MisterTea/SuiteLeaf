import { inflate } from "pako";
import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { importOffice } from "../packages/core/src/office";
import JSZip from "jszip";
import { rasterEmf, textBoxSource } from "../packages/core/src/excel-images";
import { parseFile } from "../packages/core/src/index";

const fixturePath =
  "datasets/apache-poi/files/test-data/spreadsheet/45540_form_Footer.xlsx";

test.skipIf(!existsSync(fixturePath))(
  "imports original JPEG and inert VML raster appearances with precise sheet anchors",
  async () => {
    const bytes = new Uint8Array(await readFile(fixturePath));
    const result = await importOffice(bytes, "xlsx", "45540_form_Footer.xlsx");
    if (result.file.kind !== "sheet") throw Error("sheet expected");
    expect(result.file.content.images).toHaveLength(41);
    const logo = result.file.content.images!.find((x) =>
      x.src.startsWith("data:image/jpeg"),
    )!;
    expect(logo.src).toMatch(/^data:image\/jpeg;base64,/);
    expect(logo.offsetX).toBe(6);
    expect(logo.offsetY).toBe(5);
    expect(logo.width).toBe(193);
    expect(
      result.file.content
        .images!.filter((x) => x !== logo)
        .every((x) => x.src.startsWith("data:image/png;base64,")),
    ).toBe(true);
    expect(parseFile(JSON.stringify(result.file)).kind).toBe("sheet");
    expect(result.file.content.workbook.styles["excel-17"]).toBeDefined();
  },
);

test.skipIf(!existsSync(fixturePath))(
  "rejects unknown EMF drawing records and invalid bitmap bounds instead of discarding content",
  async () => {
    const zip = await JSZip.loadAsync(await readFile(fixturePath));
    const emf = await zip.file("xl/media/image2.emf")!.async("uint8array");
    expect(rasterEmf(emf)).toMatch(/^data:image\/png;base64,/);
    const unknown = emf.slice();
    new DataView(unknown.buffer).setUint32(108, 43, true);
    expect(rasterEmf(unknown)).toBeUndefined();
    const invalid = emf.slice();
    new DataView(invalid.buffer).setUint32(1308 + 48, 0xfffffff0, true);
    expect(rasterEmf(invalid)).toBeUndefined();
  },
);

test("EMF preview keeps its bitmap face opaque without masking cells outside it", async () => {
  const zip = await JSZip.loadAsync(
    await readFile(
      "datasets/apache-poi/files/test-data/spreadsheet/45540_form_Footer.xlsx",
    ),
  );
  const src = rasterEmf(
    await zip.file("xl/media/image2.emf")!.async("uint8array"),
  )!;
  const png = Buffer.from(src.split(",")[1], "base64"),
    width = png.readUInt32BE(16);
  const parts: Uint8Array[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      parts.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const pixels = inflate(Buffer.concat(parts)),
    stride = width * 4 + 1;
  expect(pixels[1 + 3]).toBe(0);
  expect(pixels[5 * stride + 1 + 4 + 3]).toBe(255);
});

test("text-box appearances preserve run formatting and escape source markup", () => {
  const src = textBoxSource(
    {
      txBody: {
        p: {
          pPr: { "@_algn": "ctr" },
          r: {
            rPr: { "@_sz": "1400", "@_b": "1", "@_u": "sng" },
            t: '<script> & "quoted"',
          },
        },
      },
    },
    400,
    100,
  )!;
  const svg = Buffer.from(src.split(",")[1], "base64").toString();
  expect(svg).toContain("&lt;script&gt; &amp; &quot;quoted&quot;");
  expect(svg).toContain('text-anchor="middle"');
  expect(svg).toContain('font-weight="bold"');
  expect(svg).toContain('text-decoration="underline"');
  expect(svg).not.toContain("<script>");
});
