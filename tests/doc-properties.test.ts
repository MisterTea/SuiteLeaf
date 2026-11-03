import { expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, fileSchema, type DocFile } from "../packages/core/src";
import { documentProperties, undoDocument } from "../packages/core/src/doc-properties";
import { exportDocx } from "../packages/core/src/docx-export";

it("keeps author, subject, and keywords when the body is undone and the file is reopened", async () => {
  const file = createFile("doc", "Report") as DocFile;
  const before = structuredClone(file.content);
  file.properties = {
    author: "Ada",
    subject: "Beds",
    keywords: ["north"],
    description: "North beds",
    category: "Garden",
  };
  file.content = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "after" }] }],
  };
  const undone = undoDocument(file, before);
  expect(documentProperties(undone)).toEqual({
    author: "Ada",
    subject: "Beds",
    keywords: ["north"],
    description: "North beds",
    category: "Garden",
  });
  expect(JSON.stringify(undone.content)).not.toContain("after");
  const redone = undoDocument(undone, file.content);
  expect(documentProperties(redone)?.keywords).toEqual(["north"]);
  expect(JSON.stringify(redone.content)).toContain("after");
  const reopened = fileSchema.parse(JSON.parse(JSON.stringify(undone)));
  expect(reopened.kind).toBe("doc");
  if (reopened.kind !== "doc") return;
  expect(reopened.properties).toEqual({
    author: "Ada",
    subject: "Beds",
    keywords: ["north"],
    description: "North beds",
    category: "Garden",
  });

  const core = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("docProps/core.xml")!
    .async("string");
  expect(core).toContain("Ada");
  expect(core).toContain("Beds");
  expect(core).toContain("north");
  expect(core).toContain("North beds");
  const custom = await (
    await JSZip.loadAsync(await exportDocx(file))
  )
    .file("docProps/custom.xml")!
    .async("string");
  expect(custom).toContain("Garden");
  expect(custom).toContain("Category");
});
