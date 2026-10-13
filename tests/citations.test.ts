import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  bibliographyPlain,
  citedSources,
  citationsImportSummary,
  inText,
  type CitationSource,
} from "../packages/core/src/citations";
import { documentText } from "../packages/core/src/word";
import { importOffice } from "../packages/core/src/office";

const mensah: CitationSource = {
  id: "mensah",
  tag: "Men24",
  guid: "{11111111-1111-1111-1111-111111111111}",
  kind: "book",
  author: "Mensah",
  title: "Youth football in Accra",
  year: "2024",
  page: "",
};
const boateng: CitationSource = {
  id: "boateng",
  tag: "Boa23",
  guid: "{22222222-2222-2222-2222-222222222222}",
  kind: "article",
  author: "Boateng",
  title: "Coaching hours",
  year: "2023",
  page: "",
};
const unused: CitationSource = {
  id: "unused",
  tag: "Adu20",
  guid: "{33333333-3333-3333-3333-333333333333}",
  kind: "book",
  author: "Adu",
  title: "Unused notes",
  year: "2020",
  page: "",
};

function paragraph(content: JsonNode[]): JsonNode {
  return { type: "paragraph", content };
}
function text(value: string): JsonNode {
  return { type: "text", text: value };
}
function walk(node: JsonNode, out: JsonNode[] = []): JsonNode[] {
  out.push(node);
  node.content?.forEach((child) => walk(child, out));
  return out;
}

function reportDoc(year = "2024"): JsonNode {
  const sources = [
    { ...mensah, year },
    boateng,
    unused,
  ];
  return {
    type: "doc",
    attrs: { citationStyle: "apa", citationSources: sources },
    content: [
      { type: "heading", attrs: { level: 1 }, content: [text("Results")] },
      {
        type: "tableOfContents",
        attrs: { pageNumbers: true, maxLevel: 3 },
      },
      paragraph([
        text("Attendance rose 40% "),
        { type: "citation", attrs: { sourceId: "mensah" } },
        text("."),
      ]),
      { type: "heading", attrs: { level: 1 }, content: [text("Coaching")] },
      paragraph([
        text("The extra coaching hours changed the season "),
        { type: "citation", attrs: { sourceId: "boateng" } },
        text("."),
      ]),
      paragraph([
        text("The Saturday league filed its return"),
        { type: "noteReference", attrs: { id: "fn1", kind: "footnote", label: "1" } },
        text("."),
      ]),
      {
        type: "note",
        attrs: { id: "fn1", kind: "footnote", label: "1" },
        content: [paragraph([text("League register, 2025.")])],
      },
      { type: "bibliography" },
    ],
  };
}

describe("citations and bibliography", () => {
  it("formats APA, MLA, and Chicago without a page placeholder", () => {
    expect(inText(mensah, "apa")).toBe("(Mensah, 2024)");
    expect(inText(mensah, "mla")).toBe("(Mensah)");
    expect(inText(mensah, "chicago")).toBe("(Mensah 2024)");
    expect(inText({ ...mensah, page: "12" }, "apa")).toBe("(Mensah, 2024, p. 12)");
    expect(inText(mensah, "apa")).not.toContain("#");
    expect(inText({ ...mensah, page: "" }, "mla")).not.toContain("#");
    expect(bibliographyPlain(mensah, "apa")).toBe(
      "Mensah. (2024). Youth football in Accra.",
    );
    expect(bibliographyPlain(boateng, "apa")).toBe("Boateng. (2023). Coaching hours.");
    expect(bibliographyPlain(mensah, "mla")).toBe(
      "Mensah. Youth football in Accra. 2024.",
    );
    expect(bibliographyPlain(boateng, "chicago")).toBe('Boateng. 2023. "Coaching hours."');
    expect(citationsImportSummary({ citations: 2, bibliographies: 1 })).toBe(
      "2 citations, 1 bibliography",
    );
  });

  it("lists cited sources in alphabetical order and omits a source that is never cited", () => {
    const doc = reportDoc();
    const listed = citedSources(doc, [mensah, boateng, unused]).map(
      (source) => source.author,
    );
    expect(listed).toEqual(["Boateng", "Mensah"]);
  });

  it("round-trips citations, the bibliography, and the sources Word reads", async () => {
    const file = createFile("doc", "Grant report 2026");
    if (file.kind !== "doc") throw new Error();
    file.content = reportDoc("2022");
    const bytes = await exportDocx(file);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const names = Object.keys(zip.files).filter((name) =>
      /^customXml\/item\d+\.xml$/.test(name),
    );
    expect(names.length).toBeGreaterThan(0);
    const sourcesXml = await zip.file(names[0])!.async("string");
    expect(documentXml).toMatch(/CITATION\s+Men24/);
    expect(documentXml).toMatch(/CITATION\s+Boa23/);
    expect(documentXml).toMatch(/BIBLIOGRAPHY/);
    expect(documentXml).not.toContain("SLBIBFIELD");
    expect(documentXml).not.toContain("#");
    expect(documentXml).toMatch(/<w:footnoteReference\b/);
    expect(documentXml).toMatch(/\bTOC\b/);
    expect(await zip.file("word/footnotes.xml")!.async("string")).toContain(
      "League register, 2025.",
    );
    expect(sourcesXml).toContain("Mensah");
    expect(sourcesXml).toContain("Youth football in Accra");
    expect(sourcesXml).toContain("2022");
    expect(sourcesXml).toContain("Boateng");
    expect(sourcesXml).toContain("Coaching hours");
    expect(sourcesXml).toContain("2023");
    expect(sourcesXml).toContain("Unused notes");
    expect(sourcesXml).toContain("2006/bibliography");

    const { file: back, report } = await importOffice(
      bytes,
      "docx",
      "Grant report 2026.docx",
    );
    expect(report.warnings).toContain("2 citations, 1 bibliography");
    expect(report.warnings).toContain("1 footnote, 1 table of contents");
    expect(report.stats.recoveredParagraphs).toBe(0);
    expect(back.kind).toBe("doc");
    if (back.kind !== "doc") return;
    const nodes = walk(back.content);
    const citations = nodes.filter((node) => node.type === "citation");
    expect(citations.map((node) => node.attrs?.sourceId)).toEqual(["Men24", "Boa23"]);
    expect(nodes.some((node) => node.type === "bibliography")).toBe(true);
    expect(nodes.some((node) => node.type === "tableOfContents")).toBe(true);
    expect(nodes.some((node) => node.type === "noteReference")).toBe(true);
    const library = back.content.attrs?.citationSources as CitationSource[];
    expect(library.map((source) => [source.author, source.title, source.year])).toEqual([
      ["Mensah", "Youth football in Accra", "2022"],
      ["Boateng", "Coaching hours", "2023"],
      ["Adu", "Unused notes", "2020"],
    ]);
    const updated = {
      ...back.content,
      attrs: {
        ...back.content.attrs,
        citationSources: library.map((source) =>
          source.author === "Boateng" ? { ...source, year: "2021" } : source,
        ),
      },
    };
    expect(documentText(updated)).toContain("(Mensah, 2022)");
    expect(documentText(updated)).toContain("(Boateng, 2021)");
    const places = nodes.filter(
      (node) =>
        node.type === "paragraph" &&
        node.content?.some((child) => child.type === "citation"),
    );
    expect(places[0].content?.map((child) => child.text ?? child.attrs?.sourceId)).toEqual([
      "Attendance rose 40% ",
      "Men24",
      ".",
    ]);
    expect(places[1].content?.map((child) => child.text ?? child.attrs?.sourceId)).toEqual([
      "The extra coaching hours changed the season ",
      "Boa23",
      ".",
    ]);
    expect(documentText(back.content)).not.toContain("SLCITE");
    expect(documentText(back.content)).not.toContain("SLBIB");
    const listed = citedSources(back.content, library).map((source) => source.title);
    expect(listed).toEqual(["Coaching hours", "Youth football in Accra"]);
    expect(listed).not.toContain("Unused notes");
  });
});
