import { expect, it } from "vitest";
import {
  applyBlipLuminance,
  biLevelSvg,
  blipBiLevel,
} from "../packages/core/src/pptx-pictures";

it("turns a picture black and white at the DrawingML biLevel threshold", () => {
  const xml = `<a:blip r:embed="rId2"><a:biLevel thresh="75000"/></a:blip>`;
  expect(blipBiLevel(xml)).toBe(0.75);
  expect(blipBiLevel("<a:biLevel/>")).toBe(0.5);
  expect(blipBiLevel(`<a:biLevel thresh=""/>`)).toBe(0.5);
  expect(blipBiLevel(`<a:biLevel thresh="nope"/>`)).toBeUndefined();
  expect(blipBiLevel(`<a:biLevel thresh="-10"/>`)).toBe(0);
  expect(blipBiLevel(`<a:biLevel thresh="200000"/>`)).toBe(1);
  expect(blipBiLevel(`<a:lum bright="1000"/>`)).toBeUndefined();
  expect(applyBlipLuminance(undefined, xml)).toBeUndefined();
  expect(applyBlipLuminance("data:image/png;base64,AAAA", `<a:biLevel thresh="nope"/>`)).toBe(
    "data:image/png;base64,AAAA",
  );
  const painted = applyBlipLuminance("data:image/png;base64,AAAA", xml)!;
  const svg = Buffer.from(painted.split(",")[1], "base64").toString("utf8");
  expect(svg).toContain("0.2126 0.7152 0.0722 0 0");
  const values = svg.match(/tableValues="([^"]+)"/)?.[1].split(" ") ?? [];
  expect(values).toHaveLength(256);
  expect(values[191]).toBe("0");
  expect(values[192]).toBe("1");
  expect(biLevelSvg("data:image/png;base64,AAAA", 0).startsWith("data:image/svg+xml;base64,")).toBe(
    true,
  );
  const both = `<a:blip><a:lum bright="-5000" contrast="55000"/><a:biLevel thresh="50000"/></a:blip>`;
  const ordered = Buffer.from(
    applyBlipLuminance("data:image/png;base64,AAAA", both)!.split(",")[1],
    "base64",
  ).toString("utf8");
  expect(ordered).toContain('type="discrete"');
  const href = ordered.match(/href="([^"]+)"/)?.[1] ?? "";
  const inner = Buffer.from(href.split(",")[1], "base64").toString("utf8");
  expect(inner).toContain('slope="2.2222"');
});
