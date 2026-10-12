import { describe, expect, it } from "vitest";
import {
  defaultPageSettings,
  documentHtml,
  documentPageSettings,
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
    expect(html).toContain('counter(page) " / " counter(pages)');
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
