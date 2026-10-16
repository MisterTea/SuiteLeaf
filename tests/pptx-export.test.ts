import { describe, expect, it } from "vitest";
import { createFile, parsePowerPoint, writePowerPoint, type SlideFile } from "../packages/core/src";

describe("PowerPoint export", () => {
  it("writes text a PowerPoint import can read back", async () => {
    const file = createFile("slide", "Pitch") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    slide.elements[0].content = "Hello";
    slide.elements[1].content = "There";
    const bytes = await writePowerPoint(file);
    const back = await parsePowerPoint(bytes, "Pitch");
    const texts = back.content.slideOrder.flatMap((id) =>
      back.content.slides[id].elements
        .filter((el) => el.type === "text")
        .map((el) => el.content),
    );
    expect(texts).toContain("Hello");
    expect(texts).toContain("There");
  });
});