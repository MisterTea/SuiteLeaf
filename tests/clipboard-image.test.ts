/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { clipboardImageFiles, pastedImageFiles } from "../apps/web/src/editors/clipboard-image";
import { marpInsertion, slidePasteWhere } from "../apps/web/src/editors/slide-clipboard-paste";

function transfer(files: File[], plain = "", html = ""): DataTransfer {
  return {
    files,
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    getData: (type: string) => (type === "text/html" ? html : type === "text/plain" ? plain : ""),
  } as unknown as DataTransfer;
}

describe("clipboard pictures", () => {
  const png = () => new File(["x"], "shot.png", { type: "image/png" });

  it("reads a picture from the files or the items, once", () => {
    expect(clipboardImageFiles(transfer([png()])).map((file) => file.name)).toEqual(["shot.png"]);
    const itemOnly = {
      items: [{ kind: "file", type: "image/png", getAsFile: () => png() }],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(clipboardImageFiles(itemOnly)).toHaveLength(1);
    expect(clipboardImageFiles(null)).toEqual([]);
  });

  it("treats a screenshot as a picture and a passage of text as text", () => {
    expect(pastedImageFiles(transfer([png()]))).toHaveLength(1);
    expect(pastedImageFiles(transfer([png()], "https://cdn.test/shot.png"))).toHaveLength(1);
    expect(pastedImageFiles(transfer([png()], "shot.png"))).toHaveLength(1);
    expect(pastedImageFiles(transfer([png()], "Meet at the stall on Saturday."))).toEqual([]);
    expect(pastedImageFiles(transfer([png()], "", "<p>Meet at the stall.</p>"))).toEqual([]);
    expect(pastedImageFiles(transfer([png()], "", '<meta charset="utf-8"><img src="https://x.test/a.png">'))).toHaveLength(1);
  });

  it("names a screenshot whose type arrived blank", () => {
    const file = new File(["x"], "shot.png", { type: "" });
    expect(clipboardImageFiles(transfer([file]))[0].type).toBe("image/png");
  });
});

describe("where a slide paste goes", () => {
  it("puts a picture on the slide, in the markdown, or leaves a text field alone", () => {
    expect(slidePasteWhere(null)).toBe("canvas");
    const notes = document.createElement("textarea");
    notes.className = "notes-textarea";
    expect(slidePasteWhere(notes)).toBe("ignore");
    const markdown = document.createElement("textarea");
    markdown.className = "marp-textarea";
    expect(slidePasteWhere(markdown)).toBe("marp");
    const box = document.createElement("div");
    box.className = "element-textarea";
    const word = document.createElement("span");
    box.append(word);
    expect(slidePasteWhere(word)).toBe("text");
    const field = document.createElement("input");
    expect(slidePasteWhere(field)).toBe("ignore");
    expect(slidePasteWhere(document.body)).toBe("canvas");
  });

  it("keeps a pasted picture on its own markdown line", () => {
    expect(marpInsertion("# Title\n", "", "![chart](media/chart.png)")).toBe("\n![chart](media/chart.png)");
    expect(marpInsertion("# Title", "\nNext", "![chart](media/chart.png)")).toBe("\n\n![chart](media/chart.png)\n");
    expect(marpInsertion("", "\n\n# Next", "![chart](media/chart.png)")).toBe("![chart](media/chart.png)");
  });
});
