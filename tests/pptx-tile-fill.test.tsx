// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { applyBlipLuminance, imageDpi, pictureTile, pictureTileSource, rasterPixels } from "../packages/core/src/pptx-pictures";
import { TiledPictureFill } from "../apps/web/src/editors/slide-tiled-picture";

afterEach(cleanup);

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

it("reads a PNG pixel size for a tile", () => {
  expect(rasterPixels(png(352, 208))).toEqual({ width: 352, height: 208 });
  expect(rasterPixels(Uint8Array.from([0, 1, 2]))).toBeUndefined();
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x11, 0x00,
  ]);
  expect(rasterPixels(jpeg)).toEqual({ width: 32, height: 16 });
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02, 0x00, 0x03, 0x00]);
  expect(rasterPixels(gif)).toEqual({ width: 2, height: 3 });
});

it("repeats a picture fill at its stored scale instead of stretching it", () => {
  const xml = `<a:blipFill dpi="0"><a:blip r:embed="rId2"/><a:tile tx="0" ty="-762000" sx="92000" sy="89000" flip="xy" algn="ctr"/></a:blipFill>`;
  const box = { width: 800, height: 300 };
  const slide = { width: 960, emuWidth: 12192000 };
  const tile = pictureTile(xml, png(352, 208), box, slide);
  expect(tile?.flip).toBe("xy");
  // 352px at 96dpi is 3.667in, times 92%, on a 13.333in slide drawn at 960.
  const tileW = ((352 / 96) * 914400 * 0.92 / 12192000) * 960;
  expect(tile?.width).toBeCloseTo(tileW, 4);
  expect(tile?.x).toBeCloseTo(0.5 * (box.width - tileW), 4);
  expect(tile?.y).toBeCloseTo(0.5 * (box.height - (tile?.height ?? 0)) + ((-762000 / 12192000) * 960), 4);
  expect(pictureTile("<a:stretch/>", png(8, 8), box, slide)).toBeUndefined();
});

it("keeps grain when brightness would otherwise clamp a texture to white", () => {
  const mild = `<a:blip><a:lum bright="-5000" contrast="55000"/></a:blip>`;
  const mildSvg = Buffer.from(applyBlipLuminance("data:image/png;base64,AAAA", mild)!.split(",")[1], "base64").toString("utf8");
  expect(mildSvg).toContain('slope="2.2222"');
  expect(mildSvg).toContain('intercept="-0.6611"');
  const blown = `<a:blip><a:lum bright="70000" contrast="-70000"/></a:blip>`;
  const svg = Buffer.from(applyBlipLuminance("data:image/png;base64,AAAA", blown)!.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain('slope="0.09"');
  expect(svg).toContain('intercept="0.805"');
  const black = `<a:blip><a:lum bright="-90000" contrast="-50000"/></a:blip>`;
  const dark = Buffer.from(applyBlipLuminance("data:image/png;base64,AAAA", black)!.split(",")[1], "base64").toString("utf8");
  expect(dark).not.toContain('intercept="-');
  expect(dark).toContain('slope="0.05"');
});

it("sizes a tile from the JPEG resolution when the fill omits dpi", () => {
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01,
    0x00, 0x4b, 0x00, 0x4b, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x80, 0x00, 0x80,
  ]);
  expect(imageDpi(jpeg)).toEqual({ x: 75, y: 75 });
  expect(imageDpi(png(8, 8))).toBeUndefined();
  const box = { width: 800, height: 600 };
  const slide = { width: 960, emuWidth: 12192000 };
  const xml = `<a:blipFill><a:blip r:embed="rId2"/><a:tile tx="0" ty="0" sx="100000" sy="100000" algn="tl"/></a:blipFill>`;
  const tile = pictureTile(xml, jpeg, box, slide);
  const tileW = ((128 / 75) * 914400 / 12192000) * 960;
  expect(tile?.width).toBeCloseTo(tileW, 4);
  expect(tile?.height).toBeCloseTo(tileW, 4);
});

it("paints a tiled fill as a repeating pattern", () => {
  const view = render(
    <TiledPictureFill
      src="data:image/png;base64,AAAA"
      tile={{ width: 40, height: 20, x: 4, y: -6, flip: "xy" }}
      shape={{ width: 200, height: 100 }}
      label="Grain"
    />,
  );
  const pattern = view.container.querySelector("pattern");
  expect(pattern?.getAttribute("width")).toBe("40");
  expect(pattern?.getAttribute("x")).toBe("4");
  expect(view.container.querySelector("image")?.getAttribute("transform")).toBe(
    "translate(40 20) scale(-1 -1)",
  );
  expect(view.getByRole("img", { name: "Grain" })).toBeTruthy();
});

it("gives each tiled fill its own pattern, even when the label matches", () => {
  const props = {
    src: "data:image/png;base64,AAAA",
    tile: { width: 40, height: 20, x: 0, y: 0 },
    shape: { width: 200, height: 100 },
    label: "Slide background",
  };
  const view = render(
    <>
      <TiledPictureFill {...props} />
      <TiledPictureFill {...props} src="data:image/png;base64,BBBB" />
    </>,
  );
  const patterns = [...view.container.querySelectorAll("pattern")];
  expect(patterns).toHaveLength(2);
  expect(patterns[0].id).not.toBe(patterns[1].id);
  const fills = [...view.container.querySelectorAll("rect")].map((rect) => rect.getAttribute("fill"));
  expect(fills).toEqual([`url(#${patterns[0].id})`, `url(#${patterns[1].id})`]);
});

it("keeps a stretched picture cropped when the shape fill is tiled", () => {
  const xml = `<p:pic><p:blipFill><a:blip r:embed="rId3"/><a:srcRect l="24762" t="15359" r="57456" b="30095"/><a:stretch/></p:blipFill><p:spPr><a:blipFill><a:blip r:embed="rId4"/><a:tile tx="0" ty="0" sx="100000" sy="100000" algn="tl"/></a:blipFill></p:spPr></p:pic>`;
  const box = { width: 260, height: 350 };
  const slide = { width: 960, emuWidth: 12192000 };
  expect(pictureTile(pictureTileSource(xml), png(3840, 1080), box, slide)).toBeUndefined();
  const shape = `<p:spPr><a:blipFill><a:blip r:embed="rId4"/><a:tile tx="0" ty="0" sx="100000" sy="100000" algn="tl"/></a:blipFill></p:spPr>`;
  expect(pictureTile(pictureTileSource(shape), png(128, 128), box, slide)?.width).toBeGreaterThan(0);
});
