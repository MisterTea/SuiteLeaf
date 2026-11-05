import { CITATION_TAG, citeToken, rewriteWordCitations } from "../packages/core/src/citations";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  bibliographyFull,
  bibliographyPlain,
  bibliographyXml,
  citationLibrary,
  citationWarnings,
  citedSources,
  citationsImportSummary,
  inText,
  parseBibliographyXml,
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
  it("keeps a source tag with accents or punctuation, and the next word stays apart", () => {
    expect(CITATION_TAG.exec(" CITATION Día19 \\l 3082 ")?.[1]).toBe("Día19");
    expect(CITATION_TAG.exec(" CITATION O'Br-2020 \\l 1033 ")?.[1]).toBe("O'Br-2020");
    expect(citeToken("Día19")).toBe(`SLCITE${Buffer.from("Día19").toString("hex")}SLCE`);
    const { xml } = rewriteWordCitations(
      '<w:p><w:r><w:t xml:space="preserve">Soil </w:t></w:r><w:fldSimple w:instr=" CITATION Día19 \\l 3082 "><w:r><w:t>(Díaz)</w:t></w:r></w:fldSimple><w:r><w:t>abc</w:t></w:r></w:p>',
    );
    expect(xml).toContain(`${citeToken("Día19")}</w:t>`);
    expect(xml).not.toContain("(Díaz)");
  });

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

  it("names a citation whose source is missing and where it sits", () => {
    const doc: JsonNode = {
      type: "doc",
      content: [
        paragraph([text("Beds")]),
        paragraph([{ type: "citation", attrs: { sourceId: "gone" } }]),
        paragraph([{ type: "citation", attrs: { sourceId: "mensah" } }]),
      ],
    };
    expect(citationWarnings(doc, [mensah])).toEqual([
      {
        path: [1, 0],
        sourceId: "gone",
        message:
          "No source is stored for “gone”. Choose a source or remove this citation.",
      },
    ]);
    expect(doc.content?.[1].content?.[0].type).toBe("citation");
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

  it("names every author in the citation and the Word list", () => {
    const garden: CitationSource = {
      ...mensah,
      author: "Ada",
      authors: ["Ada", "Lin", "Noor"],
      doi: "secret-value",
    };
    expect(inText(garden, "apa")).toBe("(Ada et al., 2024)");
    expect(inText(garden, "apa")).not.toContain("secret-value");
    expect(bibliographyPlain(garden, "apa")).toBe(
      "Ada, Lin, and Noor. (2024). Youth football in Accra.",
    );
    expect(bibliographyPlain(garden, "apa")).not.toContain("secret-value");
    expect(bibliographyFull(garden, "apa")).toBe(
      "Ada, Lin, and Noor. (2024). Youth football in Accra. https://doi.org/secret-value",
    );
    expect(inText(garden, "apa")).not.toContain("https://doi.org");
    const before = JSON.stringify(garden);
    bibliographyFull(garden, "apa");
    expect(JSON.stringify(garden)).toBe(before);
    expect(inText(mensah, "apa")).toBe("(Mensah, 2024)");
    const again = parseBibliographyXml(bibliographyXml([garden], "apa"));
    expect(again.sources[0]?.authors).toEqual(["Ada", "Lin", "Noor"]);
    expect(again.sources[0]?.author).toBe("Ada");
    expect(JSON.stringify(again)).not.toContain("secret-value");
    expect(garden.authors).toEqual(["Ada", "Lin", "Noor"]);
  });

  it("writes a reversed page range in order and leaves the stored pages", () => {
    const source: CitationSource = { ...mensah, journal: "Beds", pages: "12--4" };
    const before = JSON.stringify(source);
    expect(bibliographyFull(source, "apa")).toBe(
      "Mensah. (2024). Youth football in Accra. Beds, 4--12.",
    );
    expect(bibliographyFull(source, "apa")).not.toContain("12--4");
    expect(JSON.stringify(source)).toBe(before);
    expect(bibliographyFull({ ...mensah, pages: "4--12" }, "apa")).toContain("4--12.");
  });

  it("adds an access date to the full entry and leaves a date that is not a day out", () => {
    const source: CitationSource = {
      ...mensah,
      doi: "10.1000/bed",
      accessed: "2024-03-01",
    };
    expect(bibliographyFull(source, "apa")).toBe(
      "Mensah. (2024). Youth football in Accra. https://doi.org/10.1000/bed Accessed 2024-03-01.",
    );
    expect(bibliographyPlain(source, "apa")).not.toContain("Accessed");
    expect(inText(source, "apa")).not.toContain("2024-03-01");
    const impossible: CitationSource = { ...mensah, accessed: "2026-02-31" };
    expect(bibliographyFull(impossible, "apa")).toBe(bibliographyPlain(impossible, "apa"));
    expect(bibliographyFull(impossible, "apa")).not.toContain("2026-02-31");
    const bad: CitationSource = { ...mensah, accessed: "secret-value" };
    expect(bibliographyFull(bad, "apa")).toBe(bibliographyPlain(bad, "apa"));
    expect(bibliographyFull(bad, "apa")).not.toContain("secret-value");
    const article: CitationSource = {
      ...mensah,
      kind: "article",
      journal: "Garden Journal",
      volume: "12",
      pages: "4-9",
      doi: "10.1000/bed",
    };
    expect(bibliographyFull(article, "apa")).toBe(
      "Mensah. (2024). Youth football in Accra. Garden Journal, 12, 4-9. https://doi.org/10.1000/bed",
    );
    expect(bibliographyPlain(article, "apa")).not.toContain("Garden Journal");
    expect(inText(article, "apa")).not.toContain("Garden Journal");
    expect(article.journal).toBe("Garden Journal");
    expect(bad.accessed).toBe("secret-value");
  });

  it("writes the full bibliography line into the Word file", async () => {
    const article: CitationSource = {
      ...mensah,
      kind: "article",
      journal: "Garden Journal",
      volume: "12",
      pages: "4-9",
      doi: "10.1000/bed",
      accessed: "2024-03-01",
    };
    const hidden: CitationSource = { ...article, id: "hidden", accessed: "secret-value", doi: undefined, journal: undefined, volume: undefined, pages: undefined };
    const file = createFile("doc", "Grant report 2026");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: { citationStyle: "apa", citationSources: [article, hidden] },
      content: [
        paragraph([text("See "), { type: "citation", attrs: { sourceId: "mensah" } }, text(".")]),
        { type: "bibliography" },
      ],
    };
    const bytes = await exportDocx(file);
    const xml = await JSZip.loadAsync(bytes).then((zip) => zip.file("word/document.xml")!.async("string"));
    expect(xml).toContain("Garden Journal, 12, 4-9.");
    expect(xml).toContain("https://doi.org/10.1000/bed");
    expect(xml).toContain("Accessed 2024-03-01.");
    expect(xml).not.toContain("secret-value");
    const citation = xml.slice(0, xml.indexOf("BIBLIOGRAPHY"));
    expect(citation).not.toContain("Garden Journal");
    expect(article.journal).toBe("Garden Journal");
  });

  it("names every editor in the full entry and not in the citation", () => {
    const garden: CitationSource = {
      ...mensah,
      editor: "secret-value",
      editors: ["Priya", "Sam"],
    };
    expect(inText(garden, "apa")).toBe("(Mensah, 2024)");
    expect(bibliographyPlain(garden, "apa")).toBe("Mensah. (2024). Youth football in Accra.");
    expect(bibliographyPlain(garden, "apa")).not.toContain("Priya");
    expect(bibliographyFull(garden, "apa")).toBe(
      "Mensah. (2024). Youth football in Accra. Edited by Priya and Sam.",
    );
    expect(bibliographyFull(garden, "apa")).not.toContain("secret-value");
    const broken: CitationSource = { ...mensah, editor: "secret\nvalue" };
    expect(bibliographyFull(broken, "apa")).toBe(bibliographyPlain(broken, "apa"));
    expect(bibliographyFull(broken, "apa")).not.toContain("secret");
    const again = parseBibliographyXml(bibliographyXml([garden], "apa"));
    expect(again.sources[0]?.editors).toEqual(["Priya", "Sam"]);
    expect(again.sources[0]?.editor).toBe("Priya");
    expect(again.sources[0]?.author).toBe("Mensah");
    expect(JSON.stringify(again)).not.toContain("secret-value");
  });

  it("leaves an author name with a line break out of the citation", () => {
    const source: CitationSource = {
      ...mensah,
      author: "secret\nvalue",
      authors: ["Priya", "secret\nvalue"],
    };
    expect(inText(source, "apa")).toBe("(Priya, 2024)");
    expect(bibliographyPlain(source, "apa")).not.toContain("secret");
    expect(source.author).toBe("secret\nvalue");
    expect(source.authors).toEqual(["Priya", "secret\nvalue"]);
    const only = { ...mensah, author: "secret\nvalue" };
    expect(inText(only, "apa")).toBe("(Unknown, 2024)");
    expect(inText(only, "apa")).not.toContain("secret");
    expect(only.author).toBe("secret\nvalue");
    const stored = structuredClone(source);
    const library = citationLibrary({ attrs: { citationSources: [stored] } });
    expect(library.sources[0]?.authors).toEqual(["Priya"]);
    expect(library.sources[0]?.author).toBe("secret\nvalue");
  });

  it("prints a website address and leaves a credential out", () => {
    const site: CitationSource = {
      ...mensah,
      kind: "website",
      title: "North beds",
      url: "https://example.test/beds",
    };
    const full = bibliographyFull(site, "apa");
    expect(full).toContain("North beds");
    expect(full).toContain("https://example.test/beds");
    expect(bibliographyPlain(site, "apa")).not.toContain("https://example.test/beds");
    const hidden: CitationSource = { ...site, url: "https://user:secret-value@example.test/beds" };
    const note = bibliographyFull(hidden, "apa");
    expect(note).not.toContain("secret-value");
    expect(note).not.toContain("example.test");
    expect(hidden.url).toContain("secret-value");
    const xml = bibliographyXml([site], "apa");
    expect(xml).toContain("InternetSite");
    const read = parseBibliographyXml(xml);
    expect(read.sources[0]?.kind).toBe("website");
    expect(read.sources[0]?.url).toBe("https://example.test/beds");
    const library = citationLibrary({ attrs: { citationSources: [site] } });
    expect(library.sources[0]?.kind).toBe("website");
  });
});
