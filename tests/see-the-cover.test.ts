import { describe, expect, it } from "vitest";
import {
  documentHtml,
  documentPageSettings,
  pageFace,
  pageNumberHint,
  type PageSettings,
} from "../packages/core/src/document-layout";
import { livePageSettings } from "../apps/web/src/editors/margin-live";
import {
  previewNumberCorner,
  previewPlan,
  previewSheetNumbers,
} from "../apps/web/src/editors/page-preview";

function preface(patch: Partial<PageSettings> = {}): PageSettings {
  return documentPageSettings({
    type: "doc",
    attrs: {
      pageSettings: {
        pageNumbers: true,
        pageNumberFormat: "page",
        pageNumberPosition: "top-right",
        pageNumberPositionSet: true,
        pageNumberStart: 1,
        differentOddEven: true,
        evenHeader: "Even pages",
        oddHeader: "Odd pages",
        evenFooter: "Even draft",
        oddFooter: "Committee draft",
        footer: "Committee draft",
        ...patch,
      },
    },
  });
}

describe("see the cover", () => {
  it("drops the cover number and puts Page 1 on the outside right before apply", () => {
    const saved = preface({ coverHasNoNumber: false, differentOddEven: true });
    expect(pageFace(saved, 0, 3)).toMatchObject({
      pageNumber: "Page 1",
      numberSide: "top-right",
    });
    expect(pageFace(saved, 1, 3)).toMatchObject({
      pageNumber: "Page 2",
      numberSide: "top-left",
      header: "Even pages",
    });
    expect(pageFace(saved, 2, 3)).toMatchObject({
      pageNumber: "Page 3",
      numberSide: "top-right",
    });

    const shown = livePageSettings(saved, { ...saved, coverHasNoNumber: true });
    expect(shown).not.toBe(saved);
    expect(shown.coverHasNoNumber).toBe(true);
    expect(shown.differentOddEven).toBe(true);
    expect(shown.pageNumberPosition).toBe("top-right");
    expect(pageFace(shown, 0, 3)).toMatchObject({
      pageNumber: "",
      numberSide: "none",
      footer: "Committee draft",
      header: "Odd pages",
    });
    expect(pageFace(shown, 1, 3)).toMatchObject({
      pageNumber: "Page 1",
      numberSide: "top-right",
      header: "Odd pages",
    });
    expect(pageFace(shown, 2, 3)).toMatchObject({
      pageNumber: "Page 2",
      numberSide: "top-left",
      header: "Even pages",
    });
    expect(previewNumberCorner(pageFace(shown, 1, 3).numberSide)).toBe("top-right");
    expect(previewNumberCorner(pageFace(shown, 2, 3).numberSide)).toBe("top-left");
    expect(pageFace(saved, 0, 3).pageNumber).toBe("Page 1");
  });

  it("previews the blank cover and the next sheet on the outside edge", () => {
    const saved = preface();
    expect(previewPlan(3, true, false)).toEqual({
      slots: [
        { kind: "page", index: 1, role: "last-even" },
        { kind: "page", index: 2, role: "last-odd" },
      ],
      total: 3,
    });
    const covered = { ...saved, coverHasNoNumber: true };
    expect(previewPlan(3, true, true)).toEqual({
      slots: [
        { kind: "page", index: 0, role: "cover" },
        { kind: "page", index: 1, role: "next" },
      ],
      total: 3,
    });
    expect(previewSheetNumbers(covered, 3)).toEqual(["", "Page 1"]);
    expect(previewNumberCorner(pageFace(covered, 1, 3).numberSide)).toBe("top-right");
    expect(pageNumberHint(covered, 3)).toContain("outside right");
    expect(pageNumberHint(covered, 3)).toContain("on the left");
    const off = { ...covered, coverHasNoNumber: false };
    expect(previewSheetNumbers(off, 3)).toEqual(["Page 2", "Page 3"]);
    expect(pageFace(off, 1, 3).numberSide).toBe("top-left");
    expect(pageFace(off, 2, 3).numberSide).toBe("top-right");
  });

  it("keeps the blank cover after the settings are read again", () => {
    const covered = preface({ coverHasNoNumber: true });
    const again = documentPageSettings({
      type: "doc",
      attrs: { pageSettings: covered },
    });
    expect(again.coverHasNoNumber).toBe(true);
    expect(again.differentOddEven).toBe(true);
    expect(pageFace(again, 0, 3).pageNumber).toBe("");
    expect(pageFace(again, 1, 3)).toMatchObject({
      pageNumber: "Page 1",
      numberSide: "top-right",
    });
    expect(pageFace(again, 2, 3)).toMatchObject({
      pageNumber: "Page 2",
      numberSide: "top-left",
    });
  });

  it("prints a blank first page and keeps the outside edges", () => {
    const html = documentHtml("Preface", "<p>Text</p>", preface({ coverHasNoNumber: true }));
    expect(html).toContain("@page:first {");
    expect(html).toContain("@page:left { @top-left {");
    expect(html).toContain("@page:right { @top-right {");
    expect(html).toContain("counter-reset: page -1;");
  });
});
