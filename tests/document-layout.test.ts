import { describe, expect, it } from "vitest";
import {
  bodyTextHeight,
  defaultPageSettings,
  documentHtml,
  documentPageSettings,
  laidOutPageCount,
  marginError,
  marginsValid,
  maxGutter,
  pageBreakSpacer,
  pageFace,
  pageNumberHint,
  pageSideInsets,
  setPageMargin,
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
  it("opens a file that stored one margin with that margin on every edge", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: { pageSettings: { margin: 96 } },
    });
    expect(settings.top).toBe(96);
    expect(settings.bottom).toBe(96);
    expect(settings.left).toBe(96);
    expect(settings.right).toBe(96);
    expect(settings.margin).toBe(96);
  });
  it("keeps each stored edge, and changing one does not change the others", () => {
    const saved = documentPageSettings({
      type: "doc",
      attrs: {
        pageSettings: {
          margin: 72,
          top: 144,
          bottom: 72,
          left: 96,
          right: 48,
        },
      },
    });
    expect(saved.top).toBe(144);
    expect(saved.bottom).toBe(72);
    expect(saved.left).toBe(96);
    expect(saved.right).toBe(48);
    const next = setPageMargin(saved, "top", 120);
    expect(next.top).toBe(120);
    expect(next.bottom).toBe(saved.bottom);
    expect(next.left).toBe(saved.left);
    expect(next.right).toBe(saved.right);
  });
  it("refuses a margin below 0.25 inches or above 3 inches", () => {
    expect(marginError(0)).toBe("A margin must be at least 0.25 inches.");
    expect(marginError(23.9)).toBe("A margin must be at least 0.25 inches.");
    expect(marginError(24)).toBeNull();
    expect(marginError(288)).toBeNull();
    expect(marginError(288.1)).toBe("A margin must be at most 3 inches.");
    expect(marginError(Number.NaN)).toBe("Enter each margin in inches.");
    expect(
      marginsValid({ top: 144, bottom: 72, left: 96, right: 72 }),
    ).toBe(true);
    expect(
      marginsValid({ top: 0, bottom: 72, left: 96, right: 72 }),
    ).toBe(false);
    expect(
      marginsValid({ top: 144, bottom: 400, left: 96, right: 72 }),
    ).toBe(false);
  });
  it("sizes the body from the top and bottom margins only", () => {
    const margins = { top: 144, bottom: 72, left: 96, right: 48 };
    expect(bodyTextHeight(1056, margins)).toBe(1056 - 144 - 72);
    expect(pageBreakSpacer(10, margins)).toBe(10 + 72 + 24 + 144);
    const equal = { top: 72, bottom: 72, left: 72, right: 72 };
    expect(pageBreakSpacer(10, equal)).toBe(10 + 72 * 2 + 24);
    expect(laidOutPageCount(100, 0, 1056, equal)).toBe(
      Math.ceil((100 + 72 * 2 + 24) / (1056 + 24)),
    );
    expect(laidOutPageCount(800, 0, 1056, margins)).toBe(
      Math.ceil((800 + 144 + 72 + 24) / (1056 + 24)),
    );
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
  it("defaults the gutter to 0 and refuses anything above 2 inches", () => {
    const saved = (pageSettings: object) =>
      documentPageSettings({ type: "doc", attrs: { pageSettings } });
    expect(defaultPageSettings.gutter).toBe(0);
    expect(documentPageSettings({ type: "doc" }).gutter).toBe(0);
    expect(saved({ header: "Old file" }).gutter).toBe(0);
    expect(saved({ gutter: 48 }).gutter).toBe(48);
    expect(saved({ gutter: 0 }).gutter).toBe(0);
    expect(saved({ gutter: 300 }).gutter).toBe(maxGutter);
    expect(saved({ gutter: -10 }).gutter).toBe(0);
    const halfInch = { ...defaultPageSettings, gutter: 48 };
    expect(pageSideInsets(halfInch, 1)).toEqual({ left: 72 + 48, right: 72 });
    expect(pageSideInsets(halfInch, 2)).toEqual({ left: 72, right: 72 + 48 });
    expect(pageSideInsets(halfInch, 3)).toEqual(pageSideInsets(halfInch, 1));
    expect(pageSideInsets(defaultPageSettings, 2)).toEqual({
      left: 72,
      right: 72,
    });
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
    expect(html).toContain("padding: 0.75in 0.75in 0.75in 0.75in;");
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
    expect(html).not.toContain("@page :left");
    expect(html).not.toContain("@page :right");
  });
  it("prints the gutter on the inside edge", () => {
    const html = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      gutter: 48,
    });
    expect(html).toContain(
      "@page :right { margin-left: 1.25in; margin-right: 0.75in; }",
    );
    expect(html).toContain(
      "@page :left { margin-left: 0.75in; margin-right: 1.25in; }",
    );
  });
  it("prints a different margin on each edge", () => {
    const html = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      top: 144,
      bottom: 72,
      left: 96,
      right: 48,
    });
    expect(html).toContain("padding: 1.5in 0.5in 0.75in 1in;");
    expect(html).toContain("margin: 1.5in 0.5in 0.75in 1in;");
  });
});
