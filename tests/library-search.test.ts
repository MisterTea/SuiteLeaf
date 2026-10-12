import { describe, expect, it } from "vitest";
import { createFile, type SuiteFile } from "@suiteleaf/core";
import { fileText, searchFile } from "../apps/web/src/library-search";

function doc(title: string, ...paragraphs: string[]) {
  const file = createFile("doc", title);
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
  return file;
}

describe("library search", () => {
  it("matches names case-insensitively without an excerpt", () => {
    expect(searchFile(doc("Garden club newsletter"), "GARDEN")).toEqual({});
    expect(searchFile(doc("Garden club newsletter"), "  ")).toEqual({});
  });

  it("finds words inside a document and quotes them", () => {
    const file = doc(
      "October newsletter",
      "Harvest supper on Saturday.",
      "Bring a dish to share.",
    );
    expect(fileText(file)).toBe("Harvest supper on Saturday. Bring a dish to share.");
    expect(searchFile(file, "dish")?.snippet).toBe(
      "Harvest supper on Saturday. Bring a dish to share.",
    );
    expect(searchFile(file, "tomatoes")).toBeNull();
  });

  it("trims long excerpts to the words around the match", () => {
    const file = doc(
      "Notes",
      `${"word ".repeat(40)}compost bins arrive on Tuesday ${"more ".repeat(40)}`,
    );
    const snippet = searchFile(file, "compost")!.snippet!;
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("compost bins arrive on Tuesday");
    expect(snippet.length).toBeLessThan(110);
  });

  it("searches spreadsheet cells and slide text", () => {
    const sheet = createFile("sheet", "Budget") as Extract<SuiteFile, { kind: "sheet" }>;
    const id = sheet.content.workbook.sheetOrder[0];
    sheet.content.workbook.sheets[id].cellData = {
      0: { 0: { v: "Seeds" }, 1: { v: 42.5 } },
    };
    expect(searchFile(sheet, "seeds")?.snippet).toContain("Seeds 42.5");
    expect(searchFile(sheet, "42.5")).not.toBeNull();

    const slides = createFile("slide", "Talk") as Extract<SuiteFile, { kind: "slide" }>;
    const first = slides.content.slides[slides.content.slideOrder[0]];
    first.elements.push({
      id: "t",
      type: "text",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      content: "Autumn planting",
    });
    first.notes = "Thank the volunteers";
    expect(searchFile(slides, "planting")).not.toBeNull();
    expect(searchFile(slides, "volunteers")?.snippet).toContain("Thank the volunteers");
  });
});
