import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type DocFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

it("keeps the heading, the image description, and the table header in a Word export", async () => {
  const file = createFile("doc", "Beds") as DocFile;
  file.content = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Beds" }],
      },
      { type: "image", attrs: { src: png, alt: "North beds" } },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Crop" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Tomato" }] }],
              },
            ],
          },
        ],
      },
    ],
  } as DocFile["content"];
  const xml = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("word/document.xml")!
    .async("string");
  expect(xml).toContain("Beds");
  expect(xml).toContain("North beds");
  expect(xml).toContain("Crop");
  expect(xml).toContain("Tomato");
  expect(xml).toMatch(/w:val="Heading1"|w:val="heading 1"/);
  expect(xml).toContain("tblHeader");
  expect(xml).not.toContain("tagged PDF");
});
