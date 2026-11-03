// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { refreshIndex } from "../../packages/core/src/doc-index";
import { indexMarkAttrs } from "../../apps/web/src/editors/index-entry";
import { IndexEntryPanel } from "../../apps/web/src/editors/index-entry-panel";
import { IndexMark } from "../../apps/web/src/editors/index-mark";

afterEach(() => {
  cleanup();
});

it("refuses a blank term and a term that points at itself", () => {
  expect(indexMarkAttrs("  ", "Tomato")).toEqual({ ok: false, notice: "Name the index entry." });
  const same = indexMarkAttrs("secret-value", "secret-value");
  expect(same.ok).toBe(false);
  if (same.ok) return;
  expect(same.notice).toBe("An entry cannot point at itself.");
  expect(same.notice).not.toContain("secret-value");
  expect(indexMarkAttrs("Beds\n", " Tomato ", " North ")).toEqual({
    ok: true,
    attrs: { term: "Beds", subentry: "North", see: "Tomato", seeAlso: "" },
  });
});

it("writes a see mark on the selected words", async () => {
  const editor = new Editor({
    extensions: [StarterKit, IndexMark],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ripe tomatoes" }] }] },
  });
  editor.commands.setTextSelection({ from: 1, to: 5 });
  render(<IndexEntryPanel editor={editor} onClose={() => undefined} />);
  await userEvent.type(screen.getByLabelText("Index term"), "Beds");
  await userEvent.type(screen.getByLabelText("Index subentry"), "North");
  await userEvent.type(screen.getByLabelText("See another term"), "Tomato");
  await userEvent.click(screen.getByRole("button", { name: "Mark index entry" }));
  const status = screen.getByRole("status").textContent;
  expect(status).toBe("The index entry was marked.");
  expect(status).not.toContain("Tomato");
  expect(status).not.toContain("North");
  const json = editor.getJSON() as {
    content?: { content?: { text?: string; marks?: { type: string; attrs?: { term?: string; see?: string } }[] }[] }[];
  };
  const text = json.content?.[0]?.content?.[0];
  expect(text?.text).toBe("ripe");
  expect(text?.marks?.[0]).toMatchObject({ type: "index", attrs: { term: "Beds", subentry: "North", see: "Tomato" } });
  const refreshed = refreshIndex({
    type: "doc",
    content: [{ type: "index", content: [] }, ...(json.content ?? [])],
  });
  const lines = refreshed.content?.[0]?.content?.map((paragraph) => paragraph.content?.[0]?.text);
  expect(lines).toEqual(["Beds, North, see Tomato. That index term is missing."]);
  editor.destroy();
});

it("writes a see also mark and keeps the section number", async () => {
  const editor = new Editor({
    extensions: [StarterKit, IndexMark],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ripe tomatoes" }] }] },
  });
  editor.commands.setTextSelection({ from: 1, to: 5 });
  render(<IndexEntryPanel editor={editor} onClose={() => undefined} />);
  await userEvent.type(screen.getByLabelText("Index term"), "Beds");
  await userEvent.type(screen.getByLabelText("See also another term"), "Paths");
  await userEvent.click(screen.getByRole("button", { name: "Mark index entry" }));
  const json = editor.getJSON() as {
    content?: { content?: { marks?: { type: string; attrs?: { seeAlso?: string } }[] }[] }[];
  };
  expect(json.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.seeAlso).toBe("Paths");
  const refreshed = refreshIndex({
    type: "doc",
    content: [
      { type: "index", content: [] },
      ...(json.content ?? []),
      {
        type: "paragraph",
        content: [{ type: "text", text: "Walk", marks: [{ type: "index", attrs: { term: "Paths" } }] }],
      },
    ],
  });
  const lines = refreshed.content?.[0]?.content?.map((paragraph) => paragraph.content?.[0]?.text);
  expect(lines).toContain("Beds, section 1. See also Paths");
  editor.destroy();
});

it("does not mark an empty selection", async () => {
  const editor = new Editor({
    extensions: [StarterKit, IndexMark],
    content: "<p>ripe</p>",
  });
  editor.commands.setTextSelection(1);
  render(<IndexEntryPanel editor={editor} onClose={() => undefined} />);
  await userEvent.type(screen.getByLabelText("Index term"), "Beds");
  await userEvent.click(screen.getByRole("button", { name: "Mark index entry" }));
  expect(screen.getByRole("status").textContent).toBe("Select the words to mark.");
  expect(JSON.stringify(editor.getJSON())).not.toContain("index");
  editor.destroy();
});
