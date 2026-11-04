import type { Editor } from "@tiptap/core";
import { COLUMN_LAYOUT } from "../../editors/doc-columns";
import { ToolError } from "../host";

/** Garden club news whose last line is alone. Other documents, including Keep with next, are left alone. */
export function isWidowNewsletter(editor: Editor, title: string) {
  return title === "Garden club news" && editor.getText().includes("See you Saturday.");
}

export const KEEP_LINES_CALL =
  'Call keep_lines_together once with text "Bring gloves," and on true, then stop. Do not call keep_with_next, dont_leave_one_line, write_text, insert_page_break, page_setup, or restore_paragraph.';

/** The three-line reminder that should stay on one page. Not the heading-with-list newsletter. */
export function isKeepLinesNewsletter(editor: Editor, title: string) {
  if (title !== "Garden club news") return false;
  const text = editor.getText();
  return text.includes("Bring gloves,") && text.includes("and a trowel.");
}

export function throwIfKeepLinesNews(editor: Editor, title: string) {
  if (isKeepLinesNewsletter(editor, title))
    throw new ToolError(`Do not change the newsletter that way. ${KEEP_LINES_CALL}`);
}

const COLUMN_HEADING = "Garden club news for the March plant sale";

/** The March plant-sale newsletter: a full-width heading and three short items. */
export function isColumnNewsletter(editor: Editor, title: string) {
  if (title !== "Garden club news") return false;
  const text = editor.getText();
  return text.includes(COLUMN_HEADING) && text.includes("Plant sale") && text.includes("New officers");
}

export function newsLayout(editor: Editor) {
  let headingAtTop = false;
  let headingInside = false;
  const groups: { columns: number; paragraphs: number }[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === "heading" && node.textContent.includes(COLUMN_HEADING)) headingAtTop = true;
    if (node.type.name !== COLUMN_LAYOUT) return;
    let paragraphs = 0;
    let hasHeading = false;
    node.forEach((child) => {
      if (child.type.name === "heading" || child.textContent.includes(COLUMN_HEADING)) hasHeading = true;
      if (child.isTextblock) paragraphs++;
    });
    if (hasHeading) headingInside = true;
    groups.push({ columns: Number(node.attrs.columns) || 0, paragraphs });
  });
  const split =
    headingAtTop &&
    !headingInside &&
    groups.length === 1 &&
    groups[0].columns === 2 &&
    groups[0].paragraphs === 3;
  return { headingAtTop, headingInside, split };
}

export function columnFromText(editor: Editor) {
  const text = editor.getText();
  if (text.includes("Plant sale Saturday")) return "Plant sale Saturday";
  if (text.includes("Plant sale Sunday")) return "Plant sale Sunday";
  return "Plant sale";
}

export function columnCall(editor: Editor) {
  return `Call set_columns once with from_text "${columnFromText(editor)}", to_text "New officers", and columns 2, then stop. Do not column the heading. Do not rewrite the newsletter. Do not call write_text, find_and_replace, keep_with_next, dont_leave_one_line, keep_lines_together, page_setup, or insert_page_break.`;
}

/** What this newsletter still needs. A finished column layout says to stop. */
export function columnTask(editor: Editor) {
  const layout = newsLayout(editor);
  if (layout.split)
    return "The heading is full width. The three items are in two columns. Stop. Do not rewrite the newsletter and do not change the heading.";
  const heading = layout.headingInside ? "The heading is inside the columns. Leave it full width. " : "Leave the heading full width. ";
  return `${heading}${columnCall(editor)}`;
}

export function throwIfColumnNews(editor: Editor, title: string) {
  if (isColumnNewsletter(editor, title)) throw new ToolError(columnTask(editor));
}

/** Whether the three-line reminder already keeps its lines on one page. */
export function reminderKeepsLines(editor: Editor) {
  let on = false;
  editor.state.doc.descendants((node) => {
    if (
      node.type.name === "paragraph" &&
      node.textContent.includes("Bring gloves,") &&
      /trowel/i.test(node.textContent) &&
      node.attrs.keepLines === true
    )
      on = true;
  });
  return on;
}

/** What the open newsletter needs so the reminder stays on one page. */
export function keepLinesNote(editor: Editor) {
  if (!editor.getText().includes("Bring gloves,") || !editor.getText().includes("and a trowel.")) return "";
  if (reminderKeepsLines(editor))
    return `\nKeep lines together is already on for the reminder that starts with "Bring gloves,". All three lines are on one page. Stop. Do not rewrite the document and do not insert a page break.`;
  return `\nThe reminder is three lines: "Bring gloves,", "a hat,", and "and a trowel." The first line is the last line of page 1 and the other two start page 2. ${KEEP_LINES_CALL}`;
}

/** What the open newsletter needs for the leftover line, if this is that document. */
export function widowLineNote(editor: Editor) {
  const state: { on: boolean | null } = { on: null };
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" && node.textContent.includes("See you Saturday."))
      state.on = node.attrs.widowControl === true;
  });
  if (state.on === null) return "";
  if (state.on)
    return `\nDon't leave one line is already on for the paragraph that contains "See you Saturday.". Stop. Do not rewrite the document and do not insert a page break.`;
  return `\n"See you Saturday." is the only line of its paragraph at the top of the next page. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop. Do not call keep_with_next, write_text, insert_page_break, page_setup, or restore_paragraph.`;
}
