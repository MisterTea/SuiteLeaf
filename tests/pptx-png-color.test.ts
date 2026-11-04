import { describe, it, expect } from "vitest";
import { officePngSamples } from "../packages/core/src/pptx-png-color";
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
function chunk(type: string, data: number[] = []) {
  return [
    0,
    0,
    0,
    data.length,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ];
}
describe("PowerPoint PNG color interpretation", () => {
  it("removes ICC metadata while preserving compressed samples and other chunks", () => {
    const pixels = chunk("IDAT", [5, 7, 9]);
    const end = chunk("IEND");
    expect(
      officePngSamples(
        new Uint8Array([
          ...signature,
          ...chunk("iCCP", [1, 2]),
          ...pixels,
          ...end,
        ]),
      ),
    ).toEqual(new Uint8Array([...signature, ...pixels, ...end]));
  });
  it("keeps images without a profile and rejects invalid or truncated chunks", () => {
    for (const value of [
      new Uint8Array([1]),
      new Uint8Array([...signature, ...chunk("IDAT")]),
      new Uint8Array([...signature, 1]),
      new Uint8Array([...signature, 0, 0, 255, 255, ...chunk("iCCP")]),
    ])
      expect(officePngSamples(value)).toBe(value);
  });
});
