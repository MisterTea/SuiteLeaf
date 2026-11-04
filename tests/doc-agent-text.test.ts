// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bullets, docHarness, h, image, json, lines, numbered, p, table, text, type DocHarness } from "./doc-agent-tools-fixture";
import { fileRequestStore } from "../apps/web/src/ai/file-request";
import { insertDocImage } from "../apps/web/src/editors/doc-image-insert";
import {
  blocks,
  equationHint,
  findBlock,
  headingNamesNow,
  locate,
  noBlock,
  objectAfter,
  openParagraphAt,
  unlabel,
  unmark,
} from "../apps/web/src/ai/tools/doc-blocks";

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

const marksOn = (doc: DocHarness, words: string) => {
  let names: string[] = [];
  doc.editor.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes(words)) names = node.marks.map((m) => m.type.name);
  });
  return names;
};

describe("reading the document", () => {
  it("lists each paragraph, list item, table cell and photo with its style", async () => {
    const doc = open(
      [
        h(1, "Plan"),
        p("Intro ", text("2", ["superscript"]), " and H", text("2", ["subscript"]), "O."),
        bullets("Seeds"),
        numbered("Water"),
        table(["Bed", "Crop"]),
        image({ alt: "", title: "IMG_2044.jpg", cropRight: 20 }),
        image({ alt: "Seed swap", cropRight: 10 }),
        image({ title: "plain.png" }),
        p(),
      ],
      { title: "Garden plan", ctx: { pageCount: 2 } },
    );
    const out = await doc.run("read_document");
    expect(out.split("\n")).toEqual([
      '"Garden plan", 2 page(s).',
      "1. [Heading 1] Plan",
      "2. [Paragraph] Intro ² and H₂O.",
      "3. [Bullet] Seeds",
      "4. [Numbered item] Water",
      "5. [Table cell] Bed",
      "6. [Table cell] Crop",
      '7. [Photo] file name "IMG_2044.jpg", no description (right 20% hidden, original pixels kept)',
      "8. [Photo] Seed swap (right 10% hidden, original pixels kept)",
      '9. [Photo] file name "plain.png", no description',
      "10. [Paragraph] (empty)",
    ]);
  });

  it("drops labels and Markdown copied from earlier output when finding a paragraph", () => {
    const doc = open([h(2, "Budget"), p("Total is **fine**"), p("Ünïcode line")]);
    expect(unlabel("6. [Paragraph] Total")).toBe("Total");
    expect(unmark("## Budget")).toBe("Budget");
    expect(unmark("**")).toBe("**");
    const list = blocks(doc.editor);
    expect(findBlock(list, "[Heading 2] Budget")?.label).toBe("Heading 2");
    expect(findBlock(list, "ünïcode")?.text).toBe("Ünïcode line");
    expect(findBlock(list, "   ")).toBeUndefined();
    expect(headingNamesNow(doc.editor)).toBe("Budget");
  });

  it("finds text exactly, then loosely, and picks an occurrence", () => {
    const doc = open([p("Water the beds, water again, water twice. x2 note. Use bold.")]);
    const first = locate(doc.editor, "water");
    const second = locate(doc.editor, "water", 2);
    expect(second.from).toBeGreaterThan(first.from);
    expect(locate(doc.editor, "Water").from).toBe(1);
    expect(locate(doc.editor, "WATER THE").from).toBe(1);
    expect(locate(doc.editor, "water", 9).from).toBe(second.from);
    expect(doc.editor.state.doc.textBetween(...Object.values(locate(doc.editor, "x²")) as [number, number])).toBe("x2");
    expect(locate(doc.editor, "**Use bold**").from).toBeGreaterThan(0);
    expect(() => locate(doc.editor, "")).toThrow(/Say which text/);
    expect(() => locate(doc.editor, "absent")).toThrow(/"absent" is not in the document/);
  });

  it("lists the paragraphs, and a table once, when nothing matches", () => {
    const doc = open([p("Alpha"), table(["Bed", "Crop"], ["North", "Beans"])]);
    const message = noBlock(blocks(doc.editor), "Gamma").message;
    expect(message).toContain('"Alpha", a table starting "Bed"');
    expect(message).not.toContain("Crop");
    expect(message).toContain('use "table" or "photo"');
    doc.destroy();
    const empty = open([p()]);
    expect(noBlock(blocks(empty.editor), "x").message).toBe('No paragraph contains "x". The document is empty.');
  });

  it("points below a table, a named photo, or the last photo", () => {
    const doc = open([p("Before"), table(["Cell"]), image({ alt: "Seed swap" }), p("A table of results"), image({ title: "beds.png" })]);
    const list = blocks(doc.editor);
    expect(objectAfter(doc.editor, "Cell", findBlock(list, "Cell"))?.label).toBe("the table");
    expect(objectAfter(doc.editor, "the photo Seed swap")?.label).toBe('the photo "Seed swap"');
    expect(objectAfter(doc.editor, "the image")?.label).toBe('the photo "beds.png"');
    expect(objectAfter(doc.editor, "table")?.label).toBe("the table");
    expect(objectAfter(doc.editor, "table", findBlock(list, "table"))).toBeUndefined();
    expect(objectAfter(doc.editor, "[table]", findBlock(list, "table"))?.label).toBe("the table");
    expect(objectAfter(doc.editor, "Before")).toBeUndefined();
  });

  it("does not place new paragraphs inside the line of an in-line photo", () => {
    const doc = open([p("Text ", { type: "inlineImage", attrs: { src: "data:image/png;base64,AA==", alt: "Badge" } }, " more")]);
    expect(objectAfter(doc.editor, "the photo Badge")).toBeUndefined();
  });

  it("reuses an empty paragraph rather than adding another", () => {
    const doc = open([p("A"), p(), p("B")]);
    openParagraphAt(doc.editor, 3);
    expect(lines(doc.editor)).toEqual(["paragraph:A", "paragraph:", "paragraph:B"]);
    expect(doc.editor.state.selection.from).toBe(4);
    openParagraphAt(doc.editor, 5);
    expect(lines(doc.editor)).toEqual(["paragraph:A", "paragraph:", "paragraph:", "paragraph:B"]);
  });

  it("says what the Methods sentence still needs", () => {
    expect(equationHint([])).toContain('expression "x^2"');
    expect(equationHint([{ kind: "sup" }])).toContain('expression "(a+b)/c"');
    expect(equationHint([{ kind: "sup" }, { kind: "frac" }])).toContain('symbol "c" and replacement "d"');
  });
});

describe("write_text", () => {
  it("types headings, bullets, numbers and bold into an empty document", async () => {
    const doc = open([p()]);
    const out = await doc.run("write_text", { text: "# Plan\n\nIntro with **bold** word\n- One\n- Two\n1. First\n## Next" });
    expect(lines(doc.editor)).toEqual([
      "h1:Plan",
      "paragraph:Intro with bold word",
      "paragraph:One",
      "paragraph:Two",
      "paragraph:First",
      "h2:Next",
      "paragraph:",
    ]);
    expect(blocks(doc.editor).map((b) => b.label).slice(0, 6)).toEqual(["Heading 1", "Paragraph", "Bullet", "Bullet", "Numbered item", "Heading 2"]);
    expect(marksOn(doc, "bold")).toEqual(["bold"]);
    expect(out).toContain("Typed 6 paragraph(s) at the end of the document");
    expect(out).toContain('heading(s): "Plan", "Next"');
    expect(out).toContain("2 as bulleted list items, 1 as numbered list items");
    expect(out).toContain('in bold: "bold"');
    expect(out).toContain("Headings in the document now: Heading 1: Plan | Heading 2: Next");
  });

  it("adds to the end after the last paragraph", async () => {
    const doc = open([p("Existing.")]);
    await doc.run("write_text", { text: "Added." });
    expect(lines(doc.editor)).toEqual(["paragraph:Existing.", "paragraph:Added."]);
  });

  it("asks before replacing a document with words, then replaces it", async () => {
    const doc = open([p("Old words here.")]);
    const ask = doc.tool("write_text").confirm!;
    expect(ask({ text: "x", replace_document: true } as never)).toBe("Replace everything in this document (3 words) with new text?");
    expect(ask({ text: "x" } as never)).toBeUndefined();
    const out = await doc.run("write_text", { text: "Fresh.", replace_document: true });
    expect(lines(doc.editor)).toEqual(["paragraph:Fresh."]);
    expect(out).toContain("in place of everything that was in the document");
  });

  it("inserts after a paragraph, keeps a new section after a heading's text, and continues a list", async () => {
    const doc = open([h(1, "Plan"), p("Plan text."), h(1, "Later"), bullets("Seeds")]);
    const mid = await doc.run("write_text", { text: "Middle.", after: "Plan text" });
    expect(mid).toContain('right after "Plan text." (Paragraph), before "Later" (Heading 1)');
    const section = await doc.run("write_text", { text: "# Budget\nCosts.", after: "# Plan" });
    expect(section).toContain('right after "Middle." (Paragraph)');
    const list = await doc.run("write_text", { text: "Beans\nPeas", after: "Seeds" });
    expect(list).toContain("2 as new items of the bulleted list");
    expect(lines(doc.editor)).toEqual([
      "h1:Plan",
      "paragraph:Plan text.",
      "paragraph:Middle.",
      "h1:Budget",
      "paragraph:Costs.",
      "h1:Later",
      "paragraph:Seeds",
      "paragraph:Beans",
      "paragraph:Peas",
      "paragraph:",
    ]);
    expect(blocks(doc.editor).slice(-4, -1).map((b) => b.label)).toEqual(["Bullet", "Bullet", "Bullet"]);
    await expect(doc.run("write_text", { text: "x", after: "Nowhere" })).rejects.toThrow(/No paragraph contains "Nowhere"/);
  });

  it("types right below a table", async () => {
    const doc = open([table(["Bed"]), p("End.")]);
    const out = await doc.run("write_text", { text: "Notes below.", after: "table" });
    expect(out).toContain('right after the table, before "End." (Paragraph)');
    expect(lines(doc.editor)).toEqual(["paragraph:Bed", "paragraph:Notes below.", "paragraph:End."]);
  });

  it("points at the end or at the paragraph it follows", () => {
    const doc = open([p("A")]);
    const target = doc.tool("write_text").target!;
    expect(() => target({ text: "x" } as never)).not.toThrow();
    expect(() => target({ text: "x", after: "A" } as never)).not.toThrow();
  });

  it("refuses rewrites in the storyboard documents", async () => {
    const news = open([p("See you Saturday.")], { title: "Garden club news" });
    await expect(news.run("write_text", { text: "x" })).rejects.toThrow(/dont_leave_one_line/);
    news.destroy();
    const week = open([h(2, "This week")], { title: "Garden club news" });
    await expect(week.run("write_text", { text: "x" })).rejects.toThrow(/keep_with_next/);
    week.destroy();
    const minutes = open([p("x")], { title: "October minutes" });
    await expect(minutes.run("write_text", { text: "Page 1" })).rejects.toThrow(/Do not type the page number/);
    minutes.destroy();
    const methods = open([p()], { title: "Methods" });
    await expect(methods.run("write_text", { text: "x^2" })).rejects.toThrow(/Do not type the math/);
    expect(await methods.run("write_text", { text: "The model fits and the ratio." })).toContain('expression "x^2"');
    methods.destroy();
    const draft = open([p("x")], { title: "Garden club minutes" });
    await expect(draft.run("write_text", { text: "DRAFT" })).rejects.toThrow(/Do not type DRAFT/);
    draft.destroy();
    const odd = open([p("This page keeps the club name."), p("Spring work is agreed.")], { title: "Minutes" });
    await expect(odd.run("write_text", { text: "x" })).rejects.toThrow(/Do not change the minutes text/);
    odd.destroy();
    const thesis = open([p("The committee marks the bound copy.")], { title: "Thesis notes" });
    await expect(thesis.run("write_text", { text: "x" })).rejects.toThrow(/margin_inches 2/);
    thesis.destroy();
    const council = open([p("The council notes start an inch in.")], { title: "Thesis notes" });
    await expect(council.run("write_text", { text: "x" })).rejects.toThrow(/header_from_edge_inches 0.5/);
  });
});

describe("paragraph styles, formatting, lists and alignment", () => {
  it("changes a paragraph's style and says when it already has it", async () => {
    const doc = open([p("Budget"), h(2, "Plan")]);
    expect(await doc.run("set_style", { text: "Budget", style: "Heading 2" })).toBe('The paragraph containing "Budget" is now Heading 2.');
    expect(lines(doc.editor)[0]).toBe("h2:Budget");
    expect(await doc.run("set_style", { text: "Plan", style: "Heading 2" })).toContain("already Heading 2");
    await doc.run("set_style", { text: "Plan", style: "Normal text" });
    expect(lines(doc.editor)[1]).toBe("paragraph:Plan");
    expect(await doc.run("set_style", { text: "Plan", style: "Normal text" })).toContain("already Normal text");
  });

  it("formats an exact piece of text", async () => {
    const doc = open([p("Make this loud and this quiet.")]);
    await doc.run("format_text", { text: "loud", bold: true, italic: true, underline: true, strikethrough: true, color: "#ff0000", highlight: "#ffff00", font: "Georgia", size: 14 });
    expect(marksOn(doc, "loud").sort()).toEqual(["bold", "highlight", "italic", "strike", "textStyle", "underline"]);
    const style = json(doc.editor).content![0].content!.find((n) => n.text === "loud")!.marks!.find((m) => m.type === "textStyle")!;
    expect(style.attrs).toMatchObject({ color: "#ff0000", fontFamily: "Georgia", fontSize: "14pt" });
    await doc.run("format_text", { text: "loud", bold: false, highlight: "none" });
    expect(marksOn(doc, "loud")).not.toContain("bold");
    expect(marksOn(doc, "loud")).not.toContain("highlight");
    expect(await doc.run("format_text", { text: "this", occurrence: 2, superscript: true })).toBe('Formatted "this".');
    expect(marksOn(doc, "this quiet")).toEqual([]);
    await doc.run("format_text", { text: "quiet", subscript: true });
    expect(marksOn(doc, "quiet")).toEqual(["subscript"]);
    expect(doc.tool("format_text").target!({ text: "loud" } as never)).toBeDefined();
  });

  it("refuses a superscript for the Methods math", async () => {
    const doc = open([p("x2")], { title: "Methods" });
    await expect(doc.run("format_text", { text: "2", superscript: true })).rejects.toThrow(/A superscript is not an equation/);
  });

  it("makes lists and plain paragraphs again", async () => {
    const doc = open([p("One"), p("Two"), p("Three")]);
    const made = await doc.run("set_list", { from_text: "One", to_text: "Two", list: "bullet" });
    expect(made).toBe('Made 2 paragraph(s) a bullet list: "One" (was Paragraph), "Two" (was Paragraph).');
    expect(blocks(doc.editor).map((b) => b.label)).toEqual(["Bullet", "Bullet", "Paragraph"]);
    expect(await doc.run("set_list", { from_text: "One", to_text: "Two", list: "bullet" })).toContain("already in a bullet list");
    await doc.run("set_list", { from_text: "One", to_text: "Two", list: "numbered" });
    expect(blocks(doc.editor).map((b) => b.label)).toEqual(["Numbered item", "Numbered item", "Paragraph"]);
    await doc.run("set_list", { from_text: "One", to_text: "Two", list: "none" });
    expect(blocks(doc.editor).map((b) => b.label)).toEqual(["Paragraph", "Paragraph", "Paragraph"]);
    expect(await doc.run("set_list", { from_text: "Three", list: "none" })).toContain(
      "Only the paragraph containing \"Three\" was covered, and it is already plain paragraphs; nothing changed. To cover the paragraphs after it too",
    );
    await doc.run("set_list", { from_text: "Three", list: "bullet" });
    await doc.run("set_list", { from_text: "Three", list: "none" });
    expect(blocks(doc.editor).at(-1)?.label).toBe("Paragraph");
  });

  it("aligns a paragraph", async () => {
    const doc = open([p("Title")]);
    expect(await doc.run("align_text", { text: "Title", alignment: "center" })).toBe("Aligned the paragraph center.");
    expect(doc.editor.getJSON().content![0].attrs?.textAlign).toBe("center");
  });

  it("refuses formatting in the widow newsletter", async () => {
    const doc = open([p("See you Saturday.")], { title: "Garden club news" });
    for (const [name, args] of [
      ["set_style", { text: "See", style: "Heading 1" }],
      ["format_text", { text: "See", bold: true }],
      ["set_list", { from_text: "See", list: "bullet" }],
      ["align_text", { text: "See", alignment: "left" }],
    ] as const)
      await expect(doc.run(name, args)).rejects.toThrow(/dont_leave_one_line/);
  });
});

describe("inserting tables, links and photos", () => {
  it("inserts and fills a table after a paragraph", async () => {
    const doc = open([p("Intro."), p("Outro.")]);
    const out = await doc.run("insert_table", { cells: [["Bed", "Crop"], ["North", "Beans"], ["", "Peas"]], after: "Intro" });
    expect(out).toBe(
      'Inserted a 3×2 table right after "Intro.", before "Outro.": a header row (Bed | Crop), then 2 row(s) whose first cells are North, Peas.',
    );
    const cells: string[] = [];
    doc.editor.state.doc.descendants((node) => {
      if (node.type.name === "tableHeader" || node.type.name === "tableCell") cells.push(`${node.type.name}:${node.textContent}`);
    });
    expect(cells).toEqual(["tableHeader:Bed", "tableHeader:Crop", "tableCell:North", "tableCell:Beans", "tableCell:", "tableCell:Peas"]);
  });

  it("puts a table at the end, or below the last table, and names a missing anchor", async () => {
    const doc = open([p("Only.")]);
    expect(await doc.run("insert_table", { cells: [["A"]], header_row: false })).toContain("at the end of the document: first row (A)");
    expect(await doc.run("insert_table", { cells: [["B"]], after: "table" })).toContain("right after the table");
    await expect(doc.run("insert_table", { cells: [["C"]], after: "Missing" })).rejects.toThrow(/No paragraph contains "Missing"/);
  });

  it("links existing text, or adds it at the end", async () => {
    const doc = open([p("See the club site for more.")]);
    expect(await doc.run("insert_link", { text: "club site", url: "example.org" })).toBe('Linked "club site" to https://example.org.');
    const link = json(doc.editor).content![0].content!.find((n) => n.text === "club site")!.marks![0];
    expect(link).toMatchObject({ type: "link", attrs: { href: "https://example.org" } });
    const added = await doc.run("insert_link", { text: "Email us", url: "mailto:club@example.org" });
    expect(added).toBe(
      '"Email us" was not in the document, so it was added at the end of the document as a link to mailto:club@example.org; that paragraph now reads "See the club site for more. Email us".',
    );
    expect(doc.tool("insert_link").target!({ text: "nowhere", url: "#" } as never)).toBeNull();
  });

  it("asks for a photo, inserts it after the paragraph, and reports where it went", async () => {
    const insertImage = vi.fn((file: File) => insertDocImage(editorRef as never, file, true, () => {}));
    const doc = open([p("Above."), p("Below.")], { ctx: { insertImage } });
    const editorRef = doc.editor;
    const pending = doc.run("insert_image", { after: "Above" });
    const request = fileRequestStore.get();
    expect(request?.accept).toBe("image/png,image/jpeg,image/gif,image/webp");
    request!.resolve(new File(["x"], "beds.png", { type: "image/png" }));
    expect(await pending).toBe('Inserted the photo "beds.png" below "Above.", above "Below.".');
    expect(insertImage).toHaveBeenCalledOnce();
    const order: string[] = [];
    doc.editor.state.doc.forEach((node) => order.push(node.type.name === "image" ? `image:${node.attrs.title}` : node.textContent));
    expect(order).toEqual(["Above.", "image:beds.png", "Below."]);
  });

  it("stops when the user declines or the photo is refused", async () => {
    const doc = open([p("Text.")], { ctx: { insertImage: (file) => insertDocImage(editorRef as never, file, true, () => {}) } });
    const editorRef = doc.editor;
    await expect(doc.run("insert_image", { after: "Missing" })).rejects.toThrow(/No paragraph contains/);
    expect(fileRequestStore.get()).toBeNull();
    const declined = doc.run("insert_image", {});
    fileRequestStore.get()!.resolve(null);
    expect(await declined).toBe("The user did not choose a photo.");
    const refused = doc.run("insert_image", { after: "Text" });
    fileRequestStore.get()!.resolve(new File(["x"], "huge.tiff"));
    await expect(refused).rejects.toThrow(/"huge.tiff" could not be inserted/);
  });

  it("puts a photo below a table", async () => {
    const doc = open([table(["Cell"])], { ctx: { insertImage: (file) => insertDocImage(editorRef as never, file, true, () => {}) } });
    const editorRef = doc.editor;
    const pending = doc.run("insert_image", { after: "table" });
    fileRequestStore.get()!.resolve(new File(["x"], "a.png", { type: "image/png" }));
    expect(await pending).toBe('Inserted the photo "a.png" below "Cell", at the end of the document.');
  });
});
