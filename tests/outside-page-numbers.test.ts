import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  defaultPageSettings,
  documentHtml,
  documentPageSettings,
  pageFace,
  pageNumberHint,
  setDifferentOddEven,
  type PageSettings,
} from "../packages/core/src/document-layout";
import { livePageSettings } from "../apps/web/src/editors/margin-live";
import {
  previewNumberCorner,
  previewSheetNumbers,
} from "../apps/web/src/editors/page-preview";
import { minutesDocument } from "./odd-even-fixture";

function saved(patch: Partial<PageSettings> = {}): PageSettings {
  return documentPageSettings({
    type: "doc",
    attrs: {
      pageSettings: {
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
        header: "",
        footer: "",
        ...patch,
      },
    },
  });
}

describe("numbers on the outside", () => {
  it("moves a top-right number to the left on even pages and keeps odd pages on the right", () => {
    const placed = saved();
    expect(pageFace(placed, 3, 5).numberSide).toBe("top-right");
    expect(pageFace(placed, 4, 5).numberSide).toBe("top-right");
    const mirrored = setDifferentOddEven(placed, true);
    expect(pageFace(mirrored, 3, 5)).toMatchObject({
      numberSide: "top-left",
      pageNumber: "Page 4",
    });
    expect(pageFace(mirrored, 4, 5)).toMatchObject({
      numberSide: "top-right",
      pageNumber: "Page 5",
    });
    expect(previewNumberCorner(pageFace(mirrored, 3, 5).numberSide)).toBe("top-left");
    expect(previewNumberCorner(pageFace(mirrored, 4, 5).numberSide)).toBe("top-right");
    expect(previewSheetNumbers(mirrored, 5)).toEqual(["Page 4", "Page 5"]);
    const off = setDifferentOddEven(mirrored, false);
    expect(pageFace(off, 0, 5).numberSide).toBe("top-right");
    expect(pageFace(off, 3, 5).numberSide).toBe("top-right");
    expect(pageFace(off, 4, 5).numberSide).toBe("top-right");
    expect(pageNumberHint(mirrored)).toContain("Top left on even pages");
    expect(pageNumberHint(mirrored)).toContain("top right on odd pages");
    expect(pageNumberHint(off)).toContain("Top right");
  });

  it("moves a bottom-center number to the outside bottom edge", () => {
    const placed = saved({ pageNumberPosition: "bottom-center" });
    const mirrored = setDifferentOddEven(placed, true);
    expect(pageFace(mirrored, 3, 5).numberSide).toBe("left");
    expect(pageFace(mirrored, 4, 5).numberSide).toBe("right");
    expect(previewNumberCorner(pageFace(mirrored, 3, 5).numberSide)).toBe("bottom-left");
    expect(previewNumberCorner(pageFace(mirrored, 4, 5).numberSide)).toBe("bottom-right");
    const off = setDifferentOddEven(mirrored, false);
    expect(pageFace(off, 3, 5).numberSide).toBe("center");
    expect(pageFace(off, 4, 5).numberSide).toBe("center");
    expect(pageNumberHint(mirrored)).toContain("Bottom left on even pages");
    expect(pageNumberHint(mirrored)).toContain("bottom right on odd pages");
  });

  it("draws the outside edges on the document before apply, and puts them back when the switch is off", () => {
    const placed = saved();
    const on = setDifferentOddEven(placed, true);
    const shown = livePageSettings(placed, on);
    expect(shown).not.toBe(placed);
    expect(shown.differentOddEven).toBe(true);
    expect(shown.pageNumberPosition).toBe("top-right");
    expect(pageFace(shown, 3, 5).numberSide).toBe("top-left");
    expect(pageFace(shown, 4, 5).numberSide).toBe("top-right");
    expect(pageFace(placed, 3, 5).numberSide).toBe("top-right");
    const hidden = livePageSettings(placed, setDifferentOddEven(on, false));
    expect(hidden.differentOddEven).toBe(false);
    expect(pageFace(hidden, 3, 5).numberSide).toBe("top-right");
    expect(pageFace(hidden, 4, 5).numberSide).toBe("top-right");
    expect(livePageSettings(placed, placed)).toBe(placed);
  });

  it("keeps the outside edges after the file is read again", () => {
    const mirrored = setDifferentOddEven(saved(), true);
    const again = documentPageSettings({
      type: "doc",
      attrs: { pageSettings: mirrored },
    });
    expect(again.differentOddEven).toBe(true);
    expect(again.pageNumberPosition).toBe("top-right");
    expect(again.pageNumberPositionSet).toBe(true);
    expect(pageFace(again, 3, 5).numberSide).toBe("top-left");
    expect(pageFace(again, 4, 5).numberSide).toBe("top-right");
  });

  it("prints the outside edge and leaves a chosen corner alone until odd and even pages are on", () => {
    const mirrored = setDifferentOddEven(saved(), true);
    const html = documentHtml("Preface", "<p>Text</p>", {
      ...defaultPageSettings,
      ...mirrored,
    });
    expect(html).toContain("@page:left { @top-left {");
    expect(html).toContain("@page:right { @top-right {");
    const centered = documentHtml("Preface", "<p>Text</p>", {
      ...defaultPageSettings,
      ...setDifferentOddEven(saved({ pageNumberPosition: "bottom-center" }), true),
    });
    expect(centered).toContain("@page:left { @bottom-left {");
    expect(centered).toContain("@page:right { @bottom-right {");
    expect(centered).not.toContain("@bottom-center");
    const plain = documentHtml("Preface", "<p>Text</p>", {
      ...defaultPageSettings,
      ...saved(),
    });
    expect(plain).toContain('@top-right { content: "Page " counter(page);');
    expect(plain).not.toContain("@page:left");
  });

  it("writes the even-page number on the left of a Word header", async () => {
    const file = minutesDocument();
    file.content.attrs = {
      pageSettings: {
        ...(file.content.attrs?.pageSettings as object),
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        differentOddEven: true,
        evenHeader: "Even pages",
        oddHeader: "Odd pages",
      },
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((path) => /word\/header\d+\.xml$/.test(path))
        .map(async (path) => zip.file(path)!.async("string")),
    );
    const even = headers.find((xml) => xml.includes("Even pages"));
    const odd = headers.find((xml) => xml.includes("Odd pages"));
    expect(even).toBeTruthy();
    expect(odd).toBeTruthy();
    expect(even).toContain('w:val="left"');
    expect(odd).toContain('w:val="right"');
    expect(even).toContain("PAGE");
    expect(odd).toContain("PAGE");
  });
});
