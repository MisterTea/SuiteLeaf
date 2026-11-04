// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { listSuggestions } from "@suiteleaf/core/suggestions";
import type { JsonNode } from "@suiteleaf/core";
import { docHarness, p, text, type DocHarness } from "./doc-agent-tools-fixture";

let d: DocHarness | undefined;
const open = (...args: Parameters<typeof docHarness>) => (d = docHarness(...args));
afterEach(() => {
  d?.destroy();
  d = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

const review = () => [p("We served 40 customers and stayed very close to plan, on budget.")];
const pending = (doc: DocHarness) => listSuggestions(doc.editor.getJSON() as JsonNode).map((s) => `${s.kind}:${s.text.trim()}:${s.author}`);
const boldOn = (doc: DocHarness, words: string) => {
  let bold = false;
  doc.editor.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes(words)) bold = node.marks.some((m) => m.type.name === "bold");
  });
  return bold;
};

describe("suggest_changes", () => {
  it("reads review arguments loosely", () => {
    const doc = open(review());
    expect(
      doc.prep("suggest_changes", {
        author: '"Suggesting as Jordan"',
        insert_text: '"approximately "',
        accept: true,
        accept_insert: true,
        accept_delete: "very.",
        reject_format: "no",
      }),
    ).toEqual({
      author: "Jordan",
      insert_text: "approximately ",
      insert_before: undefined,
      delete_text: undefined,
      bold_text: undefined,
      accept_insertion: "*",
      accept_deletion: "very",
      reject_bold: undefined,
    });
    expect(doc.prep("suggest_changes", { author: 3, accept_insertion: "yes", accept_deletion: 0, reject_bold: {} })).toMatchObject({
      author: 3,
      accept_insertion: "*",
      accept_deletion: undefined,
      reject_bold: undefined,
    });
    expect(doc.prep("suggest_changes", { author: "J", accept_insertion: false, accept_deletion: 1, reject_bold: "..." })).toMatchObject({
      accept_insertion: undefined,
      accept_deletion: "*",
      reject_bold: undefined,
    });
  });

  it("proposes an insertion, a deletion and bold as Jordan, then shows them pending", async () => {
    const doc = open(review());
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Suggesting as");
    input.value = "Someone";
    const modes = document.createElement("div");
    modes.setAttribute("aria-label", "Editing mode");
    const button = document.createElement("button");
    button.title = "Suggesting";
    let clicked = 0;
    button.addEventListener("click", () => clicked++);
    modes.append(button);
    document.body.append(input, modes);

    const out = await doc.run("suggest_changes", {
      author: "Jordan",
      insert_text: "approximately",
      insert_before: "40 customers",
      delete_text: "very",
      bold_text: "on budget.",
    });
    expect(input.value).toBe("Jordan");
    expect(clicked).toBe(1);
    expect(localStorage.getItem("suiteleaf-author")).toBe("Jordan");
    expect(out).toContain('Suggesting as Jordan. Suggested inserting "approximately " before "40 customers". Suggested deleting "very ". Suggested bold on "on budget".');
    expect(out).toContain("Pending suggestions (3):");
    expect(pending(doc).sort()).toEqual(["delete:very:Jordan", "format:on budget:Jordan", "insert:approximately:Jordan"]);
    expect(out).toContain('"on budget" is still bold.');
  });

  it("accepts the insertion and deletion and rejects the bold in one call", async () => {
    const doc = open(review());
    const out = await doc.run("suggest_changes", {
      author: "Jordan",
      insert_text: "approximately ",
      insert_before: "40 customers",
      delete_text: "very",
      bold_text: "on budget",
      accept_insertion: "approximately",
      accept_deletion: "very",
      reject_bold: "on budget",
    });
    expect(doc.editor.getText()).toBe("We served approximately 40 customers and stayed close to plan, on budget.");
    expect(boldOn(doc, "on budget")).toBe(false);
    expect(pending(doc)).toEqual([]);
    expect(out).toContain("Accepted 2 suggestion(s) and Rejected 1 suggestion(s).");
    expect(out).toContain('No suggestions are pending. "on budget" is not bold.');
  });

  it("says when each change is already made", async () => {
    const doc = open([p("We served approximately 40 customers, ", text("on budget", ["bold"]), ".")]);
    const out = await doc.run("suggest_changes", {
      author: "Jordan",
      insert_text: "approximately ",
      insert_before: "40 customers",
      delete_text: "very",
      bold_text: "on budget",
      accept_insertion: "approximately",
      accept_deletion: "very",
      reject_bold: "bold",
    });
    expect(out).toContain('"approximately " is already immediately before "40 customers".');
    expect(out).toContain('"very" is already gone.');
    expect(out).toContain('"on budget" is already bold.');
    expect(out).toContain('The insertion "approximately" is already accepted.');
    expect(out).toContain('The deletion of "very" is already accepted.');
    expect(out).toContain('No bold suggestion matches "bold".');
    expect(doc.editor.getText()).toBe("We served approximately 40 customers, on budget.");
  });

  it("names a review that matches nothing yet", async () => {
    const doc = open([p("We served very many people.")]);
    const out = await doc.run("suggest_changes", { author: "Jordan", accept_insertion: "*", accept_deletion: "*", reject_bold: "*" });
    expect(out).toContain('No insertion suggestion matches "*".');
    expect(out).toContain('No deletion suggestion matches "*".');
    expect(out).toContain('No bold suggestion matches "*".');
    expect(out).not.toContain("on budget");
    const plainText = await doc.run("suggest_changes", { author: "Jordan", reject_bold: "many people" });
    expect(plainText).toContain('Bold on "many people" is already rejected.');
  });

  it("accepts by any word of the suggestion and leaves the others pending", async () => {
    const doc = open(review());
    await doc.run("suggest_changes", { author: "Jordan", delete_text: "very", bold_text: "on budget" });
    expect(await doc.run("suggest_changes", { author: "Jordan", delete_text: "very" })).toContain('Deleting "very " is already suggested.');
    const out = await doc.run("suggest_changes", { author: "Jordan", accept_deletion: "very close", reject_bold: "formatting" });
    expect(out).toContain("Accepted 1 suggestion(s) and Rejected 1 suggestion(s).");
    expect(doc.editor.getText()).toBe("We served 40 customers and stayed close to plan, on budget.");
  });

  it("asks for an author and for both halves of an insertion", async () => {
    const doc = open(review());
    await expect(doc.run("suggest_changes", { author: "  " })).rejects.toThrow(/Pass author/);
    await expect(doc.run("suggest_changes", { author: "Jordan", insert_text: "approximately " })).rejects.toThrow(/pass both insert_text/);
    await expect(doc.run("suggest_changes", { author: "Jordan", insert_text: "x", insert_before: "absent words." })).rejects.toThrow(
      /"absent words." is not in the document/,
    );
    await expect(doc.run("suggest_changes", { author: "Jordan", delete_text: "we served 40" })).resolves.toContain("Suggested deleting");
    await expect(doc.run("suggest_changes", { author: "Jordan", delete_text: "nowhere at all" })).resolves.toContain('"nowhere at all" is already gone.');
    expect(await doc.run("suggest_changes", { author: "Jordan" })).toContain("Nothing was proposed yet.");
  });

  it("finds the place on screen and refuses the widow newsletter", async () => {
    const doc = open(review());
    const target = doc.tool("suggest_changes").target!;
    expect(target({ author: "J", bold_text: "absent" } as never)).toBe(doc.editor.view.dom);
    expect(target({ author: "J", reject_bold: "*" } as never)).toBe(doc.editor.view.dom);
    doc.destroy();
    const news = open([p("See you Saturday.")], { title: "Garden club news" });
    await expect(news.run("suggest_changes", { author: "Jordan" })).rejects.toThrow(/dont_leave_one_line/);
  });
});
