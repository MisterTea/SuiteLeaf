import { describe, expect, it } from "vitest";
import {
  defaultPageSettings,
  documentHtml,
  documentPageSettings,
  lowerRoman,
  pageFace,
  pageMarginError,
  pageMarginsError,
  pageNumberFormatChips,
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
  it("opens a single stored margin as four equal edges", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: { pageSettings: { margin: 96 } },
    });
    expect(settings.marginTop).toBe(96);
    expect(settings.marginBottom).toBe(96);
    expect(settings.marginLeft).toBe(96);
    expect(settings.marginRight).toBe(96);
  });
  it("keeps four stored edges when they differ", () => {
    const settings = documentPageSettings({
      type: "doc",
      attrs: {
        pageSettings: {
          margin: 72,
          marginTop: 144,
          marginBottom: 72,
          marginLeft: 96,
          marginRight: 48,
        },
      },
    });
    expect(settings).toMatchObject({
      margin: 72,
      marginTop: 144,
      marginBottom: 72,
      marginLeft: 96,
      marginRight: 48,
    });
  });
  it("accepts a two-inch margin and refuses 4 inches or zero", () => {
    const two = documentPageSettings({
      type: "doc",
      attrs: { pageSettings: { margin: 192 } },
    });
    expect(two.marginLeft).toBe(192);
    expect(pageMarginsError(two)).toBeNull();
    expect(pageMarginError(192)).toBeNull();
    expect(pageMarginError(384)).toBe("A margin cannot be more than 3 inches.");
    expect(pageMarginError(0)).toBe("A margin must be at least 0.25 inches.");
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
      pageNumberFormat: "letters",
      pageNumberPosition: "top-left",
    });
    expect(unknown.pageNumberFormat).toBe("fraction");
    expect(unknown.pageNumberPosition).toBe("bottom-right");
    expect(unknown.pageNumberPositionSet).toBe(false);
    expect(pageFace(unknown, 0, 2).pageNumber).toBe("1 / 2");
  });
  it("starts numbering at a chosen page and keeps a cover from counting", () => {
    const saved = (pageSettings: object) =>
      documentPageSettings({ type: "doc", attrs: { pageSettings } });
    const older = saved({ pageNumbers: true, footer: "Committee draft" });
    expect(older.pageNumberStart).toBe(1);
    expect(older.coverHasNoNumber).toBe(false);
    expect(pageFace(older, 0, 2).pageNumber).toBe("1 / 2");
    const started = saved({
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "bottom-center",
      pageNumberPositionSet: true,
      pageNumberStart: 4,
      footer: "Committee draft",
    });
    expect(started.pageNumberStart).toBe(4);
    expect(pageFace(started, 0, 2)).toMatchObject({
      footer: "Committee draft",
      numberSide: "center",
      pageNumber: "Page 4",
    });
    expect(pageFace(started, 1, 2)).toMatchObject({
      footer: "Committee draft",
      pageNumber: "Page 5",
    });
    expect(pageNumberHint(started)).toContain("Page 4");
    expect(pageNumberHint(started)).toContain("Page 5");
    const covered = saved({
      ...started,
      pageNumberStart: 4,
      coverHasNoNumber: true,
    });
    expect(covered.pageNumberStart).toBe(4);
    expect(covered.coverHasNoNumber).toBe(true);
    expect(pageFace(covered, 0, 2)).toMatchObject({
      footer: "Committee draft",
      numberSide: "none",
      pageNumber: "",
    });
    expect(pageFace(covered, 1, 2)).toMatchObject({
      footer: "Committee draft",
      numberSide: "center",
      pageNumber: "Page 1",
    });
    expect(pageFace(covered, 1, 2).pageNumber).not.toBe("Page 2");
    expect(pageNumberHint(covered)).toContain("Page 1");
    expect(pageNumberHint(covered)).toContain("Page 2");
    const hidden = { ...covered, pageNumbers: false };
    expect(hidden.pageNumberStart).toBe(4);
    expect(hidden.coverHasNoNumber).toBe(true);
    expect(pageFace(hidden, 0, 2)).toMatchObject({
      numberSide: "none",
      pageNumber: "",
      footer: "Committee draft",
    });
    expect(pageFace(hidden, 1, 2).pageNumber).toBe("");
    expect(pageFace({ ...hidden, pageNumbers: true }, 1, 2).pageNumber).toBe("Page 1");
    expect(saved({ pageNumberStart: 0 }).pageNumberStart).toBe(1);
    expect(saved({ pageNumberStart: 4.5 }).pageNumberStart).toBe(1);
    expect(saved({ pageNumberStart: "4" }).pageNumberStart).toBe(1);
    expect(saved({ pageNumberStart: 10000 }).pageNumberStart).toBe(1);
    const html = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "bottom-center",
      pageNumberPositionSet: true,
      pageNumberStart: 4,
      footer: "Committee draft",
    });
    expect(html).toContain("counter-reset: page 3;");
    expect(html).toContain('"Page " counter(page)');
    const coverHtml = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "bottom-center",
      pageNumberPositionSet: true,
      coverHasNoNumber: true,
      footer: "Committee draft",
    });
    expect(coverHtml).toContain("counter-reset: page -1;");
    expect(coverHtml).toContain("@page:first {");
    expect(coverHtml).toContain(
      '<footer class="page-footer">Committee draft</footer>',
    );
  });
  it("numbers the front in lowercase roman and restarts arabic at a heading", () => {
    expect(lowerRoman(1)).toBe("i");
    expect(lowerRoman(2)).toBe("ii");
    expect(lowerRoman(4)).toBe("iv");
    expect(lowerRoman(9)).toBe("ix");
    expect(lowerRoman(40)).toBe("xl");
    const saved = (pageSettings: object) =>
      documentPageSettings({ type: "doc", attrs: { pageSettings } });
    const roman = saved({
      pageNumbers: true,
      pageNumberFormat: "roman",
      pageNumberPosition: "bottom-center",
      pageNumberPositionSet: true,
      footer: "Draft",
      pageNumberStart: 1,
    });
    expect(roman.pageNumberFormat).toBe("roman");
    expect(pageFace(roman, 0, 4)).toMatchObject({
      footer: "Draft",
      numberSide: "center",
      pageNumber: "i",
    });
    expect(pageFace(roman, 1, 4).pageNumber).toBe("ii");
    expect(pageFace(roman, 2, 4).pageNumber).toBe("iii");
    expect(pageNumberHint(roman, 4)).toContain("“i”");
    expect(pageNumberHint(roman, 4)).not.toContain("Page i");
    const restarted = pageFace(roman, 2, 4, 2);
    expect(restarted).toMatchObject({ footer: "Draft", pageNumber: "1" });
    expect(pageFace(roman, 3, 4, 2)).toMatchObject({
      footer: "Draft",
      pageNumber: "2",
    });
    expect(pageFace(roman, 0, 4, 2).pageNumber).toBe("i");
    expect(pageFace(roman, 1, 4, 2).pageNumber).toBe("ii");
    const started = { ...roman, pageNumberStart: 4 };
    expect(pageFace(started, 0, 4).pageNumber).toBe("iv");
    expect(pageFace(started, 1, 4, 2).pageNumber).toBe("v");
    expect(pageFace(started, 2, 4, 2).pageNumber).toBe("1");
    const covered = { ...roman, coverHasNoNumber: true };
    expect(pageFace(covered, 0, 4, 2).pageNumber).toBe("");
    expect(pageFace(covered, 0, 4, 2).footer).toBe("Draft");
    expect(pageFace(covered, 1, 4, 2).pageNumber).toBe("i");
    expect(pageFace(covered, 2, 4, 2).pageNumber).toBe("1");
    const html = documentHtml("Report", "<p>Text</p>", roman);
    expect(html).toContain("counter(page, lower-roman)");
    expect(html).not.toContain('"Page " counter(page)');
    expect(html).toContain('<footer class="page-footer">Draft</footer>');
  });
});

describe("page number format chips", () => {
  it("uses 1 on a two-page file that starts at 1", () => {
    expect(pageNumberFormatChips(1, 2)).toEqual({
      fraction: "1 / 2",
      page: "Page 1",
      roman: "i, ii, iii",
    });
  });
  it("follows a start of 12, then 3, on a two-page file", () => {
    expect(pageNumberFormatChips(12, 2)).toEqual({
      fraction: "12 / 13",
      page: "Page 12",
      roman: "xii, xiii, xiv",
    });
    expect(pageNumberFormatChips(3, 2)).toEqual({
      fraction: "3 / 4",
      page: "Page 3",
      roman: "iii, iv, v",
    });
  });
  it("matches the number drawn on the first page", () => {
    for (const start of [1, 3, 12]) {
      const chips = pageNumberFormatChips(start, 2);
      const shared = {
        ...defaultPageSettings,
        pageNumbers: true,
        pageNumberPosition: "top-right" as const,
        pageNumberPositionSet: true,
        pageNumberStart: start,
      };
      expect(
        pageFace({ ...shared, pageNumberFormat: "page" }, 0, 2).pageNumber,
      ).toBe(chips.page);
      expect(
        pageFace({ ...shared, pageNumberFormat: "fraction" }, 0, 2).pageNumber,
      ).toBe(chips.fraction);
    }
  });
  it("lists three roman pages from the start", () => {
    expect(pageNumberFormatChips(1, 2).roman).toBe("i, ii, iii");
    expect(pageNumberFormatChips(4, 2).roman).toBe("iv, v, vi");
    expect(pageNumberFormatChips(12, 2).roman).toBe("xii, xiii, xiv");
    const started = {
      ...defaultPageSettings,
      pageNumbers: true,
      pageNumberFormat: "roman" as const,
      pageNumberStart: 4,
    };
    expect(pageFace(started, 0, 2).pageNumber).toBe("iv");
    expect(pageFace(started, 1, 2).pageNumber).toBe("v");
    expect(pageNumberFormatChips(4, 2).roman.startsWith("iv, v")).toBe(true);
    expect(pageNumberFormatChips(4, 2)).toMatchObject({
      fraction: "4 / 5",
      page: "Page 4",
    });
    expect(pageNumberFormatChips(12, 2)).toMatchObject({
      fraction: "12 / 13",
      page: "Page 12",
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
    expect(html).toContain("[data-page-break] { break-before: page; }");
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
