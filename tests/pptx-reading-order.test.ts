import { expect, it } from "vitest";
import { createFile, slideSchema, type SlideFile } from "../packages/core/src";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";

it("keeps a slide reading order through a PowerPoint export", async () => {
  const file = createFile("slide", "Beds") as SlideFile;
  const slideId = file.content.slideOrder[0];
  const slide = file.content.slides[slideId];
  slide.elements = [
    {
      id: "title",
      type: "text",
      x: 40,
      y: 40,
      width: 400,
      height: 80,
      content: "Title",
    },
    {
      id: "body",
      type: "text",
      x: 40,
      y: 140,
      width: 400,
      height: 80,
      content: "Body",
    },
  ];
  slide.readingOrder = ["body", "title"];
  expect(slideSchema.parse(slide).readingOrder).toEqual(["body", "title"]);
  const parsed = await parsePowerPoint(await exportPptx(file));
  const imported = parsed.content.slides[parsed.content.slideOrder[0]];
  const text = (id: string | undefined) =>
    imported.elements.find((element) => element.id === id)?.content;
  expect(imported.readingOrder?.map(text)).toEqual(["Body", "Title"]);
});
