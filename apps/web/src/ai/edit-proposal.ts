/**
 * The lines a text edit would change. Unchanged lines are left out.
 * Rejecting keeps the earlier text, including paragraphs that did not change.
 */

export function lineChanges(
  before: string,
  after: string,
  limit = 6,
): { removed: string[]; added: string[] } {
  const oldLines = before.split("\n");
  const nextLines = after.split("\n");
  const removed = oldLines.filter((line) => line.trim() && !nextLines.includes(line));
  const added = nextLines.filter((line) => line.trim() && !oldLines.includes(line));
  return { removed: removed.slice(0, limit), added: added.slice(0, limit) };
}

export function keepText(before: string, after: string, accepted: boolean): string {
  return accepted ? after : before;
}

/**
 * Keep the open document until the person accepts. The proposal is a separate
 * value. This does not read or write storage.
 */
export function stageDocumentEdit<T>(current: T, proposed: T): { document: T; proposal: T } {
  return { document: current, proposal: proposed };
}

/** Accept returns the proposal. Reject returns the document that was already open. */
export function finishDocumentEdit<T>(staged: { document: T; proposal: T }, accepted: boolean): T {
  return accepted ? staged.proposal : staged.document;
}

export function documentText(content: unknown): string {
  const lines: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as { type?: string; text?: string; content?: unknown[] };
    if (record.type === "text" && typeof record.text === "string") {
      lines.push(record.text);
      return;
    }
    if (record.type === "paragraph" || record.type === "heading") {
      const text: string[] = [];
      const collect = (child: unknown) => {
        if (!child || typeof child !== "object") return;
        const row = child as { type?: string; text?: string; content?: unknown[] };
        if (row.type === "text" && typeof row.text === "string") text.push(row.text);
        row.content?.forEach(collect);
      };
      record.content?.forEach(collect);
      lines.push(text.join(""));
      return;
    }
    record.content?.forEach(walk);
  };
  walk(content);
  return lines.join("\n");
}
