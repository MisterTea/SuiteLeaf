import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  defaultPageSettings,
  documentHtml,
} from "../packages/core/src/document-layout";
import {
  exportTabSections,
  exportTabsBodyHtml,
  exportTabsPlainText,
} from "../apps/web/src/editors/doc-export-tabs";
import { documentPlainText } from "../apps/web/src/editors/doc-text";

const paragraph = (text: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const agenda = {
  type: "doc",
  content: [paragraph("Call to order. Treasurer's report.")],
};
const minutes = {
  type: "doc",
  content: [paragraph("Voted to buy compost.")],
};

function render(doc: JsonNode): string {
  return (doc.content ?? [])
    .map((block) => {
      const text = (block.content ?? []).map((node) => node.text ?? "").join("");
      return `<p>${text}</p>`;
    })
    .join("");
}

function expectOrder(text: string, parts: string[]) {
  let at = -1;
  for (const part of parts) {
    const next = text.indexOf(part, at + 1);
    expect(next, part).toBeGreaterThan(at);
    at = next;
  }
}

describe("export tab labels", () => {
  it("labels every tab when there are two", () => {
    const sections = exportTabSections(
      { title: "Agenda", content: agenda },
      [{ title: "Minutes", content: minutes }],
    );
    expect(sections.map((section) => section.label)).toEqual(["Agenda", "Minutes"]);
    expect(sections[0].content).toBe(agenda);
    expect(sections[1].content).toBe(minutes);
  });

  it("labels a first tab that is still named Document when another tab exists", () => {
    const sections = exportTabSections(
      { content: agenda },
      [{ title: "Minutes", content: minutes }],
    );
    expect(sections.map((section) => section.label)).toEqual(["Document", "Minutes"]);
  });

  it("does not label a lone tab named Document", () => {
    for (const title of [undefined, "Document", "  Document  "]) {
      const sections = exportTabSections({ title, content: agenda });
      expect(sections).toEqual([{ content: agenda }]);
      expect(sections[0].label).toBeUndefined();
    }
  });

  it("labels a lone tab that was renamed", () => {
    const sections = exportTabSections({ title: "  Agenda  ", content: agenda });
    expect(sections).toEqual([{ label: "Agenda", content: agenda }]);
  });
});

describe("plain text, HTML, and Word export of tabs", () => {
  const labeled = exportTabSections(
    { title: "Agenda", content: agenda },
    [{ title: "Minutes", content: minutes }],
  );

  it("writes a blank line, the name, a blank line, then the text", () => {
    expect(exportTabsPlainText(labeled)).toBe(
      "\ufeff\r\nAgenda\r\n\r\nCall to order. Treasurer's report.\r\n\r\nMinutes\r\n\r\nVoted to buy compost.",
    );
    expectOrder(exportTabsPlainText(labeled), [
      "Agenda",
      "Call to order",
      "Minutes",
      "compost",
    ]);
  });

  it("leaves a one-tab Document file as the body alone", () => {
    const sections = exportTabSections({ content: agenda });
    expect(exportTabsPlainText(sections)).toBe(documentPlainText(agenda));
    expect(exportTabsPlainText(sections)).not.toContain("Document");
    const html = exportTabsBodyHtml(sections, (doc) => render(doc));
    expect(html).toBe("<p>Call to order. Treasurer's report.</p>");
    expect(html).not.toContain("Document");
    expect(html).not.toContain("<h1>");
  });

  it("includes both names and both sentences in the web page", () => {
    const body = exportTabsBodyHtml(labeled, (doc) => render(doc));
    const html = documentHtml("October meeting", body, defaultPageSettings);
    expectOrder(html, [
      "<h1>Agenda</h1>",
      "Call to order",
      "<h1>Minutes</h1>",
      "compost",
    ]);
    const renamed = exportTabSections({ title: "Agenda", content: agenda });
    expect(exportTabsBodyHtml(renamed, (doc) => render(doc))).toContain(
      "<h1>Agenda</h1>",
    );
  });

  it("writes a heading and both tabs into a Word file", async () => {
    const zip = await JSZip.loadAsync(
      await exportDocx({
        title: "October meeting",
        content: agenda,
        sections: labeled.map((section) => ({
          title: section.label,
          content: section.content,
        })),
      }),
    );
    const xml = await zip.file("word/document.xml")!.async("string");
    expectOrder(xml, ["Agenda", "Call to order", "Minutes", "compost"]);
    expect(xml.match(/Heading1/g)?.length).toBe(2);
  });

  it("labels a renamed one-tab Word file and leaves a Document file bare", async () => {
    const renamed = await JSZip.loadAsync(
      await exportDocx({
        title: "October meeting",
        content: agenda,
        sections: [{ title: "Agenda", content: agenda }],
      }),
    );
    const renamedXml = await renamed.file("word/document.xml")!.async("string");
    expectOrder(renamedXml, ["Agenda", "Call to order"]);
    expect(renamedXml).toContain("Heading1");

    const bare = await JSZip.loadAsync(
      await exportDocx({ title: "Notes", content: agenda }),
    );
    const bareXml = await bare.file("word/document.xml")!.async("string");
    expect(bareXml).toContain("Call to order");
    expect(bareXml).not.toContain("Heading1");
    expect(bareXml).not.toContain(">Document<");
  });
});
