// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { docHarness, h, p, type DocHarness } from "./doc-agent-tools-fixture";

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

const withPage = (pageSettings: Record<string, unknown>) => ({ attrs: { pageSettings } });

describe("page_setup on an ordinary document", () => {
  it("sets paper, orientation and one margin on every edge, through the dialog", async () => {
    const doc = open([p("Body text.")]);
    const out = await doc.run("page_setup", { paper: "a4", orientation: "landscape", margin: "1 inch" });
    expect(doc.page()).toMatchObject({ size: "a4", landscape: true, margin: 96, marginTop: 96, marginLeft: 96, marginRight: 96, marginBottom: 96 });
    expect(doc.ctx.showPageSetup).toHaveBeenCalledOnce();
    expect(doc.ctx.closePageSetup).toHaveBeenCalledOnce();
    expect(out).toBe('Page setup: A4 landscape, 1.00" margins, page numbers off.');
  });

  it("sets each edge on its own and folds equal edges into one margin", async () => {
    const doc = open([p("Body.")]);
    const out = await doc.run("page_setup", { margins: { top: 1, bottom: 2 } });
    expect(doc.page()).toMatchObject({ marginTop: 96, marginBottom: 192, marginLeft: 72, marginRight: 72, margin: 72 });
    expect(out).toContain('top 1.00", bottom 2.00", left 0.75", right 0.75"');
    await doc.run("page_setup", { margin_top_inches: 1, margin_bottom_inches: 1, margin_left_inches: 1, margin_right_inches: 1 });
    expect(doc.page().margin).toBe(96);
  });

  it("refuses an edge under a quarter inch and saves nothing", async () => {
    const doc = open([p("Body.")]);
    await expect(doc.run("page_setup", { margin_left_inches: 0.1 })).rejects.toThrow(/at least 0.25 inches/);
    expect(doc.ctx.showPageSetup).not.toHaveBeenCalled();
    expect(doc.page().marginLeft).toBe(72);
  });

  it("writes header and footer words and turns numbers on with a format or position", async () => {
    const doc = open([p("Body.")]);
    const out = await doc.run("page_setup", { header_text: "Report", footer: "Draft 2", page_numbers: "Page N", position: "top right" });
    expect(doc.page()).toMatchObject({
      header: "Report",
      footer: "Draft 2",
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "top-right",
      pageNumberPositionSet: true,
    });
    expect(out).toContain('header "Report", footer "Draft 2", page numbers on as "Page N" at the top right');
    await doc.run("page_setup", { page_numbers: "off" });
    expect(doc.page().pageNumbers).toBe(false);
    await doc.run("page_setup", { numbers: "bottom center" });
    expect(doc.page()).toMatchObject({ pageNumbers: true, pageNumberPosition: "bottom-center" });
  });

  it("refuses an unknown number format before saving", async () => {
    const doc = open([p("Body.")]);
    await expect(doc.run("page_setup", { page_number_format: "words" })).rejects.toThrow(/page_number_format must be/);
    expect(doc.ctx.showPageSetup).not.toHaveBeenCalled();
  });

  it("gives page 1 a letterhead without replacing the header of later pages", async () => {
    const doc = open([p("Body.")], withPage({ header: "Minutes", pageNumbers: true }));
    expect(doc.prep("page_setup", { different_first_page: true, letterhead: "Club", header: "Club" })).toEqual({
      different_first_page: true,
      first_header: "Club",
    });
    const out = await doc.run("page_setup", { different_first_page: "yes", header: "Riverside Garden Club" });
    expect(doc.page()).toMatchObject({ differentFirstPage: true, firstHeader: "Riverside Garden Club", header: "Minutes" });
    expect(out).toContain('different first page on, page 1 header "Riverside Garden Club", no number on page 1, later pages keep header "Minutes"');
    await doc.run("page_setup", { different_first_page: false });
    expect(doc.page().differentFirstPage).toBe(false);
    await doc.run("page_setup", { first_page_header: 2026 });
    expect(doc.page()).toMatchObject({ differentFirstPage: true, firstHeader: "2026" });
  });

  it("turns odd and even pages on and keeps an existing letterhead", async () => {
    const doc = open(
      [p("Body.")],
      withPage({ header: "Shared", pageNumbers: true, differentFirstPage: true, firstHeader: "Letterhead" }),
    );
    expect(doc.prep("page_setup", { odd_even: true, headers: { even: "Shared", odd: "Odd" }, header: "Shared" })).toEqual({
      different_odd_even: true,
      even_header: "Shared",
      odd_header: "Odd",
    });
    const out = await doc.run("page_setup", { different_odd_even: true, even_header: "Even", odd_header: "Odd" });
    expect(doc.page()).toMatchObject({
      differentOddEven: true,
      evenHeader: "Even",
      oddHeader: "Odd",
      differentFirstPage: true,
      firstHeader: "Letterhead",
      header: "Shared",
    });
    expect(out).toContain('different odd and even on, even header "Even", odd header "Odd"');
  });

  it("changes the letterhead when asked, even with odd and even pages on", async () => {
    const doc = open(
      [p("Body.")],
      withPage({ pageNumbers: true, differentOddEven: true, evenHeader: "E", oddHeader: "O", differentFirstPage: true, firstHeader: "Old" }),
    );
    await doc.run("page_setup", { first_header: "New" });
    expect(doc.page()).toMatchObject({ differentFirstPage: true, firstHeader: "New", differentOddEven: true });
    await doc.run("page_setup", { different_first_page: false });
    expect(doc.page()).toMatchObject({ differentFirstPage: false, differentOddEven: true });
  });

  it("stores a binding gutter and leaves the four margins alone", async () => {
    const doc = open([p("Body.")], withPage({ margin: 96 }));
    const out = await doc.run("page_setup", { gutter_inches: 0.5, margin_inches: 2, margin_top_inches: 2 });
    expect(doc.page()).toMatchObject({ gutter: 48, margin: 96, marginTop: 96 });
    expect(out).toContain('gutter 0.50" on the inside (left on odd pages, right on even pages; outside margins unchanged)');
    expect(await doc.run("page_setup", { gutter: 0 })).toContain(", gutter 0,");
    expect(doc.page().gutter).toBe(0);
    await expect(doc.run("page_setup", { gutter_inches: 3 })).rejects.toThrow(/larger than 2 inches/);
  });

  it("draws and clears a watermark", async () => {
    const doc = open([p("Body.")]);
    expect(await doc.run("page_setup", { watermark: "Confidential" })).toContain(
      'watermark "Confidential" behind the text on every page, not in a paragraph',
    );
    expect(doc.page().watermark).toBe("Confidential");
    expect(await doc.run("page_setup", { watermark: "" })).toContain("watermark cleared");
    expect(doc.page().watermark).toBe("");
  });

  it("stores Start at and a numberless cover, turning numbers on", async () => {
    const doc = open([p("Body.")]);
    const out = await doc.run("page_setup", { start_at: "4", cover: "no number on the cover" });
    expect(doc.page()).toMatchObject({ pageNumbers: true, pageNumberStart: 4, coverHasNoNumber: true });
    expect(out).toContain("Cover has no number");
    await doc.run("page_setup", { page_numbers: false, page_number_start: 2 });
    expect(doc.page()).toMatchObject({ pageNumbers: false, pageNumberStart: 2 });
  });
});

describe("page_setup on the storyboard documents", () => {
  it("keeps the October minutes footer and refuses a letterhead for the cover", async () => {
    const doc = open([p("Agenda.")], {
      title: "October minutes",
      ...withPage({ footer: "Committee draft", header: "Committee", pageNumbers: true }),
    });
    await expect(doc.run("page_setup", { different_first_page: true })).rejects.toThrow(/cover_has_no_number on page_setup/);
    const out = await doc.run("page_setup", { page_number_start: 4, cover_has_no_number: true, footer: "Page 1", header: "x" });
    expect(doc.page()).toMatchObject({ footer: "Committee draft", header: "Committee", coverHasNoNumber: true, pageNumberStart: 4 });
    expect(out).toContain("The next page is Page 1. Start at 4 is still stored. Stop.");
  });

  it("puts DRAFT behind the garden minutes and refuses any other word", async () => {
    const doc = open([p("Meet at the potting shed.")], { title: "Garden club minutes" });
    await expect(doc.run("page_setup", { watermark: "Copy" })).rejects.toThrow(/watermark "DRAFT"/);
    await expect(doc.run("page_setup", { header: "DRAFT" })).rejects.toThrow(/watermark "DRAFT"/);
    expect(await doc.run("page_setup", { watermark: "draft" })).toContain('watermark "DRAFT" behind the text');
    expect(doc.page().watermark).toBe("DRAFT");
    await doc.run("page_setup", { footer: "Club" });
    expect(doc.page().footer).toBe("Club");
  });

  it("sets odd and even headers on the letterhead minutes and nothing else", async () => {
    const letterhead = { header: "Garden club minutes", pageNumbers: true, differentFirstPage: true, firstHeader: "Riverside Garden Club" };
    const doc = open([p("This page keeps the club name."), p("Spring work is agreed.")], { title: "Minutes", ...withPage(letterhead) });
    await expect(doc.run("page_setup", { different_odd_even: false })).rejects.toThrow(/Leave different odd and even on/);
    await expect(doc.run("page_setup", { different_odd_even: true, even_header: "Minutes", odd_header: "Minutes" })).rejects.toThrow(
      /Even header must be "Minutes" and odd header must be "Garden club"/,
    );
    const out = await doc.run("page_setup", { header: "even: Minutes, odd: Garden club" });
    expect(out).toContain('different odd and even on, even header "Minutes", odd header "Garden club"');
    expect(doc.page()).toMatchObject({
      differentOddEven: true,
      evenHeader: "Minutes",
      oddHeader: "Garden club",
      header: "Garden club minutes",
      firstHeader: "Riverside Garden Club",
      pageNumberPositionSet: false,
    });
    expect(await doc.run("page_setup", { different_odd_even: true })).toContain("Different odd and even is already on.");
  });

  it("accepts only a half-inch gutter on the bound minutes", async () => {
    const doc = open([p("Minutes bound on the left."), p("Even page"), p("Odd page")], { title: "Minutes" });
    await expect(doc.run("page_setup", { gutter_inches: 3 })).rejects.toThrow(/larger than 2 inches/);
    await expect(doc.run("page_setup", { margin_inches: 1 })).rejects.toThrow(/0.5 inch gutter/);
    expect(doc.ctx.showPageSetup).not.toHaveBeenCalled();
    await doc.run("page_setup", { gutter_inches: 0.5 });
    expect(doc.page().gutter).toBe(48);
  });

  it("sets the thesis notes to two inches on every edge and refuses anything else", async () => {
    const doc = open([p("The committee marks the bound copy.")], { title: "Thesis notes" });
    await expect(doc.run("page_setup", { margin_inches: 1 })).rejects.toThrow(/Set the page margin to 2 inches/);
    await expect(doc.run("page_setup", { margin_inches: 5 })).rejects.toThrow(/cannot be more than 3 inches/);
    await expect(doc.run("page_setup", { margin_top_inches: 2 })).rejects.toThrow(/Set the page margin to 2 inches/);
    await expect(doc.run("page_setup", {})).rejects.toThrow(/Set the page margin to 2 inches/);
    expect(await doc.run("page_setup", { margin_inches: 2 })).toContain('2.00" margins on every edge');
    expect(doc.page()).toMatchObject({ margin: 192, marginTop: 192, marginBottom: 192, marginLeft: 192, marginRight: 192 });
    expect(await doc.run("page_setup", {})).toContain("Do not call page_setup again.");
    expect(
      await doc.run("page_setup", { margin_top_inches: 2, margin_bottom_inches: 2, margin_left_inches: 2, margin_right_inches: 2 }),
    ).toContain('2.00" margins on every edge');
  });

  it("moves only the council header to half an inch", async () => {
    const doc = open([p("The council notes start an inch in.")], {
      title: "Thesis notes",
      ...withPage({ margin: 96, header: "Town council" }),
    });
    await expect(doc.run("page_setup", { margin_inches: 0.5 })).rejects.toThrow(/Header from edge is still the same inset/);
    await expect(doc.run("page_setup", { header_from_edge_inches: 0.1 })).rejects.toThrow(/at least 0.25 inches from the edge/);
    await expect(doc.run("page_setup", { header_from_edge_inches: 1 })).rejects.toThrow(/Set Header from edge to 0.5 inches, not 1/);
    const out = await doc.run("page_setup", { header_distance: "0.5in", margin_inches: 0.5 });
    expect(out).toContain("Header from edge is 0.50 inches. The body margin is still 1.00 inches");
    expect(doc.page()).toMatchObject({ headerFromEdge: 48, margin: 96, marginTop: 96, header: "Town council" });
    expect(await doc.run("page_setup", {})).toContain("Do not call page_setup again.");
  });

  it("refuses page setup on the column newsletter", async () => {
    const doc = open([h(1, "Garden club news for the March plant sale"), p("Plant sale Saturday"), p("Compost"), p("New officers")], {
      title: "Garden club news",
    });
    await expect(doc.run("page_setup", { margin_inches: 1 })).rejects.toThrow(/set_columns/);
  });
});

describe("insert_page_break", () => {
  it("starts a new page before the named paragraph", async () => {
    const doc = open([p("First part."), p("Second part.")]);
    expect(await doc.run("insert_page_break", { before_text: "Second" })).toBe('Inserted a page break before "Second".');
    const types: string[] = [];
    doc.editor.state.doc.forEach((node) => types.push(node.type.name));
    expect(types.indexOf("pageBreak")).toBeGreaterThan(-1);
    expect(types.indexOf("pageBreak")).toBeLessThan(types.lastIndexOf("paragraph"));
    await expect(doc.run("insert_page_break", { before_text: "Missing words" })).rejects.toThrow(/No paragraph contains "Missing words"/);
  });

  it("refuses a page break where a page setting is the answer", async () => {
    const minutes = open([p("Agenda.")], { title: "October minutes" });
    await expect(minutes.run("insert_page_break", { before_text: "Agenda" })).rejects.toThrow(/page_number_start 4/);
    minutes.destroy();
    const widow = open([p("This month"), p("See you Saturday.")], { title: "Garden club news" });
    await expect(widow.run("insert_page_break", { before_text: "See you" })).rejects.toThrow(/dont_leave_one_line/);
    widow.destroy();
    const week = open([h(2, "This week"), p("Weeding.")], { title: "Garden club news" });
    await expect(week.run("insert_page_break", { before_text: "This week" })).rejects.toThrow(/keep_with_next/);
  });
});
