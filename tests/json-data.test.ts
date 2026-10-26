import { describe, expect, it } from "vitest";
import { cloneJson, sameJson, utf8LongerThan } from "../packages/core/src";

describe("comparing and copying file content", () => {
  it("compares what JSON would write, in any key order", () => {
    expect(sameJson({ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1, gone: undefined }, { a: 1 })).toBe(true);
    expect(sameJson([undefined], [null])).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: [1, 2] }, { a: [1] })).toBe(false);
    expect(sameJson({ a: {} }, { a: [] })).toBe(false);
    expect(sameJson({ a: null }, {})).toBe(false);
  });

  it("copies objects and arrays but shares strings, so pictures are not duplicated", () => {
    const picture = `data:image/png;base64,${"A".repeat(1000)}`;
    const content = { slides: { a: { elements: [{ src: picture, gone: undefined }] } } };
    const copy = cloneJson(content);
    expect(copy).toEqual({ slides: { a: { elements: [{ src: picture }] } } });
    expect(copy.slides).not.toBe(content.slides);
    expect(copy.slides.a.elements[0]).not.toBe(content.slides.a.elements[0]);
    expect(copy.slides.a.elements[0].src).toBe(picture);
    const when = new Date(0);
    expect(cloneJson({ when }).when).not.toBe(when);
    expect(cloneJson({ when }).when.getTime()).toBe(0);
  });
});

describe("measuring a native file", () => {
  it("counts UTF-8 bytes, encoding only text near the limit", () => {
    expect(utf8LongerThan("abc", 9)).toBe(false);
    expect(utf8LongerThan("abcdefghij", 9)).toBe(true);
    expect(utf8LongerThan("ééé", 6)).toBe(false);
    expect(utf8LongerThan("éééé", 6)).toBe(true);
    expect(utf8LongerThan("日本", 5)).toBe(true);
  });
});
