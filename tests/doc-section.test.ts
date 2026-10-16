import { describe, expect, it } from "vitest";
import { defaultPageSettings, pageFace } from "../packages/core/src/document-layout";
import { applySection, sectionAt, sectionAttrs } from "../apps/web/src/editors/doc-section-break";

describe("section breaks", () => {
  it("restarts numbering and replaces a blank header", () => {
    const face = pageFace({ ...defaultPageSettings, pageNumbers: true, header: "Club" }, 2, 4);
    const next = applySection(
      face,
      [{ page: 2, header: "Appendix", footer: "", restartAt: 1 }],
      2,
      4,
      "page",
    );
    expect(next.header).toBe("Appendix");
    expect(next.footer).toBe(face.footer);
    expect(next.pageNumber).toBe("Page 1");
  });

  it("keeps the document header when the section header is blank", () => {
    const face = pageFace({ ...defaultPageSettings, header: "Club" }, 1, 3);
    const next = applySection(face, [{ page: 1, header: "", footer: "End", restartAt: null }], 1, 3, "fraction");
    expect(next.header).toBe("Club");
    expect(next.footer).toBe("End");
    expect(next.pageNumber).toBe(face.pageNumber);
  });

  it("leaves pages before the break on the document's numbering", () => {
    const face = pageFace({ ...defaultPageSettings, pageNumbers: true, header: "Club" }, 0, 4);
    const sections = [{ page: 2, header: "Appendix", footer: "", restartAt: 1 }];
    expect(sectionAt(sections, 0)).toBeNull();
    expect(applySection(face, sections, 0, 4, "fraction")).toEqual(face);
    expect(applySection(face, sections, 2, 4, "fraction").pageNumber).toBe("1 / 2");
  });

  it("stores a start number only when it is a page", () => {
    expect(sectionAttrs({ header: "  Notes ", footer: "", restartAt: 4 }).restartAt).toBe(4);
    expect(sectionAttrs({ restartAt: 0 }).restartAt).toBeNull();
  });
});
