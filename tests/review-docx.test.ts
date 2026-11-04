import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import { exportReviewedDocx, reviewFromDocx, stampReview } from "../packages/core/src/review-docx";
import { readReview } from "../packages/core/src/review-store";

describe("review in a Word file", () => {
  it("keeps the review when the file is written and opened", async () => {
    const file = createFile("doc", "Beds");
    file.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "North" }] }],
    };
    const stamped = await stampReview(await exportDocx(file), {
      decisions: [
        { block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." },
        { block: 2, note: "secret-value" },
      ],
      choices: [{ block: 1, side: "left" }],
      approvedVersion: "rev-1",
    });
    const part = await (await JSZip.loadAsync(stamped)).file("word/suiteleaf-review.json")!.async("string");
    expect(part).not.toContain("secret-value");
    expect(await reviewFromDocx(stamped)).toEqual({
      decisions: [
        { block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." },
        { block: 2, note: "Block 2 needs a choice." },
      ],
      choices: [{ block: 1, side: "left" }],
      approvedVersion: "rev-1",
    });
    const opened = await importOffice(stamped, "docx", "Beds.docx");
    expect(readReview(opened.file.content as { type: string })).toEqual(await reviewFromDocx(stamped));
    expect(JSON.stringify(opened.file.content)).toContain("North");
    expect(JSON.stringify(opened.file.content)).not.toContain("secret-value");
    expect(await reviewFromDocx(await exportDocx(file))).toBeNull();
    const downloaded = await exportReviewedDocx({
      title: "Beds",
      content: {
        type: "doc",
        attrs: {
          review: {
            decisions: [{ block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." }],
            choices: [{ block: 1, side: "left" }],
            approvedVersion: "rev-1",
          },
        },
        content: [{ type: "paragraph", content: [{ type: "text", text: "North" }] }],
      },
    });
    expect(await reviewFromDocx(downloaded)).toEqual({
      decisions: [{ block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." }],
      choices: [{ block: 1, side: "left" }],
      approvedVersion: "rev-1",
    });
    expect(await reviewFromDocx(await exportReviewedDocx({ title: "Beds", content: file.content as { type: "doc" } }))).toBeNull();
    const empty = await stampReview(stamped.buffer, { decisions: [], choices: [] });
    expect(await reviewFromDocx(new Blob([empty]))).toEqual({ decisions: [], choices: [] });
    const zip = await JSZip.loadAsync(stamped);
    zip.file("word/suiteleaf-review.json", "{");
    expect(await reviewFromDocx(await zip.generateAsync({ type: "uint8array" }))).toBeNull();
    zip.file("word/suiteleaf-review.json", "null");
    expect(await reviewFromDocx(await zip.generateAsync({ type: "uint8array" }))).toBeNull();
  });
});
