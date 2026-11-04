// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { docHarness, h, p, text, type DocHarness } from "./doc-agent-tools-fixture";
import { loadFullDictionary, readPersonalDictionary } from "../apps/web/src/editors/doc-spelling";
import { statusWordCount } from "../apps/web/src/ai/tools/doc-proofing";
import { readProofing } from "../apps/web/src/editors/doc-word-count";
import type { JsonNode } from "@suiteleaf/core";

vi.mock("../apps/web/src/ai/tools/doc-blocks", async (load) => ({
  ...(await load<typeof import("../apps/web/src/ai/tools/doc-blocks")>()),
  wait: () => Promise.resolve(),
}));

let d: DocHarness | undefined;
const open = (...args: Parameters<typeof docHarness>) => (d = docHarness(...args));
beforeAll(() => loadFullDictionary(), 30_000);
beforeEach(() => localStorage.clear());
afterEach(() => {
  d?.destroy();
  d = undefined;
});

const bodyText = (doc: DocHarness) => doc.editor.getText({ blockSeparator: "\n" });
const marksOn = (doc: DocHarness, words: string) => {
  let names: string[] = [];
  doc.editor.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes(words)) names = node.marks.map((m) => m.type.name);
  });
  return names;
};

describe("find_and_replace", () => {
  it("replaces every match through the dialog and quotes where each went", async () => {
    const doc = open([p("The cat sat."), p("A cat ran and a CAT hid.")]);
    const out = await doc.run("find_and_replace", { find: "cat", replace: "dog" });
    expect(bodyText(doc)).toBe("The dog sat.\nA dog ran and a dog hid.");
    expect(doc.ctx.showFind).toHaveBeenCalledWith("cat", "dog", false);
    expect(doc.ctx.showReplaced).toHaveBeenCalledWith(3);
    expect(doc.ctx.closeFind).toHaveBeenCalledOnce();
    expect(out).toBe(
      'Replaced 3 of 3 "cat" with "dog", in: "The dog sat.", "A dog ran and a dog hid.", "A dog ran and a dog hid.". No "cat" is left in the document.',
    );
  });

  it("replaces only the first match, matching case when asked", async () => {
    const doc = open([p("Cat and cat and cat.")]);
    const out = await doc.run("find_and_replace", { find: "cat", replace: "dog", all: false, match_case: true });
    expect(bodyText(doc)).toBe("Cat and dog and cat.");
    expect(out).toContain('Replaced 1 of 2 "cat" with "dog"');
    expect(out).toContain('1 "cat" left.');
  });

  it("makes **double asterisks** bold", async () => {
    const doc = open([p("Old news today.")]);
    const out = await doc.run("find_and_replace", { find: "Old news", replace: "**Big** news" });
    expect(bodyText(doc)).toBe("Big news today.");
    expect(marksOn(doc, "Big")).toEqual(["bold"]);
    expect(marksOn(doc, " news today.")).toEqual([]);
    expect(out).toContain('("Big" in bold)');
  });

  it("explains a find that is already done or missing", async () => {
    const doc = open([p("Already dog.")]);
    expect(await doc.run("find_and_replace", { find: "cat", replace: "dog" })).toBe(
      'Nothing to replace: "cat" is not in the document, and "dog" is there 1 time(s), so it is already replaced.',
    );
    await expect(doc.run("find_and_replace", { find: "# Title", replace: " " })).rejects.toThrow(
      /"# Title" was not found. The document's text has no Markdown marks/,
    );
    await expect(doc.run("find_and_replace", { find: "zebra", replace: "lion" })).rejects.toThrow(/^"zebra" was not found.$/);
    await expect(doc.run("find_and_replace", { find: "dog", replace: "a\nb" })).rejects.toThrow(/use write_text with `after`/);
  });

  it("refuses replacements in the storyboard documents", async () => {
    const news = open([p("See you Saturday.")], { title: "Garden club news" });
    await expect(news.run("find_and_replace", { find: "See", replace: "x" })).rejects.toThrow(/dont_leave_one_line/);
    news.destroy();
    const minutes = open([p("Notes")], { title: "Garden club minutes" });
    await expect(minutes.run("find_and_replace", { find: "Notes", replace: "DRAFT notes" })).rejects.toThrow(/Do not type DRAFT/);
  });
});

describe("spelling", () => {
  it("lists unknown words with their suggestions and opens the panel", async () => {
    const doc = open([p("We recieve the movment and recieve zyxwvq.")]);
    const out = await doc.run("check_spelling");
    expect(doc.ctx.showSpelling).toHaveBeenCalled();
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^"recieve" \(2×\): receive/);
    expect(lines[1]).toMatch(/^"movment" \(1×\): movement/);
    expect(lines[2]).toBe('"zyxwvq" (1×): no close suggestion — a real word the dictionary does not know; add it with add_to_dictionary and do not replace it');
    expect(lines[3]).toContain("Call fix_spelling with no arguments");
  });

  it("reports a clean document and skips one not set to English", async () => {
    const clean = open([p("All words here are fine.")]);
    expect(await clean.run("check_spelling")).toBe("No spelling mistakes found.");
    clean.destroy();
    const french = open([p("Bonjour recieve.")], { attrs: { proofing: { language: "fr" } } });
    expect(await french.run("check_spelling")).toContain("not set to English");
    expect(await french.run("fix_spelling")).toContain("Spelling was not changed");
    expect(bodyText(french)).toBe("Bonjour recieve.");
  });

  it("fixes every typo with a suggestion, keeps bold, and leaves real words", async () => {
    const doc = open([p("Please ", text("recieve", ["bold"]), " the movment of zyxwvq.")]);
    expect(doc.prep("fix_spelling", { word: " ", correction: "" })).toEqual({});
    const out = await doc.run("fix_spelling", {});
    expect(bodyText(doc)).toBe("Please receive the movement of zyxwvq.");
    expect(marksOn(doc, "receive")).toEqual(["bold"]);
    expect(out).toContain('"recieve" → "receive" (1×, bold kept)');
    expect(out).toContain('"movment" → "movement" (1×)');
    expect(out).toContain('Still unknown, with no close suggestion: "zyxwvq" (1×). Add each with add_to_dictionary.');
    expect(doc.ctx.closeProofing).toHaveBeenCalled();
  });

  it("fixes one named word, with the given correction, and leaves the rest", async () => {
    const doc = open([p("We recieve the movment.")]);
    const out = await doc.run("fix_spelling", { word: "movment", correction: "motion" });
    expect(bodyText(doc)).toBe("We recieve the motion.");
    expect(out).toContain('"movment" → "motion" (1×)');
    expect(out).toContain('Still misspelled: "recieve". Call fix_spelling with no arguments');
    expect(await doc.run("fix_spelling", { word: "all" })).toContain("No spelling mistakes are left.");
    expect(bodyText(doc)).toBe("We receive the motion.");
    expect(await doc.run("fix_spelling", {})).toBe("No typos with a suggestion were changed. No spelling mistakes are left.");
  });

  it("explains a word that is fine, absent, or has no suggestion", async () => {
    const doc = open([p("The garden grows zyxwvq.")]);
    expect(await doc.run("fix_spelling", { word: "garden" })).toBe('"garden" is not marked as a misspelling, so it was left as written.');
    expect(await doc.run("fix_spelling", { word: "zzqx" })).toBe('"zzqx" is not in the document, so nothing was changed.');
    expect(await doc.run("fix_spelling", { word: "zyxwvq" })).toContain('"zyxwvq" has no close spelling suggestion, so it was not changed.');
  });

  it("adds a real word to the personal dictionary and refuses a typo", async () => {
    const doc = open([p("We serve zyxwvq and recieve guests.")]);
    await expect(doc.run("add_to_dictionary", { word: "  " })).rejects.toThrow(/Say which word/);
    expect(await doc.run("add_to_dictionary", { word: "recieve" })).toBe(
      '"recieve" looks like a typo (suggestion: receive). It was not added to the dictionary. Correct it with fix_spelling.',
    );
    const out = await doc.run("add_to_dictionary", { word: "zyxwvq" });
    expect(out).toContain('"zyxwvq" is in the personal dictionary');
    expect(readPersonalDictionary().added).toContain("zyxwvq");
    expect(doc.ctx.showDictionary).toHaveBeenCalledOnce();
    expect(await doc.run("check_spelling")).not.toContain("zyxwvq");
  });
});

describe("fix_grammar", () => {
  it("applies each grammar suggestion and keeps formatting", async () => {
    const doc = open([p("The movement ", text("were", ["bold"]), " strong and its the reason they was ready.")]);
    const out = await doc.run("fix_grammar");
    expect(bodyText(doc)).toBe("The movement was strong and it's the reason they were ready.");
    expect(marksOn(doc, "was")).toEqual(["bold"]);
    expect(out).toContain("Fixed 3 grammar issue(s), keeping formatting:");
    expect(out).toContain("No grammar issues are left.");
  });

  it("says when there is nothing to fix", async () => {
    const doc = open([p("They were ready.")]);
    expect(await doc.run("fix_grammar")).toBe("No grammar issues found.");
  });
});

describe("word_count", () => {
  const report = () => [h(1, "Report"), p("One two three four."), h(1, "References"), p("Five six.")];

  it("stops at a heading named loosely, saves it, and says so", async () => {
    const doc = open(report());
    expect(doc.prep("word_count", { stop_at_heading: null, count_footnotes: "true" })).toEqual({ count_footnotes: true });
    expect(doc.prep("word_count", { count_footnotes: "false" })).toEqual({ count_footnotes: false });
    const out = await doc.run("word_count", { stop_at_heading: "the References section" });
    expect(readProofing(doc.editor.getJSON() as JsonNode).stopAtHeading).toBe("References");
    expect(out).toContain(`Word count is ${statusWordCount(doc.editor).label}.`);
    expect(out).toContain('Footnotes are not counted. Counting stops at "References". That exclusion is saved in the file.');
    expect(statusWordCount(doc.editor).counts.words).toBe(5);
    expect(doc.ctx.showWordCount).toHaveBeenCalledOnce();
  });

  it("counts the whole document when the heading is blank, and footnotes when asked", async () => {
    const doc = open(report());
    doc.editor.commands.setTextSelection({ from: 2, to: 5 });
    const out = await doc.run("word_count", { stop_at_heading: "", count_footnotes: true });
    expect(out).toContain("Footnotes are counted.");
    expect(out).toContain("The whole document is counted. To leave a section out, call word_count again with stop_at_heading set to one of: Report, References.");
    expect(doc.editor.state.selection.empty).toBe(true);
    expect(await doc.run("word_count", { stop_at_heading: "references" })).toContain('Counting stops at "References"');
  });

  it("refuses a heading that is not there", async () => {
    const doc = open([p("No headings.")]);
    await expect(doc.run("word_count", { stop_at_heading: "Appendix" })).rejects.toThrow(/There is no heading "Appendix". Headings: \(none\)/);
    expect(await doc.run("word_count", {})).toContain("(no headings)");
  });
});
