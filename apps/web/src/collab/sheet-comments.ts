import * as Y from "yjs";

const LOCAL = "sheet-local";

/** A comment id that can be stored. A line break is refused. */
export function commentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 80 || /[\u0000-\u001f]/.test(id)) return null;
  return id;
}

function sheetId(value: unknown): string | null {
  return commentId(value);
}

type Mutation = { id?: string; params?: unknown };

function mutationsOf(op: unknown): Mutation[] {
  if (!op || typeof op !== "object" || !("mutations" in op)) return [];
  const mutations = (op as { mutations?: unknown }).mutations;
  return Array.isArray(mutations) ? (mutations as Mutation[]) : [];
}

function commentRole(op: unknown): string | null {
  if (!op || typeof op !== "object" || !("role" in op)) return null;
  const role = (op as { role?: unknown }).role;
  return typeof role === "string" ? role : null;
}

/** Viewers do not add comments. Commenters do. */
export function commentWriteAllowed(op: unknown): boolean {
  const role = commentRole(op);
  return role !== "viewer" && role !== "view";
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    const value = letter.charCodeAt(0) - 64;
    if (value < 1 || value > 26) return -1;
    index = index * 26 + value;
  }
  return index - 1;
}

/** The first cell of an anchor such as `A3` or `A3:B4`. A sheet prefix is left out. `"skip"` is past the sheet. */
function anchorCell(ref: string): { row: number; column: number } | "skip" | null {
  const body = ref.includes("!") ? ref.slice(ref.lastIndexOf("!") + 1) : ref;
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?[A-Za-z]{1,3}\$?\d+)?$/.exec(body);
  if (!match) return null;
  const row = Number(match[2]) - 1;
  const column = columnIndex(match[1]);
  if (column < 0 || row < 0 || row > 1_048_575) return "skip";
  return { row, column };
}

function storedComment(json: string): { sheetId: string | null; body: Record<string, unknown> } | null {
  try {
    const value = JSON.parse(json) as { sheetId?: unknown; body?: unknown };
    if (!value.body || typeof value.body !== "object" || Array.isArray(value.body)) return null;
    return {
      sheetId: sheetId(value.sheetId),
      body: value.body as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * Sheet comments after this edit. A viewer is ignored. The map passed in is not changed.
 */
export function projectSheetComments(entries: Iterable<[string, string]>, op: unknown): Map<string, string> {
  const comments = new Map(entries);
  if (!commentWriteAllowed(op)) return comments;
  for (const mutation of mutationsOf(op)) {
    if (!mutation || typeof mutation !== "object" || !mutation.id || !mutation.params || typeof mutation.params !== "object") {
      continue;
    }
    const params = mutation.params as {
      subUnitId?: unknown;
      comment?: unknown;
      commentId?: unknown;
      payload?: unknown;
      resolved?: unknown;
    };
    const sheet = sheetId(params.subUnitId);
    if (mutation.id.includes("add-comment")) {
      const comment = params.comment;
      if (!comment || typeof comment !== "object" || Array.isArray(comment)) continue;
      const id = commentId((comment as { id?: unknown }).id);
      if (!id) continue;
      try {
        const json = JSON.stringify({ sheetId: sheet, body: comment });
        if (json !== undefined) comments.set(id, json);
      } catch {
        continue;
      }
      continue;
    }
    if (mutation.id.includes("update-comment-ref")) {
      const payload = params.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const id = commentId((payload as { commentId?: unknown }).commentId);
      const ref = (payload as { ref?: unknown }).ref;
      if (!id || typeof ref !== "string" || !comments.has(id)) continue;
      const text = ref.trim();
      if (!text || text.length > 64 || /[\u0000-\u001f]/.test(text)) continue;
      const previous = storedComment(comments.get(id)!);
      if (!previous) continue;
      const cell = anchorCell(text);
      if (cell === "skip") continue;
      comments.set(
        id,
        JSON.stringify({
          ...previous,
          body: {
            ...previous.body,
            ref: text,
            ...(cell ? { row: cell.row, column: cell.column } : {}),
          },
        }),
      );
      continue;
    }
    if (mutation.id.includes("update-comment") && !mutation.id.includes("update-comment-ref")) {
      const payload = params.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const id = commentId((payload as { id?: unknown }).id ?? params.commentId);
      if (!id) continue;
      const current = comments.get(id);
      const previous = current ? storedComment(current) : null;
      const body = { ...(previous?.body ?? {}), ...(payload as Record<string, unknown>) };
      comments.set(id, JSON.stringify({ sheetId: previous?.sheetId ?? sheet, body }));
      continue;
    }
    if (mutation.id.includes("resolve-comment")) {
      const id = commentId(params.commentId);
      if (!id || !comments.has(id)) continue;
      const previous = storedComment(comments.get(id)!);
      if (!previous) continue;
      comments.set(
        id,
        JSON.stringify({ ...previous, body: { ...previous.body, resolved: params.resolved === true } }),
      );
      continue;
    }
    if (mutation.id.includes("delete-comment")) {
      const id = commentId(params.commentId);
      if (id) comments.delete(id);
      continue;
    }
    if (mutation.id.includes("remove-sheet") && sheet) {
      for (const [id, json] of [...comments]) {
        if (storedComment(json)?.sheetId === sheet) comments.delete(id);
      }
    }
  }
  return comments;
}

export type SharedSheetComment = {
  id: string;
  sheetId: string | null;
  body: Record<string, unknown> | null;
};

/** Report comments that arrived from someone else. Local writes are ignored. */
export function watchRemoteSheetComments(
  doc: Y.Doc,
  apply: (changes: SharedSheetComment[]) => void,
): () => void {
  const comments = doc.getMap<string>("sheetComments");
  const observe = (event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    const changes: SharedSheetComment[] = [];
    for (const id of event.keysChanged) {
      if (!commentId(id)) continue;
      const json = comments.get(id);
      if (json == null) {
        changes.push({ id, sheetId: null, body: null });
        continue;
      }
      try {
        const value = JSON.parse(json) as { sheetId?: unknown; body?: unknown };
        if (!value.body || typeof value.body !== "object" || Array.isArray(value.body)) continue;
        changes.push({
          id,
          sheetId: typeof value.sheetId === "string" ? value.sheetId : null,
          body: value.body as Record<string, unknown>,
        });
      } catch {
        continue;
      }
    }
    if (changes.length) apply(changes);
  };
  comments.observe(observe);
  return () => comments.unobserve(observe);
}
