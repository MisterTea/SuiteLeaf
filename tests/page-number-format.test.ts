import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";

describe("page number Word export", () => {
  it("writes Page N at the top right and leaves the footer text alone", async () => {
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error();
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Garden club minutes",
          footer: "Committee draft",
          pageNumbers: true,
          pageNumberFormat: "page",
          pageNumberPosition: "top-right",
          pageNumberPositionSet: true,
        },
      },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Present" }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const header = await zip.file("word/header1.xml")!.async("string");
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(header).toContain("Garden club minutes");
    expect(header).toMatch(/PAGE(?!S)/);
    expect(header).not.toContain("NUMPAGES");
    expect(footer).toContain("Committee draft");
    expect(footer).not.toContain("NUMPAGES");
    expect(footer).not.toMatch(/PAGE(?!S)/);
  });
});
