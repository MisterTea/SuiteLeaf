import { describe, expect, it } from "vitest";
import {
  defaultPageSettings,
  pageFace,
  restartedSectionTotal,
  sectionContentPages,
} from "../packages/core/src/document-layout";
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

  it("stops a section total at the next section", () => {
    const settings = { ...defaultPageSettings, pageNumbers: true };
    const sections = [
      { page: 2, header: "Notes", footer: "", restartAt: 1 },
      { page: 4, header: "Appendix", footer: "", restartAt: 1 },
    ];
    const at = (pageIndex: number) =>
      applySection(
        pageFace(settings, pageIndex, 6),
        sections,
        pageIndex,
        6,
        "fraction",
      ).pageNumber;
    expect(at(2)).toBe("1 / 2");
    expect(at(3)).toBe("2 / 2");
    expect(at(4)).toBe("1 / 2");
    expect(at(5)).toBe("2 / 2");
  });

  it("uses the same restarted total export uses for a flowed span", () => {
    const sentence = "A long paragraph remains editable across page boundaries. ";
    const short = [{ type: "paragraph", content: [{ type: "text", text: "Short" }] }];
    const flowed = [
      { type: "paragraph", content: [{ type: "text", text: sentence.repeat(90) }] },
    ];
    const broken = [
      { type: "paragraph", content: [{ type: "text", text: "Section one" }] },
      { type: "pageBreak" },
      { type: "paragraph", content: [{ type: "text", text: "Section two" }] },
    ];
    expect(sectionContentPages(short, defaultPageSettings)).toBe(1);
    expect(sectionContentPages(flowed, defaultPageSettings)).toBe(2);
    expect(sectionContentPages(broken, defaultPageSettings)).toBe(2);
    expect(restartedSectionTotal(1, 0, 2)).toBe(2);
    expect(restartedSectionTotal(1, 2, 4)).toBe(2);
    const face = pageFace({ ...defaultPageSettings, pageNumbers: true }, 0, 2);
    const sections = [{ page: 0, header: "Notes", footer: "End", restartAt: 1 }];
    expect(applySection(face, sections, 0, 2, "fraction").pageNumber).toBe("1 / 2");
    expect(applySection(face, sections, 1, 2, "fraction").pageNumber).toBe("2 / 2");
  });
});
