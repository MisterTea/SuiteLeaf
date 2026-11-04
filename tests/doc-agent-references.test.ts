// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { docHarness, h, p, table, text, type DocHarness } from "./doc-agent-tools-fixture";
import { equationsIn } from "../apps/web/src/ai/tools/doc-blocks";

vi.mock("../apps/web/src/ai/tools/doc-blocks", async (load) => ({
  ...(await load<typeof import("../apps/web/src/ai/tools/doc-blocks")>()),
  wait: () => Promise.resolve(),
}));

let d: DocHarness | undefined;
const open = (...args: Parameters<typeof docHarness>) => (d = docHarness(...args));
afterEach(() => {
  d?.destroy();
  d = undefined;
});

const topTypes = (doc: DocHarness) => {
  const out: string[] = [];
  doc.editor.state.doc.forEach((node) => out.push(node.type.name));
  return out;
};
const notes = (doc: DocHarness) => {
  const out: string[] = [];
  doc.editor.state.doc.descendants((node) => {
    if (node.type.name === "note") out.push(node.textContent);
  });
  return out;
};
const citedIds = (doc: DocHarness) => {
  const out: string[] = [];
  doc.editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") out.push(String(node.attrs.sourceId));
  });
  return out;
};
const sources = (doc: DocHarness) => (doc.editor.state.doc.attrs.citationSources ?? []) as { id: string; author: string; year: string; kind: string }[];

describe("insert_table_of_contents", () => {
  const report = () => [p("Cover"), p("Start of the report"), h(1, "Aims"), p("Text."), h(2, "Budget")];

  it("reads loose arguments", () => {
    const doc = open([p("x")]);
    expect(doc.prep("insert_table_of_contents", { at: "Start", pageNumbers: "plain links" })).toEqual({ before: "Start", page_numbers: false });
    expect(doc.prep("insert_table_of_contents", {})).toEqual({ before: "", page_numbers: true });
  });

  it("inserts a self-updating table before the report start, once", async () => {
    const doc = open(report());
    const out = await doc.run("insert_table_of_contents", {});
    expect(out).toBe('Inserted a table of contents with page numbers before "Start of the report". It lists: Aims | Budget.');
    const types = topTypes(doc);
    expect(types.indexOf("tableOfContents")).toBe(1);
    expect(doc.editor.state.doc.child(2).textContent).toBe("Start of the report");
    expect(await doc.run("insert_table_of_contents", { before: "Cover" })).toContain("already in the document. It lists: Aims | Budget.");
  });

  it("can leave the numbers off and needs a place", async () => {
    const doc = open([h(1, "Aims"), p("Intro.")]);
    await expect(doc.run("insert_table_of_contents", {})).rejects.toThrow(/Say which paragraph/);
    await expect(doc.run("insert_table_of_contents", { before: "Missing" })).rejects.toThrow(/No paragraph contains "Missing"/);
    expect(await doc.run("insert_table_of_contents", { before: "Intro", page_numbers: false })).toBe(
      'Inserted a table of contents before "Intro.". It lists: Aims.',
    );
    let numbers: unknown;
    doc.editor.state.doc.descendants((node) => {
      if (node.type.name === "tableOfContents") numbers = node.attrs.pageNumbers;
    });
    expect(numbers).toBe(false);
  });

  it("refuses a place inside a table", async () => {
    const doc = open([table(["Cell"])]);
    await expect(doc.run("insert_table_of_contents", { before: "Cell" })).rejects.toThrow(/Could not insert a table of contents/);
  });
});

describe("insert_footnote", () => {
  it("adds footnotes in reading order and does not add one twice", async () => {
    const doc = open([p("Attendance rose 40% this year."), p("The charity coaches on Saturdays.")]);
    expect(doc.prep("insert_footnote", { phrase: " The charity ", note: " Charity registration. " })).toEqual({
      after: "The charity",
      text: "Charity registration.",
    });
    const second = await doc.run("insert_footnote", { after: "The charity coaches", text: "Charity registration." });
    expect(second).toBe('Added a footnote at the end of the paragraph containing "The charity coaches". Footnotes in reading order: 1. Charity registration..');
    const first = await doc.run("insert_footnote", { after: "attendance rose 40%", text: "Saturday league return." });
    expect(first).toContain("Footnotes in reading order: 1. Saturday league return. | 2. Charity registration.");
    expect(notes(doc).sort()).toEqual(["Charity registration.", "Saturday league return."]);
    expect(doc.editor.state.doc.child(0).lastChild?.type.name).toBe("noteReference");
    expect(await doc.run("insert_footnote", { after: "attendance", text: "Saturday league return." })).toContain("already in the document");
    expect(notes(doc)).toHaveLength(2);
  });

  it("needs words and a source, outside a note", async () => {
    const doc = open([
      p("Body.", { type: "noteReference", attrs: { id: "n1", kind: "footnote" } }),
      { type: "note", attrs: { id: "n1", kind: "footnote" }, content: [p("Inside note")] },
    ]);
    await expect(doc.run("insert_footnote", { after: " ", text: "x" })).rejects.toThrow(/Say which words/);
    await expect(doc.run("insert_footnote", { after: "Body", text: "" })).rejects.toThrow(/Say the source text/);
    await expect(doc.run("insert_footnote", { after: "Inside note", text: "Other." })).rejects.toThrow(/is inside a footnote/);
    expect(doc.tool("insert_footnote").target!({ after: "nowhere" } as never)).toBe(doc.editor.view.dom);
  });
});

describe("sources and citations", () => {
  const grant = () => [p("Attendance rose 40% in the league."), p("The extra coaching hours changed the season."), p("The club filed its return.")];

  it("cleans the source arguments", () => {
    const doc = open([p("x")]);
    expect(doc.prep("add_source", { name: ' "Mensah." ', work: "Youth football in Accra.", year: "published 2024", type: "Journal" })).toEqual({
      author: "Mensah",
      title: "Youth football in Accra",
      year: "2024",
      kind: "article",
    });
    expect(doc.prep("add_source", { author: "Adu", title: "Notes", year: "c. 20", kind: "" })).toMatchObject({ year: "20", kind: "book" });
    expect(doc.prep("cite_source", { source: "Mensah", phrase: "attendance rose 40%." })).toEqual({ author: "Mensah", after: "attendance rose 40%" });
    expect(doc.prep("update_source_year", { name: "Mensah", new_year: "2022" })).toEqual({ author: "Mensah", year: "2022" });
    expect(doc.prep("insert_bibliography", {})).toEqual({ after: "filed its return" });
  });

  it("adds, cites, updates and lists sources for the grant report", async () => {
    const doc = open(grant(), { title: "Grant report 2026" });
    await expect(doc.run("add_source", { author: "Mensah", title: "", year: "2024" })).rejects.toThrow(/Give one source's author, title, and year/);
    const added = await doc.run("add_source", { author: "Mensah", title: "Youth football in Accra", year: "2024", kind: "book" });
    expect(added).toContain('Added the APA book Mensah, "Youth football in Accra", 2024, as (Mensah, 2024).');
    expect(added).toContain("Leave this year at 2024 until both citations are in place");
    expect(await doc.run("add_source", { author: "Boateng", title: "Coaching hours", year: "2023", kind: "article" })).toContain("APA article Boateng");
    expect(await doc.run("add_source", { author: "Adu", title: "Unused notes", year: "2020", kind: "book" })).toContain("Do not cite Unused notes.");
    expect(await doc.run("add_source", { author: "mensah", title: "youth football in accra", year: "2024", kind: "book" })).toContain(
      "is already a source, year 2024. Sources: Mensah, \"Youth football in Accra\", 2024, book, (Mensah, 2024); Boateng",
    );
    expect(await doc.run("add_source", { author: "Adu", title: "Unused notes", year: "2020", kind: "book" })).toContain("Do not add it again.");
    expect(sources(doc).map((s) => s.author)).toEqual(["Mensah", "Boateng", "Adu"]);

    await expect(doc.run("cite_source", { author: "", after: "x" })).rejects.toThrow(/Say which author/);
    await expect(doc.run("cite_source", { author: "Adu", after: "x" })).rejects.toThrow(/Do not cite Unused notes/);
    await expect(doc.run("cite_source", { author: "Mensah", after: "" })).rejects.toThrow(/Say which words/);
    await expect(doc.run("cite_source", { author: "Owusu", after: "league" })).rejects.toThrow(/No source named "Owusu"/);
    const cited = await doc.run("cite_source", { author: "Mensah", after: "attendance rose 40%" });
    expect(cited).toContain('Cited Mensah at the end of the paragraph containing "attendance rose 40%": (Mensah, 2024). Citations: (Mensah, 2024).');
    expect(cited).toContain("Mensah is still 2024.");
    expect(doc.editor.state.doc.child(0).lastChild?.type.name).toBe("citation");
    expect(await doc.run("cite_source", { author: "Mens", after: "attendance" })).toContain("is already at the end of that paragraph");
    expect(await doc.run("cite_source", { author: "Boateng", after: "coaching hours" })).toContain("Citations: (Mensah, 2024), (Boateng, 2023).");
    expect(citedIds(doc)).toEqual([sources(doc)[0].id, sources(doc)[1].id]);

    await expect(doc.run("update_source_year", { author: "Mensah", year: "" })).rejects.toThrow(/Say the author and the new year/);
    await expect(doc.run("update_source_year", { author: "Nobody", year: "2022" })).rejects.toThrow(/No source named "Nobody"/);
    expect(await doc.run("update_source_year", { author: "Mensah", year: "2022" })).toContain(
      "Changed Mensah's year from 2024 to 2022. Citations now show (Mensah, 2022).",
    );
    expect(await doc.run("update_source_year", { author: "Mensah", year: "2022" })).toContain("Mensah is already 2022");
    expect(doc.editor.state.doc.attrs.citationStyle).toBe("apa");

    const bib = await doc.run("insert_bibliography", {});
    expect(bib).toContain('Inserted the APA bibliography after "filed its return". References: Boateng');
    expect(bib.indexOf("Boateng")).toBeLessThan(bib.indexOf("Mensah"));
    expect(bib).not.toContain("Adu");
    expect(topTypes(doc)).toContain("bibliography");
    expect(await doc.run("insert_bibliography", { after: "league" })).toContain("The bibliography is already in the document. References:");
  });

  it("refuses a citation inside a note and reports an empty bibliography", async () => {
    const doc = open([
      p("Body text.", { type: "noteReference", attrs: { id: "n1", kind: "footnote" } }),
      { type: "note", attrs: { id: "n1", kind: "footnote" }, content: [p("Note words")] },
    ]);
    await doc.run("add_source", { author: "Mensah", title: "Book", year: "2024", kind: "book" });
    await expect(doc.run("cite_source", { author: "Mensah", after: "Note words" })).rejects.toThrow(/is inside a footnote/);
    expect(await doc.run("insert_bibliography", { after: "Body" })).toContain("The bibliography is empty because nothing is cited yet.");
  });

  it("keeps an MLA library's style on a year change and switches to APA for the bibliography", async () => {
    const library = {
      citationStyle: "mla",
      citationSources: [{ id: "s1", kind: "book", author: "Mensah", title: "Book", year: "2024", page: "" }],
    };
    const doc = open([p("Body text.")], { attrs: library });
    await doc.run("update_source_year", { author: "Mensah", year: "2021" });
    expect(doc.editor.state.doc.attrs.citationStyle).toBe("mla");
    await doc.run("insert_bibliography", { after: "Body" });
    expect(doc.editor.state.doc.attrs.citationStyle).toBe("apa");
  });

  it("points at the words it follows", () => {
    const doc = open([p("Body text.")]);
    for (const name of ["cite_source", "insert_bibliography"]) expect(doc.tool(name).target!({ after: "Missing" } as never)).toBe(doc.editor.view.dom);
    expect(doc.tool("insert_table_of_contents").target!({} as never)).toBe(doc.editor.view.dom);
    expect(doc.tool("add_source").target!({} as never)).toBe(doc.editor.view.dom);
  });
});

describe("equations", () => {
  const methods = () => [p("The model fits and the ratio.")];

  it("reads typed math as linear math", () => {
    const doc = open([p("x")]);
    expect(doc.prep("insert_equation", { expr: '"$x²$"', after_text: "The model fits [equation x^2]" })).toEqual({
      expression: "x^2",
      after: "The model fits",
    });
    expect(doc.prep("insert_equation", { formula: "x^^2" })).toEqual({ expression: "x^2", after: "" });
    expect(doc.prep("edit_equation", {})).toEqual({ symbol: "c", replacement: "d" });
    expect(doc.prep("edit_equation", { from: '"b"', to: "e" })).toEqual({ symbol: "b", replacement: "e" });
  });

  it("inserts the power and the fraction, then changes the denominator", async () => {
    const doc = open(methods(), { title: "Methods" });
    await expect(doc.run("edit_equation", {})).rejects.toThrow(/There is no fraction to edit yet/);
    const power = await doc.run("insert_equation", { expression: "x^2", after: "The model fits" });
    expect(power).toContain('Inserted a power equation x^2 immediately after "The model fits". Equations: x^2.');
    expect(power).toContain('expression "(a+b)/c"');
    expect(await doc.run("insert_equation", { expression: "x^2", after: "The model fits" })).toContain("The power x^2 is already in the sentence.");
    const frac = await doc.run("insert_equation", { expression: "(a+b)/c", after: "and the ratio" });
    expect(frac).toContain("Inserted a fraction equation (a+b)/c");
    expect(doc.editor.state.doc.child(0).textContent.replace(/\s+/g, " ")).toBe("The model fits and the ratio .");
    expect(equationsIn(doc.editor).map((e) => e.label)).toEqual(["x^2", "(a+b)/c"]);
    await expect(doc.run("edit_equation", { symbol: "q", replacement: "d" })).rejects.toThrow(/Could not change "q" to "d"/);
    const edited = await doc.run("edit_equation", { symbol: "c", replacement: "d" });
    expect(edited).toContain("Changed the denominator from c to d. The numerator and the power are unchanged.");
    expect(equationsIn(doc.editor).map((e) => e.label)).toEqual(["x^2", "(a+b)/d"]);
    expect(await doc.run("edit_equation", {})).toContain("The denominator is already d.");
    expect(await doc.run("read_document")).toContain("[equation x^2]");
  });

  it("refuses expressions that are not a power or fraction, or that skip the edit", async () => {
    const doc = open(methods(), { title: "Methods" });
    await expect(doc.run("insert_equation", { expression: "x+1", after: "fits" })).rejects.toThrow(/is not a power or a fraction/);
    await expect(doc.run("insert_equation", { expression: "", after: "fits" })).rejects.toThrow(/"\(empty\)" is not a power/);
    await expect(doc.run("insert_equation", { expression: "(a+b)/d", after: "ratio" })).rejects.toThrow(/Then call edit_equation/);
    await expect(doc.run("insert_equation", { expression: "x^2", after: " " })).rejects.toThrow(/Say which words the equation follows/);
    await expect(doc.run("insert_equation", { expression: "x^2", after: "Results" })).rejects.toThrow(/"Results" is not in the document yet/);
    expect(doc.tool("insert_equation").target!({ after: "Results" } as never)).toBe(doc.editor.view.dom);
  });

  it("replaces a whole fraction, or the denominator by its plain text", async () => {
    const expr = (den: JSONContent) => ({ kind: "frac", num: { kind: "text", text: "a" }, den });
    const eq = (den: JSONContent) => ({ type: "equation", attrs: { expr: expr(den), plain: "" } });
    const whole = open([p("Ratio ", eq({ kind: "text", text: "c" }) as JSONContent, text(" end"))]);
    expect(await whole.run("edit_equation", { symbol: "a/c", replacement: "b/d" })).toContain("Changed the denominator from a/c to d.");
    expect(equationsIn(whole.editor)[0].label).toBe("(b)/d");
    whole.destroy();
    const row = open([p("Ratio ", eq({ kind: "row", items: [{ kind: "text", text: "e" }, { kind: "sup", base: { kind: "text", text: "f" }, exp: { kind: "text", text: "2" } }] }) as JSONContent)]);
    await expect(row.run("edit_equation", { symbol: "c", replacement: "d" })).rejects.toThrow(/Could not change "c" to "d"/);
    expect(await row.run("edit_equation", { symbol: "f", replacement: "g" })).toContain("Changed the denominator from f to eg2.");
    expect(equationsIn(row.editor)[0].label).toBe("(a)/eg2");
  });

  it("changes a denominator to something other than d", async () => {
    const doc = open([p("The model fits and the ratio.")], { title: "Methods" });
    await doc.run("insert_equation", { expression: "(a+b)/c", after: "and the ratio" });
    expect(await doc.run("edit_equation", { symbol: "c", replacement: "e" })).toContain("Changed the denominator from c to e.");
    expect(equationsIn(doc.editor)[0].label).toBe("(a+b)/e");
  });
});
