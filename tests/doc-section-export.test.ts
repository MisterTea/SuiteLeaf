import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { defaultPageSettings, documentHtml } from "../packages/core/src/document-layout";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("section break export", () => {
  it("starts a new Word page and keeps the section header, footer, and restart", async () => {
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Club",
          footer: "Draft",
          pageNumbers: true,
        },
      },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before the break" }] },
        {
          type: "sectionBreak",
          attrs: { header: "Appendix", footer: "Notes", restartAt: 3 },
        },
        { type: "paragraph", content: [{ type: "text", text: "After the break" }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("Before the break");
    expect(doc).toContain("After the break");
    expect(doc).not.toContain("<w:p/>");
    expect(doc).toContain('w:val="nextPage"');
    expect(doc).toContain('w:start="3"');
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/header\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(headers.some((xml) => xml.includes("Club"))).toBe(true);
    expect(headers.some((xml) => xml.includes("Appendix"))).toBe(true);
    const footers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(footers.some((xml) => xml.includes("Draft"))).toBe(true);
    expect(footers.some((xml) => xml.includes("Notes"))).toBe(true);
  });

  it("keeps the document header when a section header is blank", async () => {
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: { pageSettings: { header: "Club", footer: "Draft", pageNumbers: true } },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before the break" }] },
        { type: "sectionBreak", attrs: { header: "", footer: "Only footer", restartAt: null } },
        { type: "paragraph", content: [{ type: "text", text: "After the break" }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain('w:val="nextPage"');
    expect(doc).not.toContain("<w:p/>");
    expect(doc).not.toContain('w:start="1"');
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/header\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(headers.every((xml) => xml.includes("Club"))).toBe(true);
    const footers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(footers.some((xml) => xml.includes("Only footer"))).toBe(true);
  });

  it("starts a new HTML page and keeps the section header, footer, and restart", () => {
    const html = documentHtml(
      "Minutes",
      '<p>Front</p><div data-section-break="true" data-header="A &amp; B" data-footer="Notes" data-restart-at="4" class="section-break">Section break</div><p>After</p>',
      { ...defaultPageSettings, header: "Club", footer: "Draft", pageNumbers: true },
    );
    expect(html).toContain("[data-section-break] { break-before: page; }");
    expect(html).toContain('<header class="section-header">A &amp; B</header>');
    expect(html).toContain('<footer class="section-footer">Notes</footer>');
    expect(html).toContain("counter-reset: page 3");
    const front = html.indexOf("<p>Front</p>");
    const sectionHeader = html.indexOf('<header class="section-header">');
    const after = html.indexOf("<p>After</p>");
    expect(sectionHeader).toBeGreaterThan(front);
    expect(after).toBeGreaterThan(sectionHeader);
  });

  it("draws header and footer pictures in HTML and Word", async () => {
    const html = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      header: "Club",
      footer: "Draft",
      headerImage: png,
      footerImage: png,
    });
    expect(html).toContain(
      `<header class="page-header"><img class="page-furniture-image" src="${png}" alt="">Club</header>`,
    );
    expect(html).toContain(
      `<footer class="page-footer"><img class="page-furniture-image" src="${png}" alt="">Draft</footer>`,
    );
    const pictureOnly = documentHtml("Minutes", "<p>Text</p>", {
      ...defaultPageSettings,
      headerImage: png,
    });
    expect(pictureOnly).toContain(`<img class="page-furniture-image" src="${png}" alt="">`);
    expect(pictureOnly).toContain("<header");

    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Club",
          footer: "Draft",
          headerImage: png,
          footerImage: png,
        },
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Minutes" }] }],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const header = await zip.file("word/header1.xml")!.async("string");
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(header).toContain("Club");
    expect(header).toContain("<w:drawing");
    expect(footer).toContain("Draft");
    expect(footer).toContain("<w:drawing");
  });

  it("stops a restarted section fraction at that section in Word", async () => {
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraph = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Club",
          footer: "Draft",
          pageNumbers: true,
          pageNumberFormat: "fraction",
        },
      },
      content: [
        paragraph("Front one"),
        { type: "pageBreak" },
        paragraph("Front two"),
        {
          type: "sectionBreak",
          attrs: { header: "Notes", footer: "End", restartAt: 1 },
        },
        paragraph("Section one"),
        { type: "pageBreak" },
        paragraph("Section two"),
        {
          type: "sectionBreak",
          attrs: { header: "Appendix", footer: "Back", restartAt: 1 },
        },
        paragraph("After one"),
        { type: "pageBreak" },
        paragraph("After two"),
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const footers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map(async (name) => ({ name, xml: await zip.file(name)!.async("string") })),
    );
    const draft = footers.find((part) => part.xml.includes("Draft"));
    const notes = footers.find((part) => part.xml.includes("End"));
    const appendix = footers.find((part) => part.xml.includes("Back"));
    expect(draft?.xml).toContain("NUMPAGES");
    expect(notes?.xml).toBeTruthy();
    expect(notes?.xml).not.toContain("NUMPAGES");
    expect(notes?.xml).toMatch(/<w:t[^>]*>2<\/w:t>/);
    expect(appendix?.xml).not.toContain("NUMPAGES");
    expect(appendix?.xml).toMatch(/<w:t[^>]*>2<\/w:t>/);
  });

  it("stops a restarted section fraction at that section in HTML", () => {
    const html = documentHtml(
      "Minutes",
      [
        "<p>Front one</p>",
        '<div data-page-break="true"></div>',
        "<p>Front two</p>",
        '<div data-section-break="true" data-header="Notes" data-restart-at="1" class="section-break">Section break</div>',
        "<p>Section one</p>",
        '<div data-page-break="true"></div>',
        "<p>Section two</p>",
        '<div data-section-break="true" data-header="Appendix" data-restart-at="1" class="section-break">Section break</div>',
        "<p>After one</p>",
        '<div data-page-break="true"></div>',
        "<p>After two</p>",
      ].join(""),
      { ...defaultPageSettings, header: "Club", footer: "Draft", pageNumbers: true },
    );
    expect(html).toContain('counter(page) " / " counter(pages)');
    expect(html).toContain('counter(page) " / " "2"');
    const notes = html.indexOf("Notes");
    const sectionTotal = html.indexOf('counter(page) " / " "2"');
    expect(sectionTotal).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(-1);
  });

  it("counts a restarted section that flows onto a second page", async () => {
    const flowed = "A long paragraph remains editable across page boundaries. ".repeat(90);
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          pageNumbers: true,
          pageNumberFormat: "fraction",
        },
      },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Front" }] },
        {
          type: "sectionBreak",
          attrs: { header: "Notes", footer: "End", restartAt: 1 },
        },
        { type: "paragraph", content: [{ type: "text", text: flowed }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const footers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map(async (name) => ({ name, xml: await zip.file(name)!.async("string") })),
    );
    const notes = footers.find((part) => part.xml.includes("End"));
    expect(notes?.xml).toBeTruthy();
    expect(notes?.xml).not.toContain("NUMPAGES");
    // No manual page break. On screen this section fills two pages, so the total is 2.
    expect(notes?.xml).toMatch(/<w:t[^>]*>2<\/w:t>/);
    expect(notes?.xml).not.toMatch(/<w:t[^>]*>1<\/w:t>/);
  });

  it("counts flowed pages in a restarted HTML section fraction", () => {
    const flowed = "A long paragraph remains editable across page boundaries. ".repeat(90);
    const html = documentHtml(
      "Minutes",
      `<p>Front</p><div data-section-break="true" data-header="Notes" data-footer="End" data-restart-at="1" class="section-break">Section break</div><p>${flowed}</p>`,
      { ...defaultPageSettings, pageNumbers: true, pageNumberFormat: "fraction" },
    );
    expect(html).toContain('counter(page) " / " "2"');
    expect(html).not.toContain('counter(page) " / " "1"');
  });

  it("exports a section break stored inside columns as a new page and section", async () => {
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: { pageSettings: { header: "Club", footer: "Draft", pageNumbers: true } },
      content: [
        {
          type: "columnLayout",
          attrs: { columns: 2 },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Before" }] },
            {
              type: "sectionBreak",
              attrs: { header: "Appendix", footer: "Notes", restartAt: 1 },
            },
            { type: "paragraph", content: [{ type: "text", text: "After" }] },
          ],
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("Before");
    expect(doc).toContain("After");
    expect(doc.indexOf("Before")).toBeLessThan(doc.indexOf("After"));
    expect(doc).toContain('w:val="nextPage"');
    expect(doc).toContain('w:start="1"');
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/header\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(headers.some((xml) => xml.includes("Appendix"))).toBe(true);
    const footers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(footers.some((xml) => xml.includes("Notes"))).toBe(true);
  });

  it("lifts a stored section break out of the HTML columns", () => {
    const html = documentHtml(
      "Minutes",
      '<div class="doc-columns" data-columns="2"><p>Before</p><div data-section-break="true" data-header="Appendix" data-footer="Notes" data-restart-at="1" class="section-break">Section break</div><p>After</p></div>',
      { ...defaultPageSettings, header: "Club", footer: "Draft", pageNumbers: true },
    );
    const before = html.indexOf("<p>Before</p>");
    const section = html.indexOf('data-section-break="true"');
    const after = html.indexOf("<p>After</p>");
    expect(before).toBeGreaterThan(-1);
    expect(section).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(section);
    expect(html.indexOf("</div>", before)).toBeLessThan(section);
    expect(html).toContain('<header class="section-header">Appendix</header>');
    expect(html).toContain("break-before: page");
    expect(html).toContain("counter-reset: page 0");
  });

  it("converts a WebP header and footer picture instead of dropping it", async () => {
    const webp =
      "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
    vi.stubGlobal("document", {
      createElement(tag: string) {
        if (tag === "img")
          return { src: "", naturalWidth: 8, naturalHeight: 8, decode: async () => {} };
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toDataURL: () => png,
        };
      },
    });
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Club",
          footer: "Draft",
          headerImage: webp,
          footerImage: webp,
        },
      },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Minutes" }] }],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const header = await zip.file("word/header1.xml")!.async("string");
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(header).toContain("Club");
    expect(header).toContain("<w:drawing");
    expect(footer).toContain("Draft");
    expect(footer).toContain("<w:drawing");
  });

  it("places each section footer at the bottom of that section", () => {
    const html = documentHtml(
      "Minutes",
      [
        "<p>Front</p>",
        '<div data-section-break="true" data-header="Notes" data-footer="End notes" data-restart-at="1" class="section-break">Section break</div>',
        "<p>Section body</p>",
        '<div data-section-break="true" data-header="Appendix" data-footer="Back" data-restart-at="1" class="section-break">Section break</div>',
        "<p>Appendix body</p>",
      ].join(""),
      { ...defaultPageSettings, pageNumbers: true },
    );
    const body = html.indexOf("<p>Section body</p>");
    const notes = html.indexOf('<footer class="section-footer">End notes</footer>');
    const appendix = html.indexOf("<p>Appendix body</p>");
    const back = html.indexOf('<footer class="section-footer">Back</footer>');
    expect(notes).toBeGreaterThan(body);
    expect(appendix).toBeGreaterThan(notes);
    expect(back).toBeGreaterThan(appendix);
    expect(html).toMatch(/\.section-footer \{[^}]*position: absolute[^}]*bottom:/);
  });
});
