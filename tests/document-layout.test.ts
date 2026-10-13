import { describe, expect, it } from "vitest";
import {
  defaultPageSettings,
  documentHtml,
  documentPageSettings,
  pageFace,
  pageNumberHint,
} from "../packages/core/src/document-layout";

describe("document page settings", () => {
  it("leaves page numbers off in documents without page setup", () => {
    expect(defaultPageSettings.pageNumbers).toBe(false);
    expect(documentPageSettings({ type: "doc" }).pageNumbers).toBe(false);
    expect(
      documentPageSettings({ type: "doc", attrs: { pageSettings: null } })
        .pageNumbers,
    ).toBe(false);
  });
  it("keeps the page numbers saved with a document", () => {
    const saved = (pageSettings: object) =>
      documentPageSettings({ type: "doc", attrs: { pageSettings } });
    expect(saved({ header: "Old file" }).pageNumbers).toBe(true);
    expect(saved({ pageNumbers: true }).pageNumbers).toBe(true);
    expect(saved({ pageNumbers: false }).pageNumbers).toBe(false);
  });
  it("keeps a different first page, and leaves older files unchanged", () => {
    const saved = (pageSettings: object) =>
      documentPageSettings({ type: "doc", attrs: { pageSettings } });
    const older = saved({ header: "Garden club minutes", footer: "Draft" });
    expect(older.differentFirstPage).toBe(false);
    expect(older.firstHeader).toBe("");
    expect(pageFace(older, 0, 2)).toMatchObject({
      header: "Garden club minutes",
      footer: "Draft",
      numberSide: "right",
      pageNumber: "1 / 2",
    });
    expect(older.pageNumberFormat).toBe("fraction");
    expect(older.pageNumberPositionSet).toBe(false);
    const cover = saved({
      header: "Garden club minutes",
      footer: "Draft",
      pageNumbers: true,
      differentFirstPage: true,
      firstHeader: "Riverside Garden Club",
      firstFooter: "",
    });
    expect(cover.differentFirstPage).toBe(true);
    expect(cover.firstHeader).toBe("Riverside Garden Club");
    expect(pageFace(cover, 0, 2)).toMatchObject({
      header: "Riverside Garden Club",
      footer: "",
      numberSide: "none",
      pageNumber: "",
    });
    expect(pageFace(cover, 1, 2)).toMatchObject({
      header: "Garden club minutes",
      footer: "Draft",
      numberSide: "right",
      pageNumber: "2 / 2",
    });
    expect(pageFace({ ...cover, differentFirstPage: false }, 0, 2)).toMatchObject({
      header: "Garden club minutes",
      footer: "Draft",
      pageNumber: "1 / 2",
    });
  });
  it("keeps a first-page header apart from the even and odd headers", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: {
        pageSettings: {
          differentFirstPage: true,
          firstHeader: "Town Council",
          differentOddEven: true,
          evenHeader: "Minutes",
          oddHeader: "Council",
          pageNumbers: true,
        },
      },
    });
    expect(pageFace(settings, 0, 3)).toMatchObject({
      header: "Town Council",
      headerAlign: "left",
      numberSide: "none",
      pageNumber: "",
    });
    expect(pageFace(settings, 1, 3)).toMatchObject({
      header: "Minutes",
      headerAlign: "left",
      numberSide: "left",
      pageNumber: "2 / 3",
    });
    expect(pageFace(settings, 2, 3)).toMatchObject({
      header: "Council",
      headerAlign: "right",
      numberSide: "right",
      pageNumber: "3 / 3",
    });
  });
  it("keeps a chosen page-number format and position, and ignores unknown values", () => {
    const saved = (pageSettings: object) =>
      documentPageSettings({ type: "doc", attrs: { pageSettings } });
    const chosen = saved({
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "bottom-center",
      pageNumberPositionSet: true,
      footer: "Committee draft",
      differentOddEven: true,
      evenFooter: "Left edge",
      oddFooter: "Right edge",
    });
    expect(chosen.pageNumberFormat).toBe("page");
    expect(chosen.pageNumberPosition).toBe("bottom-center");
    expect(pageFace(chosen, 0, 2)).toMatchObject({
      footer: "Right edge",
      numberSide: "center",
      pageNumber: "Page 1",
    });
    expect(pageFace(chosen, 1, 2)).toMatchObject({
      footer: "Left edge",
      numberSide: "center",
      pageNumber: "Page 2",
    });
    expect(pageNumberHint(chosen)).toContain("Bottom center");
    expect(pageNumberHint(chosen)).toContain("Page 1");
    const top = saved({
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
      header: "Garden club minutes",
      footer: "Committee draft",
    });
    expect(pageFace(top, 0, 2).numberSide).toBe("top-right");
    expect(pageFace(top, 0, 2).pageNumber).toBe("Page 1");
    expect(pageFace({ ...top, pageNumbers: false }, 0, 2)).toMatchObject({
      numberSide: "none",
      pageNumber: "",
      footer: "Committee draft",
    });
    const unknown = saved({
      pageNumbers: true,
      pageNumberFormat: "roman",
      pageNumberPosition: "top-left",
    });
    expect(unknown.pageNumberFormat).toBe("fraction");
    expect(unknown.pageNumberPosition).toBe("bottom-right");
    expect(unknown.pageNumberPositionSet).toBe(false);
    expect(pageFace(unknown, 0, 2).pageNumber).toBe("1 / 2");
  });
});

describe("document HTML export", () => {
  it("puts the header above and the footer below the text", () => {
    const html = documentHtml("Minutes <draft>", "<h1>Minutes</h1>", {
      ...defaultPageSettings,
      header: "Garden & Club",
      footer: "Draft <members>",
      pageNumbers: true,
    });
    expect(html).toContain("<title>Minutes &lt;draft&gt;</title>");
    const header = html.indexOf(
      '<header class="page-header">Garden &amp; Club</header>',
    );
    const body = html.indexOf("<h1>Minutes</h1>");
    const footer = html.indexOf(
      '<footer class="page-footer">Draft &lt;members&gt;</footer>',
    );
    expect(header).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(header);
    expect(footer).toBeGreaterThan(body);
    expect(html).toContain(
      '@bottom-right { content: counter(page) " / " counter(pages); font: 10pt Arial, sans-serif; color: #555; }',
    );
    const centered = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "bottom-center",
      pageNumberPositionSet: true,
      footer: "Committee draft",
    });
    expect(centered).toContain('@bottom-center { content: "Page " counter(page);');
    expect(centered).not.toContain("counter(pages)");
    expect(centered).toContain(
      '<footer class="page-footer">Committee draft</footer>',
    );
    const top = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
    });
    expect(top).toContain('@top-right { content: "Page " counter(page);');
    expect(top).not.toContain("@bottom-right");
    expect(html).toContain("size: 8.5in 11in;");
    expect(html).toContain("[data-page-break] { break-before: page; }");
  });
  it("prints the letterhead on page 1 and no number there", () => {
    const html = documentHtml("Minutes", "<p>October minutes</p>", {
      ...defaultPageSettings,
      differentFirstPage: true,
      firstHeader: "Town Council",
      header: "Council",
      pageNumbers: true,
    });
    expect(html).toContain(
      '<header class="page-header">Town Council</header>',
    );
    expect(html).not.toContain(">Council</header>");
    expect(html).toContain("@page :first { @bottom-right { content: none; } }");
    expect(html).toContain('counter(page) " / " counter(pages)');
  });
  it("omits page furniture that is not set up", () => {
    const html = documentHtml("Notes", "<p>Text</p>", {
      ...defaultPageSettings,
      size: "a4",
      landscape: true,
    });
    expect(html).not.toContain("<header");
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("counter(page)");
    expect(html).toContain("<main><p>Text</p></main>");
  });
});
