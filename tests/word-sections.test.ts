import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { JsonNode } from "../packages/core/src/index";
import {
  firstSectionXml,
  insertWordSectionBreaks,
  sectionAnchors,
  sectionRestart,
  sectionStart,
  wordSectionProperties,
} from "../packages/core/src/word-sections";

const para = (text: string, sect = "") => `<w:p>${sect ? `<w:pPr>${sect}</w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const sect = (inner: string) => `<w:sectPr>${inner}</w:sectPr>`;
const header = (id: string) => `<w:headerReference w:type="default" r:id="${id}"/>`;
const footer = (id: string) => `<w:footerReference w:type="default" r:id="${id}"/>`;
const body = (parts: string) => `<w:document><w:body>${parts}</w:body></w:document>`;
const doc = (...texts: string[]): JsonNode => ({
  type: "doc",
  content: texts.map((text) => (text === "|" ? { type: "pageBreak" } : { type: "paragraph", content: [{ type: "text", text }] })),
});

async function zipWith(parts: Record<string, string>): Promise<JSZip> {
  const zip = new JSZip();
  const rels = Object.keys(parts)
    .map((name, i) => `<Relationship Id="r${i + 1}" Target="${name.replace(/^word\//, "")}"/>`)
    .join("");
  zip.file("word/_rels/document.xml.rels", `<Relationships>${rels}</Relationships>`);
  for (const [name, text] of Object.entries(parts)) zip.file(name, `<w:hdr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`);
  return zip;
}

describe("Word sections", () => {
  it("reads section properties in order and their start, restart, and first section", () => {
    const xml = body(`${para("A", sect('<w:type w:val="continuous"/>'))}${para("B")}<w:sectPr><w:pgNumType w:start="5"/></w:sectPr>`);
    const sects = wordSectionProperties(xml);
    expect(sects).toHaveLength(2);
    expect(sectionStart(sects[0]!)).toBe("continuous");
    expect(sectionStart(sects[1]!)).toBe("nextPage");
    expect(sectionRestart(sects[1]!)).toBe(5);
    expect(sectionRestart(sects[0]!)).toBeNull();
    expect(firstSectionXml(xml)).toBe('<w:type w:val="continuous"/>');
    expect(firstSectionXml("<w:document/>")).toBe("");
    expect(sectionAnchors(xml)).toEqual(["B"]);
  });

  it("puts a break with the section's header, an inherited footer, and its restart where the section starts", async () => {
    const zip = await zipWith({ "word/header1.xml": "Club", "word/footer1.xml": "Page", "word/header2.xml": "Appendix" });
    const xml = body(`${para("Intro", sect(header("r1") + footer("r2")))}${para("Appendix starts")}${sect(header("r3") + '<w:pgNumType w:start="1"/>')}`);
    const content = doc("Intro", "|", "Appendix starts here");
    expect(await insertWordSectionBreaks(content, xml, zip)).toEqual([]);
    expect(content.content!.map((node) => node.type)).toEqual(["paragraph", "sectionBreak", "paragraph"]);
    expect(content.content![1]!.attrs).toEqual({ header: "Appendix", footer: "Page", restartAt: 1 });
  });

  it("skips a continuous section, reports one it cannot place, and reports a different orientation", async () => {
    const zip = await zipWith({});
    const xml = body(
      `${para("One", sect('<w:type w:val="continuous"/>'))}${para("Two", sect(""))}${para("Nowhere")}${sect('<w:pgSz w:orient="landscape"/>')}`,
    );
    const content = doc("One", "Two");
    expect(await insertWordSectionBreaks(content, xml, zip)).toEqual([
      "1 Word section break was not placed, so its header and footer were not kept.",
      "1 Word section uses a different page orientation. SuiteLeaf uses one orientation for the whole document.",
    ]);
    // "Two" is a one-paragraph section, and its break goes in front of it.
    expect(content.content!.map((node) => node.type)).toEqual(["paragraph", "sectionBreak", "paragraph"]);
  });

  it("leaves a one-section document alone", async () => {
    const content = doc("Only");
    expect(await insertWordSectionBreaks(content, body(`${para("Only")}${sect("")}`), await zipWith({}))).toEqual([]);
    expect(content.content).toHaveLength(1);
  });
});
