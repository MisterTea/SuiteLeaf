import { expect, it } from "vitest";
import { createFile, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";

const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

it("keeps an image description through a PowerPoint export", async () => {
  const file = createFile("slide", "Beds") as SlideFile;
  const slideId = file.content.slideOrder[0];
  file.content.slides[slideId].elements.push({
    id: "photo",
    type: "image",
    x: 40,
    y: 40,
    width: 120,
    height: 80,
    src: pixel,
    alt: "North beds",
  });
  const parsed = await parsePowerPoint(await exportPptx(file));
  const image = parsed.content.slides[parsed.content.slideOrder[0]].elements.find(
    (element) => element.type === "image",
  );
  expect(image?.alt).toBe("North beds");
});
