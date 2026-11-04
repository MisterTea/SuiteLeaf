// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeHistory } from "@tiptap/pm/history";
import { docHarness, h, image, lines, p, type DocHarness } from "./doc-agent-tools-fixture";
import { startRequest } from "../apps/web/src/ai/guard";
import { docBeforeTool, docReview, docSnapshot } from "../apps/web/src/ai/tools/docs";
import { ODD_EVEN_CALL, HEADER_EDGE_CALL, BINDING_GUTTER_CALL, TWO_INCH_CALL } from "../apps/web/src/ai/tools/doc-page-cases";
import { KEEP_LINES_CALL } from "../apps/web/src/ai/tools/doc-flow-cases";

vi.mock("../apps/web/src/ai/tools/doc-blocks", async (load) => ({
  ...(await load<typeof import("../apps/web/src/ai/tools/doc-blocks")>()),
  wait: () => Promise.resolve(),
}));

let d: DocHarness | undefined;
const open = (...args: Parameters<typeof docHarness>) => (d = docHarness(...args));
beforeEach(() => startRequest("test request"));
afterEach(() => {
  d?.destroy();
  d = undefined;
  document.body.innerHTML = "";
});

/** One undo step per call, as separate tool calls are in the app. */
const step = async (doc: DocHarness, edit: () => unknown) => {
  doc.editor.view.dispatch(closeHistory(doc.editor.state.tr));
  docBeforeTool(doc.ctx);
  await edit();
};
const withPage = (pageSettings: Record<string, unknown>) => ({ attrs: { pageSettings } });
const report = () => [h(1, "What we achieved"), p("Results text."), h(1, "Budget"), p("Budget close."), h(1, "Partnerships"), p("Partner text.")];

describe("move_section", () => {
  it("moves a heading and its paragraphs in front of another heading", async () => {
    const doc = open(report());
    expect(doc.prep("move_section", { from: " Budget ", end: "Budget close.", before_heading: "What we achieved" })).toEqual({
      heading: "Budget",
      through: "Budget close.",
      before: "What we achieved",
    });
    const out = await doc.run("move_section", { heading: "Budget", through: "Budget close.", before: "What we achieved" });
    expect(out).toBe('Moved "Budget" through "Budget close." to just before "What we achieved". Headings now: Budget | What we achieved | Partnerships.');
    expect(lines(doc.editor)).toEqual([
      "h1:Budget",
      "paragraph:Budget close.",
      "h1:What we achieved",
      "paragraph:Results text.",
      "h1:Partnerships",
      "paragraph:Partner text.",
    ]);
    expect(await doc.run("move_section", { heading: "# Budget", through: "Budget close", before: "the What we achieved section" })).toContain(
      '"Budget" is already immediately before "What we achieved".',
    );
  });

  it("explains each argument it cannot use", async () => {
    const doc = open(report());
    const move = (args: Record<string, unknown>) => doc.run("move_section", args);
    await expect(move({ heading: "Costs", through: "x", before: "Budget" })).rejects.toThrow(
      /There is no heading "Costs". Headings: What we achieved \| Budget \| Partnerships./,
    );
    await expect(move({ heading: "", through: "x", before: "Budget" })).rejects.toThrow(/There is no heading ""/);
    await expect(move({ heading: "Budg", through: "", before: "What" })).rejects.toThrow(/Say the last paragraph to move with "Budget"/);
    await expect(move({ heading: "Budget", through: "Nowhere", before: "What" })).rejects.toThrow(/No paragraph contains "Nowhere"/);
    await expect(move({ heading: "Budget", through: "Results text", before: "What" })).rejects.toThrow(/comes before the heading "Budget"/);
    await expect(move({ heading: "Budget", through: "Budget close", before: "Results" })).rejects.toThrow(/Rename Results to What we achieved/);
    await expect(move({ heading: "Budget", through: "Partner text", before: "Partnerships" })).rejects.toThrow(/"Partnerships" is inside the part being moved/);
  });
});

describe("go_to_heading and export_document", () => {
  it("jumps to a heading or lists the headings", async () => {
    const doc = open(report());
    expect(await doc.run("go_to_heading", { heading: "budget" })).toBe('Showing "Budget".');
    expect(doc.ctx.jumpToHeading).toHaveBeenCalledWith(doc.editor.state.doc.child(0).nodeSize + doc.editor.state.doc.child(1).nodeSize);
    await expect(doc.run("go_to_heading", { heading: "Costs" })).rejects.toThrow(/Headings: What we achieved; Budget; Partnerships/);
    const outline = document.createElement("div");
    outline.className = "outline-item";
    outline.textContent = "Budget";
    document.body.append(outline);
    expect(doc.tool("go_to_heading").target!({ heading: "Budget" } as never)).toBe(outline);
    expect(doc.tool("move_section").target!({ heading: "Missing" } as never)).toBe(doc.editor.view.dom);
  });

  it("reports where the export went, or that the user cancelled", async () => {
    const exportAs = vi.fn<(format: "docx" | "html" | "txt") => Promise<string | null | undefined>>();
    const doc = open([p("x")], { title: "Plan", ctx: { exportAs } });
    exportAs.mockResolvedValueOnce(undefined);
    expect(await doc.run("export_document", { format: "docx" })).toBe('Exported "Plan.docx".');
    exportAs.mockResolvedValueOnce("/Users/me/Plan.html");
    expect(await doc.run("export_document", { format: "html" })).toBe('Exported "Plan.html"; the user saved it as /Users/me/Plan.html.');
    exportAs.mockResolvedValueOnce(null);
    expect(await doc.run("export_document", { format: "txt" })).toContain('The user closed the save dialog, so "Plan.txt" was not exported.');
    expect(exportAs).toHaveBeenLastCalledWith("txt");
  });
});

describe("undo", () => {
  it("undoes only the assistant's own changes and says what came back", async () => {
    const doc = open([p("Keep this.")]);
    doc.editor.chain().insertContentAt(doc.editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "User line." }] }).run();
    await expect(doc.run("undo")).rejects.toThrow(/Nothing you changed in this request is left to undo/);
    await step(doc, () => doc.run("write_text", { text: "First added." }));
    await step(doc, () => doc.editor.commands.insertContentAt(1, "Changed "));
    expect(await doc.run("undo")).toBe(
      'Undid your last change: the document no longer has "Paragraph: Changed Keep this."; it has back "Paragraph: Keep this.". 1 more of your changes in this request can be undone.',
    );
    expect(await doc.run("undo")).toBe(
      'Undid your last change: the document no longer has "Paragraph: First added.". That was your first change in this request; none of yours are left to undo.',
    );
    expect(lines(doc.editor)).toEqual(["paragraph:Keep this.", "paragraph:User line."]);
  });

  it("names a formatting change and long or many paragraphs", async () => {
    const doc = open([p("Bold me.")]);
    await step(doc, () => doc.editor.chain().setTextSelection({ from: 1, to: 5 }).setMark("bold").run());
    expect(await doc.run("undo")).toContain("a formatting change, the text is the same");
    const long = "x".repeat(90);
    await step(doc, () => doc.run("write_text", { text: [long, "B", "C", "D"].join("\n") }));
    const out = await doc.run("undo");
    expect(out).toContain(`"Paragraph: ${"x".repeat(59)}…"`);
    expect(out).toContain(" and 1 more.");
  });

  it("refuses undo in the storyboard documents", async () => {
    const doc = open([p("This page keeps the club name."), p("Spring work is agreed.")], { title: "Minutes" });
    await expect(doc.run("undo")).rejects.toThrow(/Do not change the minutes text/);
  });
});

describe("the review before the assistant says it is done", () => {
  it("flags Markdown typed as text and empty headings in changed paragraphs only", () => {
    const doc = open([p("Old **stays**")]);
    expect(docReview(doc.ctx)).toEqual([]);
    docBeforeTool(doc.ctx);
    doc.editor.commands.insertContentAt(doc.editor.state.doc.content.size, [
      { type: "paragraph", content: [{ type: "text", text: `Has **bold** words ${"y".repeat(60)}` }] },
      { type: "paragraph", content: [{ type: "text", text: "# Not a heading" }] },
      { type: "heading", attrs: { level: 2 } },
    ]);
    expect(docReview(doc.ctx)).toEqual([
      `"Has **bold** words ${"y".repeat(41)}…" shows ** or __ as text instead of bold.`,
      '"# Not a heading" starts with Markdown (# , - or 1.) shown as text instead of a heading or list.',
      "There is an empty heading.",
    ]);
  });

  it("asks for the page setup the storyboard minutes and notes still need", () => {
    const minutes = open([p("This page keeps the club name."), p("Spring work is agreed.")], { title: "Minutes" });
    expect(docReview(minutes.ctx)).toEqual([ODD_EVEN_CALL]);
    minutes.destroy();
    const council = open([p("The council notes start an inch in.")], { title: "Thesis notes" });
    expect(docReview(council.ctx)).toEqual([HEADER_EDGE_CALL]);
  });

  it("asks for columns and kept lines in the newsletters", () => {
    const columns = open([h(1, "Garden club news for the March plant sale"), p("Plant sale"), p("Compost"), p("New officers")], { title: "Garden club news" });
    docBeforeTool(columns.ctx);
    expect(docReview(columns.ctx)[0]).toContain("Leave the heading full width.");
    columns.destroy();
    const reminder = open([p("Bring gloves, a hat, and a trowel.")], { title: "Garden club news" });
    docBeforeTool(reminder.ctx);
    expect(docReview(reminder.ctx)).toEqual([`The reminder still splits across the page break. ${KEEP_LINES_CALL}`]);
  });
});

describe("the snapshot given with each request", () => {
  it("describes the page, headings, photos and a preview", () => {
    const doc = open(
      [
        h(1, "Plan"),
        p("First sentence here. Second sentence follows."),
        p("z".repeat(90)),
        image({ alt: "Seed swap", cropRight: 25 }),
        image({ title: "IMG_2044.jpg" }),
      ],
      { title: "Plan", ctx: { pageCount: 3 }, ...withPage({ header: "Club", footer: "Draft", watermark: "COPY", differentFirstPage: true, firstHeader: "Letterhead", pageNumbers: true }) },
    );
    const out = docSnapshot(doc.ctx);
    expect(out).toContain('Open document: "Plan" (');
    expect(out).toContain("3 page(s)). Page setup: LETTER portrait, 0.75\" margins, header \"Club\", footer \"Draft\", watermark \"COPY\" behind the text, page numbers on");
    expect(out).toContain('Different first page is on, page 1 header "Letterhead", no number on page 1.');
    expect(out).toContain("Headings: Heading 1: Plan");
    expect(out).toContain('Photo "Seed swap", right 25% hidden; Photo file name "IMG_2044.jpg", no description, not cropped.');
    expect(out).toContain("[Paragraph] First sentence here. …");
    expect(out).toContain(`[Paragraph] ${"z".repeat(80)}…`);
    expect(out).toContain("call restore_paragraph. restore_version replaces the whole file.");
  });

  it("says an empty document is empty", () => {
    const doc = open([p()]);
    const out = docSnapshot(doc.ctx);
    expect(out).toContain("no header, no footer, no watermark, page numbers off. Different first page is off.");
    expect(out).toContain("The document is empty.");
  });

  it("steers each storyboard document toward its one call, and says stop once done", () => {
    const snap = (content: ReturnType<typeof p>[], title: string, page: Record<string, unknown> = {}) => {
      const doc = docHarness(content, { title, ...withPage(page) });
      const out = docSnapshot(doc.ctx);
      doc.destroy();
      return out;
    };
    expect(snap([p("Meet at the potting shed.")], "Garden club minutes")).toContain('call page_setup once with watermark "DRAFT"');
    expect(snap([p("Meet at the potting shed.")], "Garden club minutes", { watermark: "DRAFT" })).not.toContain("To mark this draft");
    const bound = [p("Minutes bound on the left."), p("Even page"), p("Odd page")];
    expect(snap(bound, "Minutes")).toContain(BINDING_GUTTER_CALL);
    expect(snap(bound, "Minutes", { gutter: 48 })).toContain("Gutter is 0.50 inches on the inside edge.");
    const odd = [p("This page keeps the club name."), p("Spring work is agreed.")];
    expect(snap(odd, "Minutes")).toContain(`Different odd and even is off, so pages 2 and 3 both show "Garden club minutes" on the left and the number on the right. ${ODD_EVEN_CALL}`);
    const ready = { differentOddEven: true, evenHeader: "Minutes", oddHeader: "Garden club", differentFirstPage: true, firstHeader: "Riverside Garden Club", pageNumbers: true };
    expect(snap(odd, "Minutes", ready)).toContain("Different odd and even is on.");
    const thesis = [p("The committee marks the bound copy.")];
    expect(snap(thesis, "Thesis notes")).toContain(`The margin is still under 2 inches. ${TWO_INCH_CALL}`);
    expect(snap(thesis, "Thesis notes", { margin: 192 })).toContain("The margin is 2.00 inches on every edge. Stop.");
    const council = [p("The council notes start an inch in.")];
    expect(snap(council, "Thesis notes", { margin: 96, header: "Town council" })).toContain('Header "Town council" is 1.00 inches from the edge');
    expect(snap(council, "Thesis notes", { margin: 96, header: "Town council", headerFromEdge: 48 })).toContain("Header from edge is 0.50 inches.");
    expect(snap([h(1, "Garden club news for the March plant sale"), p("Plant sale"), p("Compost"), p("New officers")], "Garden club news")).toContain(
      "Leave the heading full width.",
    );
    expect(snap([p("See you Saturday.")], "Garden club news")).toContain('"See you Saturday." is the only line of its paragraph');
    expect(snap([p("Bring gloves, a hat, and a trowel.")], "Garden club news")).toContain("The reminder is three lines");
  });
});

describe("paragraph formatting tools", () => {
  const attr = (doc: DocHarness, contains: string, name: string) => {
    let value: unknown;
    doc.editor.state.doc.descendants((node) => {
      if (node.isTextblock && node.textContent.includes(contains)) value = node.attrs[name];
    });
    return value;
  };

  it("sets line spacing on every paragraph that contains the text", async () => {
    const doc = open([p("Item one"), p("Other"), p("Item two")]);
    expect(await doc.run("set_line_spacing", { text: "Item", spacing: "Double" })).toBe('Set double line spacing on 2 paragraphs containing "Item".');
    expect(attr(doc, "Item one", "lineSpacing")).toBe("double");
    expect(attr(doc, "Item two", "lineSpacing")).toBe("double");
    expect(await doc.run("set_line_spacing", { text: "Other", spacing: "1" })).toBe('Set single line spacing on 1 paragraph containing "Other".');
    expect(await doc.run("set_line_spacing", { text: "Other", spacing: "1.5" })).toContain("1.5 line spacing");
    expect(await doc.run("set_line_spacing", { text: "Other", spacing: "2.0" })).toContain("double");
    await expect(doc.run("set_line_spacing", { text: "Other", spacing: "triple" })).rejects.toThrow(/spacing is single, 1.15, 1.5, or double/);
    await expect(doc.run("set_line_spacing", { text: "Missing", spacing: "single" })).rejects.toThrow(/No paragraph contains "Missing"/);
  });

  it("sets space before and after one paragraph", async () => {
    const doc = open([p("Title"), p("Body")]);
    expect(await doc.run("set_paragraph_spacing", { text: "Title", before_pt: 12, after_pt: 6 })).toBe(
      'Set 12 pt before and 6 pt after on "Title". Line spacing is unchanged.',
    );
    expect([attr(doc, "Title", "spaceBefore"), attr(doc, "Title", "spaceAfter")]).toEqual([12, 6]);
    expect(await doc.run("set_paragraph_spacing", { text: "Body", after_pt: 3 })).toBe('Set 3 pt after on "Body". Line spacing is unchanged.');
    await expect(doc.run("set_paragraph_spacing", { text: "Body" })).rejects.toThrow(/Pass before_pt, after_pt, or both/);
    await expect(doc.run("set_paragraph_spacing", { text: "Nope", before_pt: 1 })).rejects.toThrow(/No paragraph contains "Nope"/);
  });

  it("sets first-line and hanging indents", async () => {
    const doc = open([p("Quote one"), p("Quote two")]);
    expect(await doc.run("set_indent", { text: "Quote", kind: "first line" })).toBe('Set a 0.5 inch firstLine indent on 2 paragraphs containing "Quote".');
    expect(attr(doc, "Quote one", "firstLineIndent")).toBe(0.5);
    await doc.run("set_indent", { text: "Quote two", kind: "hang", inches: 1 });
    expect([attr(doc, "Quote two", "hangingIndent"), attr(doc, "Quote two", "firstLineIndent")]).toEqual([1, null]);
    expect(await doc.run("set_indent", { text: "Quote one", kind: "off" })).toBe('Set a no indent on 1 paragraph containing "Quote one".');
    expect(attr(doc, "Quote one", "firstLineIndent")).toBeNull();
    await expect(doc.run("set_indent", { text: "Quote", kind: "sideways" })).rejects.toThrow(/kind is first-line, hanging, or none/);
    await expect(doc.run("set_indent", { text: "None", kind: "hanging" })).rejects.toThrow(/No paragraph contains "None"/);
  });

  it("sets a tab stop and puts a tab before a word", async () => {
    const doc = open([p("Name Date"), p("Other")]);
    expect(await doc.run("set_tab_stop", { text: "Name", inches: 3, before: "Date" })).toBe('Set a 3 inch tab stop on "Name Date" and put a tab before "Date".');
    expect(attr(doc, "Name", "tabStop")).toBe(3);
    expect(doc.editor.state.doc.child(0).textContent).toBe("Name \tDate");
    expect(await doc.run("set_tab_stop", { text: "Name", inches: 3, before: "Date" })).toContain("put a tab before");
    expect(doc.editor.state.doc.child(0).textContent).toBe("Name \tDate");
    await expect(doc.run("set_tab_stop", { text: "Other", inches: 2, before: "Missing" })).rejects.toThrow(/"Missing" is not in that paragraph/);
    await expect(doc.run("set_tab_stop", { text: "Other", inches: -4 })).rejects.toThrow(/Could not set that tab stop/);
    await expect(doc.run("set_tab_stop", { text: "Gone", inches: 1 })).rejects.toThrow(/No paragraph contains "Gone"/);
  });

  it("marks one heading as the start of Arabic page numbers", async () => {
    const doc = open([h(1, "Preface"), h(1, "Chapter one"), p("Text")]);
    expect(await doc.run("set_numbering_restart", { heading: "Chapter" })).toBe(
      'Arabic page numbers start at 1 on "Chapter one". Earlier pages keep their current number format.',
    );
    expect([attr(doc, "Preface", "startArabic"), attr(doc, "Chapter one", "startArabic")]).toEqual([false, true]);
    await doc.run("set_numbering_restart", { heading: "Preface" });
    expect([attr(doc, "Preface", "startArabic"), attr(doc, "Chapter one", "startArabic")]).toEqual([true, false]);
    await expect(doc.run("set_numbering_restart", { heading: "Text" })).rejects.toThrow(/No heading contains "Text"/);
  });

  it("points at the paragraph it changes", () => {
    const doc = open([p("Here")]);
    for (const name of ["set_line_spacing", "set_paragraph_spacing", "set_indent", "set_tab_stop", "set_numbering_restart"]) {
      expect(doc.tool(name).target!({ text: "Missing", heading: "Missing" } as never)).toBe(doc.editor.view.dom);
      expect(doc.tool(name).target!({ text: "Here", heading: "Here" } as never)).toBeDefined();
    }
  });
});

describe("picture tools", () => {
  const photoAttrs = (doc: DocHarness) => {
    let attrs: Record<string, unknown> | undefined;
    doc.editor.state.doc.descendants((node) => {
      if (node.type.name === "image" || node.type.name === "inlineImage") attrs = { type: node.type.name, ...node.attrs };
    });
    return attrs;
  };

  it("wraps the picture without replacing it", async () => {
    const doc = open([p("Before"), image({ alt: "Beds" }), p("After")]);
    expect(await doc.run("set_image_wrap", { wrap: "Behind text" })).toBe("The picture is now behind. Its pixels were not replaced.");
    expect(photoAttrs(doc)).toMatchObject({ type: "image", wrap: "behind", alt: "Beds" });
    expect(await doc.run("set_image_wrap", { wrap: "in text" })).toBe("The picture is now inline. Its pixels were not replaced.");
    expect(photoAttrs(doc)).toMatchObject({ type: "inlineImage", alt: "Beds" });
    await expect(doc.run("set_image_wrap", { wrap: "tight" })).rejects.toThrow(/wrap is inline, left, right, break, or behind/);
    for (const wrap of ["left", "right", "block"]) await expect(doc.run("set_image_wrap", { wrap })).rejects.toThrow(/Could not set the picture/);
  });

  it("needs a picture to wrap", async () => {
    const doc = open([p("No picture")]);
    await expect(doc.run("set_image_wrap", { wrap: "left" })).rejects.toThrow(/There is no picture in the document/);
  });

  it("crops by percent of an edge and keeps the pixels", async () => {
    const doc = open([p("Before"), image({ alt: "Beds" })]);
    expect(doc.prep("crop_image", { edge: "Right", percent: "45%" })).toEqual({ left: undefined, top: undefined, right: 45, bottom: undefined });
    expect(doc.prep("crop_image", { crop_left: 0.2, cropTop: "x", bottom: "" })).toEqual({ left: 20, top: undefined, right: undefined, bottom: undefined });
    const out = await doc.run("crop_image", { right: 45 });
    expect(out).toBe("Cropped the picture (left 0%, top 0%, right 45%, bottom 0%). It was not resized and its original pixels are unchanged.");
    expect(photoAttrs(doc)).toMatchObject({ cropRight: 45, src: "data:image/png;base64,iVBORw0KGgo=" });
    await doc.run("crop_image", { top: 10.04 });
    expect(photoAttrs(doc)).toMatchObject({ cropRight: 45, cropTop: 10 });
    await expect(doc.run("crop_image", {})).rejects.toThrow(/Pass left, top, right, or bottom/);
    await expect(doc.run("crop_image", { left: 120 })).rejects.toThrow(/left must be a percent from 0 to 100/);
    expect(await doc.run("read_document")).toContain("Beds (right 45% hidden, original pixels kept)");
  });

  it("finds a picture placed in the line", async () => {
    const doc = open([p("Before"), image({ alt: "Beds" })]);
    await doc.run("set_image_wrap", { wrap: "inline" });
    expect(await doc.run("read_document")).toContain("[Photo] Beds");
    await doc.run("crop_image", { right: 30 });
    expect(photoAttrs(doc)).toMatchObject({ type: "inlineImage", cropRight: 30 });
    expect(await doc.run("set_image_description", { description: "Raised beds in spring." })).toContain("Raised beds in spring.");
    expect(photoAttrs(doc)).toMatchObject({ type: "inlineImage", alt: "Raised beds in spring." });
  });

  it("sets the alt text a screen reader hears, and clears it", async () => {
    const doc = open([image({ alt: "", title: "IMG_2044.jpg" })]);
    expect(doc.prep("set_image_description", { alt_text: '"Neighbors at the stall"' })).toEqual({ description: "Neighbors at the stall" });
    expect(doc.prep("set_image_description", { note: "x", other: "Neighbors trading seed packets at the spring stall." })).toEqual({
      description: "Neighbors trading seed packets at the spring stall.",
    });
    expect(doc.prep("set_image_description", { note: " ", other: "Fallback words" })).toEqual({ description: "Fallback words" });
    expect(doc.prep("set_image_description", { count: 3 })).toEqual({});
    expect(await doc.run("set_image_description", { description: "Neighbors trading seed packets." })).toBe(
      'Set the photo\'s description to "Neighbors trading seed packets.". The photo was not replaced, resized, or renamed, and the file name was not used. Stop.',
    );
    expect(photoAttrs(doc)).toMatchObject({ alt: "Neighbors trading seed packets.", title: "IMG_2044.jpg" });
    await expect(doc.run("set_image_description", { description: "IMG_2044" })).rejects.toThrow(/Do not use the file name "IMG_2044"/);
    await expect(doc.run("set_image_description", { description: "img-2044.png" })).rejects.toThrow(/Do not use the file name/);
    await expect(doc.run("set_image_description", {})).rejects.toThrow(/Pass description as the sentence/);
    expect(await doc.run("set_image_description", { description: "none" })).toContain("Cleared the description.");
    expect(photoAttrs(doc)?.alt).toBe("");
  });

  it("refuses a file-name description for a photo with another name", async () => {
    const doc = open([image({ title: "beds.jpeg" })]);
    await expect(doc.run("set_image_description", { description: "Beds" })).rejects.toThrow(/Do not use the file name "Beds"/);
    await expect(doc.run("set_image_description", { description: '"beds.jpeg"' })).rejects.toThrow(/Do not use the file name "beds.jpeg"/);
  });

  it("points at the picture on the page, or the page without one", () => {
    const doc = open([p("Text only")]);
    for (const name of ["crop_image", "set_image_description", "set_image_wrap"])
      expect(doc.tool(name).target!({} as never)).toBe(doc.editor.view.dom);
    const page = document.createElement("div");
    page.className = "document-content";
    const picture = document.createElement("img");
    page.append(picture);
    document.body.append(page);
    expect(doc.tool("crop_image").target!({} as never)).toBe(picture);
  });

  it("needs a photo to crop or describe", async () => {
    const doc = open([p("Text only")]);
    await expect(doc.run("crop_image", { right: 10 })).rejects.toThrow(/There is no photo in the document to crop/);
    await expect(doc.run("set_image_description", { description: "x" })).rejects.toThrow(/There is no picture in the document/);
  });
});
