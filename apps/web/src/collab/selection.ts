export type RemoteCaret = { name: string; anchor: number; head: number };

const LIMIT = 1_000_000;

function offset(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return;
  if (value < 0 || value > LIMIT) return;
  return value;
}

/** A caret position. Document text is not included. */
export function localSelectionMessage(
  anchor: number,
  head: number,
): { type: "selection"; anchor: number; head: number } | null {
  const start = offset(anchor);
  const end = offset(head);
  if (start === undefined || end === undefined) return null;
  return { type: "selection", anchor: start, head: end };
}

/** Another person's caret. A message that carries document text is ignored. */
export function remoteCaret(message: unknown, selfName: string): RemoteCaret | null {
  if (!message || typeof message !== "object") return null;
  const row = message as Record<string, unknown>;
  if (row.type !== "selection") return null;
  if ("text" in row || "update" in row) return null;
  if (typeof row.name !== "string" || !row.name || row.name === selfName) return null;
  const anchor = offset(row.anchor);
  const head = offset(row.head);
  if (anchor === undefined || head === undefined) return null;
  return { name: row.name, anchor, head };
}
