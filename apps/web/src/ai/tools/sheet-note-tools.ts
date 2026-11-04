import { Type } from "@earendil-works/pi-ai";
import { tool, ToolError, type SuiteTool } from "../host";
import type { SheetsAgentContext } from "./sheet-context";
import { a1, usedRange, wait } from "./sheet-cells";
import type { SheetToolKit } from "./sheet-tool-kit";

/** Notes and comments on cells. */
export function sheetNoteTools(ctx: SheetsAgentContext, kit: SheetToolKit): SuiteTool[] {
  const { sheet, target, select, cellLabel } = kit;
  return [
    tool({
      name: "add_note",
      label: "Add note",
      description: "Add a note (a short sticky note, no replies) to a cell.",
      parameters: Type.Object({ cell: Type.String(), text: Type.String() }),
      target: ({ cell }) => target(cell),
      async execute({ cell, text }) {
        select(cell);
        sheet().getRange(cell).createOrUpdateNote({ note: text, width: 180, height: 90 });
        ctx.persist();
        // Opened as Insert › Note does; it closes when the selection moves.
        await ctx.api.executeCommand("sheet.operation.add-note-popup");
        await wait(600);
        return `Added a note to ${cell}${cellLabel(cell)}: "${text}". It pops up when the pointer is over the cell.`;
      },
    }),
    tool({
      name: "add_comment",
      label: "Add comment",
      description:
        "Add a comment (a discussion others can reply to) to a cell. When the user says how to sign it (\"sign it as Sam\", \"from Sam\"), pass that name as signed_as.",
      parameters: Type.Object({
        cell: Type.String(),
        text: Type.String({ description: "The comment itself, without a signature" }),
        signed_as: Type.Optional(
          Type.String({
            description:
              "The user's own name to sign with; kept for their later comments on this computer. Never the person the comment is for, never your own name.",
          }),
        ),
      }),
      target: ({ cell }) => target(cell),
      async execute({ cell, text, signed_as }) {
        const name = signed_as?.trim();
        if (name) {
          ctx.setAuthor?.(name);
          // The name goes with the comment, not into its text ("… -Sam").
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          text = text.replace(new RegExp(`[\\s,]*(?:[-–—~]|\\n)\\s*${escaped}[.!]?\\s*$`, "i"), "") || text;
        }
        select(cell);
        // Without paragraphs, the comment card shows no text.
        const lines = text.replace(/\r\n?/g, "\n").split("\n");
        const dataStream = `${lines.join("\r")}\r\n`;
        const paragraphs = [...dataStream].flatMap((c, i) => (c === "\r" ? [{ startIndex: i }] : []));
        const ok = await sheet()
          .getRange(cell)
          .addCommentAsync({ dataStream, paragraphs, sectionBreaks: [{ startIndex: dataStream.length - 1 }] });
        if (!ok) throw new ToolError(`Could not add a comment to ${cell}.`);
        ctx.persist();
        // Show the new thread on its cell, as Insert comment does.
        await ctx.api.executeCommand("sheet.operation.show-comment-modal");
        await wait(600);
        const signature = ctx.signature?.() ?? "";
        const signed = signature
          ? `signed "${signature}"${name && signature !== name ? ` (the signed-in account's name; "${name}" can't be used)` : ""}`
          : `unsigned: no name is set on this computer, so it shows as "You" here and "Anonymous" to others`;
        return `Commented on ${cell}${cellLabel(cell)}, ${signed}: "${text}".`;
      },
    }),
    tool({
      name: "read_notes_and_comments",
      label: "Read comments",
      description: "List the notes and comments on the active sheet.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Comments"]'),
      execute() {
        const s = sheet();
        const r = usedRange(s);
        const found: string[] = [];
        for (let row = r.startRow; row <= r.endRow; row++)
          for (let col = r.startColumn; col <= r.endColumn; col++) {
            const range = s.getRange(row, col, 1, 1);
            const note = range.getNote?.();
            if (note?.note) found.push(`${a1({ startRow: row, endRow: row, startColumn: col, endColumn: col })} note: ${note.note}`);
            for (const comment of range.getComments?.() ?? []) {
              const said = (c: any) => {
                const { authorName, text } = c.getCommentData?.() ?? {};
                return `${authorName ? ` by ${authorName}` : " (unsigned)"}: ${String(text?.dataStream ?? "").replace(/\r?\n$/, "").trim()}`;
              };
              found.push(`${a1({ startRow: row, endRow: row, startColumn: col, endColumn: col })} comment${said(comment)}`);
              for (const reply of comment.getReplies?.() ?? []) found.push(`  reply${said(reply)}`);
            }
          }
        return found.length ? found.join("\n") : "There are no notes or comments.";
      },
    }),
  ];
}
