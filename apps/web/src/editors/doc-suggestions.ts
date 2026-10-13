import { Extension, Mark } from "@tiptap/core";
import type { Mark as PmMark, Node as PmNode } from "@tiptap/pm/model";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export type SuggestionMode = "editing" | "suggesting";
export type SuggestionPluginState = { mode: SuggestionMode; author: string };
export const suggestionKey = new PluginKey<SuggestionPluginState>("suiteleaf-suggestions");
/** Read by the editor during the same turn as a click, before plugin meta flushes. */
export const liveSuggestion: SuggestionPluginState = { mode: "editing", author: "" };

const FORMAT = ["bold", "italic", "underline"] as const;
type Char = { ch: string; pos: number; marks: readonly PmMark[] };

function charsOf(doc: PmNode): Char[] {
  const out: Char[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (let i = 0; i < node.text.length; i++)
      out.push({ ch: node.text[i], pos: pos + i, marks: node.marks });
  });
  return out;
}
function suggestionOf(
  marks: readonly PmMark[],
  kind?: string,
  author?: string,
  property?: string,
) {
  return marks.find(
    (mark) =>
      mark.type.name === "suggestion" &&
      (!kind || mark.attrs.kind === kind) &&
      (!author || mark.attrs.author === author) &&
      (!property || mark.attrs.property === property),
  );
}
function keptMarks(marks: readonly PmMark[]): PmMark[] {
  return marks.filter((mark) => mark.type.name !== "suggestion");
}
function sameMarks(a: readonly PmMark[], b: readonly PmMark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, index) => mark.eq(b[index]));
}
function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

type Hunk = { op: "eq" | "del" | "ins"; a0: number; a1: number; b0: number; b1: number };
function lcsDiff(a: string, b: string, originA = 0, originB = 0): Hunk[] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      hunks.push({
        op: "eq",
        a0: originA + i,
        a1: originA + i + 1,
        b0: originB + j,
        b1: originB + j + 1,
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      hunks.push({
        op: "del",
        a0: originA + i,
        a1: originA + i + 1,
        b0: originB + j,
        b1: originB + j,
      });
      i++;
    } else {
      hunks.push({
        op: "ins",
        a0: originA + i,
        a1: originA + i,
        b0: originB + j,
        b1: originB + j + 1,
      });
      j++;
    }
  }
  while (i < n) {
    hunks.push({
      op: "del",
      a0: originA + i,
      a1: originA + i + 1,
      b0: originB + m,
      b1: originB + m,
    });
    i++;
  }
  while (j < m) {
    hunks.push({
      op: "ins",
      a0: originA + n,
      a1: originA + n,
      b0: originB + j,
      b1: originB + j + 1,
    });
    j++;
  }
  return hunks;
}
function diff(a: string, b: string): Hunk[] {
  if (a.length * b.length <= 1_000_000) return mergeHunks(lcsDiff(a, b));
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  const hunks: Hunk[] = [];
  if (start) hunks.push({ op: "eq", a0: 0, a1: start, b0: 0, b1: start });
  const left = a.slice(start, aEnd);
  const right = b.slice(start, bEnd);
  if (left.length * right.length <= 250_000)
    hunks.push(...lcsDiff(left, right, start, start));
  else {
    if (left) hunks.push({ op: "del", a0: start, a1: aEnd, b0: start, b1: start });
    if (right) hunks.push({ op: "ins", a0: aEnd, a1: aEnd, b0: start, b1: bEnd });
  }
  if (aEnd < a.length) hunks.push({ op: "eq", a0: aEnd, a1: a.length, b0: bEnd, b1: b.length });
  return mergeHunks(hunks);
}
function mergeHunks(hunks: Hunk[]): Hunk[] {
  const out: Hunk[] = [];
  for (const hunk of hunks) {
    const prev = out.at(-1);
    if (prev && prev.op === hunk.op && prev.a1 === hunk.a0 && prev.b1 === hunk.b0) {
      prev.a1 = hunk.a1;
      prev.b1 = hunk.b1;
    } else out.push({ ...hunk });
  }
  return out;
}

function posFor(chars: Char[], index: number, doc: PmNode): number {
  if (index < chars.length) return chars[index].pos;
  if (chars.length) return chars[chars.length - 1].pos + 1;
  let fallback = 1;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      fallback = pos + 1;
      return false;
    }
  });
  return fallback;
}

function levelOf(node: PmNode): string {
  return node.type.name === "heading" ? String(node.attrs.level ?? 1) : "0";
}
function textblocks(doc: PmNode): { node: PmNode; pos: number }[] {
  const out: { node: PmNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    out.push({ node, pos });
    return false;
  });
  return out;
}

/**
 * Turns a suggesting-mode edit into marks. The returned transaction is appended
 * to the original one, so one undo removes both the keystroke and its mark.
 */
export function trackSuggestions(
  oldDoc: PmNode,
  state: EditorState,
  author: string,
): Transaction | null {
  const suggestion = state.schema.marks.suggestion;
  if (!suggestion) return null;
  const name = author.trim() || "Someone";
  const time = new Date().toISOString();
  const oldChars = charsOf(oldDoc);
  const nextChars = charsOf(state.doc);
  const hunks = diff(
    oldChars.map((char) => char.ch).join(""),
    nextChars.map((char) => char.ch).join(""),
  );
  const tr = state.tr;
  type Group = { at: number; nodes: PmNode[] };
  const groups: Group[] = [];
  const insertions: { from: number; to: number; id: string; time: string }[] = [];

  for (const hunk of hunks) {
    if (hunk.op === "del") {
      const chars = oldChars.slice(hunk.a0, hunk.a1);
      const at = posFor(nextChars, hunk.b0, state.doc);
      let buf: Char[] = [];
      let extra: PmMark | null = null;
      const flush = () => {
        if (!buf.length || !extra) return;
        const nodes: PmNode[] = [];
        let text = "";
        let marks: PmMark[] | null = null;
        const push = () => {
          if (text && marks) nodes.push(state.schema.text(text, marks));
          text = "";
        };
        for (const char of buf) {
          const next = [...keptMarks(char.marks), extra];
          if (marks && !sameMarks(marks, next)) push();
          marks = next;
          text += char.ch;
        }
        push();
        if (nodes.length) groups.push({ at, nodes });
        buf = [];
        extra = null;
      };
      for (const char of chars) {
        const own = suggestionOf(char.marks, "insert", name);
        if (own) {
          flush();
          continue;
        }
        const existing = suggestionOf(char.marks, "delete");
        if (!extra || (existing && !extra.eq(existing))) {
          flush();
          extra =
            existing ??
            suggestion.create({
              id: newId(),
              kind: "delete",
              author: name,
              time,
              property: null,
              before: null,
              after: null,
            });
        }
        buf.push(char);
      }
      flush();
    } else if (hunk.op === "ins" && hunk.b1 > hunk.b0) {
      const before = nextChars[hunk.b0 - 1];
      const after = nextChars[hunk.b1];
      const neighbor =
        suggestionOf(before?.marks ?? [], "insert", name) ??
        suggestionOf(after?.marks ?? [], "insert", name);
      insertions.push({
        from: nextChars[hunk.b0].pos,
        to: nextChars[hunk.b1 - 1].pos + 1,
        id: neighbor ? String(neighbor.attrs.id) : newId(),
        time: neighbor ? String(neighbor.attrs.time) : time,
      });
    }
  }

  groups.sort((a, b) => b.at - a.at);
  let cursor: number | null = null;
  for (const group of groups) {
    let pos = group.at;
    if (cursor === null || group.at < cursor) cursor = group.at;
    for (const node of group.nodes) {
      const parent = tr.doc.resolve(Math.min(pos, tr.doc.content.size)).parent;
      if (!parent.isTextblock) break;
      tr.insert(pos, node);
      pos += node.nodeSize;
    }
  }
  for (const insertion of insertions) {
    const from = tr.mapping.map(insertion.from, 1);
    const to = tr.mapping.map(insertion.to, -1);
    if (from >= to) continue;
    tr.addMark(
      from,
      to,
      suggestion.create({
        id: insertion.id,
        kind: "insert",
        author: name,
        time: insertion.time,
        property: null,
        before: null,
        after: null,
      }),
    );
  }

  const oldText = oldChars.map((char) => char.ch).join("");
  const newText = nextChars.map((char) => char.ch).join("");
  if (oldText === newText) {
    type Span = { from: number; to: number; property: string; before: string; after: string; id?: string; time?: string; remove?: PmMark };
    const spans: Span[] = [];
    let active: Span | null = null;
    const flush = () => {
      if (active) spans.push(active);
      active = null;
    };
    for (let index = 0; index < oldChars.length; index++) {
      const was = oldChars[index];
      const now = nextChars[index];
      for (const property of FORMAT) {
        const beforeOn = was.marks.some((mark) => mark.type.name === property);
        const afterOn = now.marks.some((mark) => mark.type.name === property);
        if (beforeOn === afterOn) continue;
        const existing = suggestionOf(now.marks, "format", name, property);
        const same =
          existing &&
          existing.attrs.property === property &&
          existing.attrs.author === name;
        const reverted = same && String(afterOn) === String(existing?.attrs.before);
        const id = same && !reverted ? String(existing?.attrs.id) : undefined;
        const when = same && !reverted ? String(existing?.attrs.time) : time;
        if (
          active &&
          active.property === property &&
          active.after === String(afterOn) &&
          active.before === String(beforeOn) &&
          active.remove === (reverted ? existing : undefined) &&
          active.id === id &&
          active.to === now.pos
        ) {
          active.to = now.pos + 1;
        } else {
          flush();
          active = {
            from: now.pos,
            to: now.pos + 1,
            property,
            before: String(beforeOn),
            after: String(afterOn),
            id,
            time: when,
            remove: reverted ? existing : undefined,
          };
        }
      }
    }
    flush();
    for (const span of spans) {
      const from = tr.mapping.map(span.from, 1);
      const to = tr.mapping.map(span.to, -1);
      if (from >= to) continue;
      if (span.remove) tr.removeMark(from, to, span.remove);
      else
        tr.addMark(
          from,
          to,
          suggestion.create({
            id: span.id ?? newId(),
            kind: "format",
            author: name,
            time: span.time ?? time,
            property: span.property,
            before: span.before,
            after: span.after,
          }),
        );
    }
  }

  const beforeBlocks = textblocks(oldDoc);
  const afterBlocks = textblocks(state.doc);
  if (
    beforeBlocks.length === afterBlocks.length &&
    beforeBlocks.every((block, index) => block.node.textContent === afterBlocks[index].node.textContent)
  ) {
    afterBlocks.forEach((block, index) => {
      const previous = beforeBlocks[index].node;
      const was = levelOf(previous);
      const now = levelOf(block.node);
      if (was === now) return;
      const existing = (block.node.attrs.suggestionHeading ??
        previous.attrs.suggestionHeading) as
        | { id?: string; author?: string; time?: string; before?: string; after?: string }
        | null;
      const own = existing && existing.author === name ? existing : null;
      const pos = tr.mapping.map(block.pos, 1);
      if (own && own.before === now) {
        const attrs = { ...tr.doc.nodeAt(pos)?.attrs };
        delete attrs.suggestionHeading;
        if (tr.doc.nodeAt(pos)?.attrs.suggestionHeading)
          tr.setNodeMarkup(pos, undefined, attrs);
        return;
      }
      tr.setNodeMarkup(pos, undefined, {
        ...block.node.attrs,
        suggestionHeading: {
          id: own?.id ?? newId(),
          author: name,
          time: own?.time ?? time,
          before: own?.before ?? was,
          after: now,
        },
      });
    });
  }

  if (!tr.steps.length) return null;
  if (cursor !== null) {
    const at = tr.mapping.map(cursor, -1);
    try {
      tr.setSelection(TextSelection.create(tr.doc, at));
    } catch {
      /* The caret stays where the edit left it when the position is structural. */
    }
  }
  tr.setMeta("suggestion-skip", true);
  return tr;
}

export function suggestionPlugin(): Plugin<SuggestionPluginState> {
  return new Plugin({
    key: suggestionKey,
    state: {
      init: (_config, state) => ({
        mode: state.doc.attrs.editingMode === "suggesting" ? "suggesting" : "editing",
        author: "",
      }),
      apply(tr, value) {
        return tr.getMeta(suggestionKey) ?? value;
      },
    },
    appendTransaction(trs, oldState, newState) {
      const pluginState = suggestionKey.getState(newState);
      const mode = liveSuggestion.mode === "suggesting" || pluginState?.mode === "suggesting"
        ? "suggesting"
        : "editing";
      if (mode !== "suggesting") return null;
      if (trs.some((tr) => tr.getMeta("suggestion-skip") || isHistoryTransaction(tr)))
        return null;
      if (!trs.some((tr) => tr.docChanged && tr.getMeta("addToHistory") !== false))
        return null;
      return trackSuggestions(
        oldState.doc,
        newState,
        liveSuggestion.author || pluginState?.author || "",
      );
    },
  });
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestion: {
      setSuggestionState: (state: SuggestionPluginState) => ReturnType;
    };
  }
}

export const SuggestionMark = Mark.create({
  name: "suggestion",
  inclusive: false,
  excludes: "",
  keepOnSplit: false,
  addAttributes() {
    return {
      id: { default: "" },
      kind: { default: "insert" },
      author: { default: "" },
      time: { default: "" },
      property: { default: null },
      before: { default: null },
      after: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-suggestion]" }];
  },
  renderHTML({ mark }) {
    const kind = String(mark.attrs.kind ?? "insert");
    return [
      "span",
      {
        "data-suggestion": mark.attrs.id,
        "data-suggestion-kind": kind,
        "data-suggestion-author": mark.attrs.author,
        "data-suggestion-time": mark.attrs.time,
        "data-property": mark.attrs.property || undefined,
        "data-before": mark.attrs.before || undefined,
        class: `suggestion suggestion-${kind}`,
      },
      0,
    ];
  },
});

export const Suggestions = Extension.create({
  name: "suggestions",
  addExtensions() {
    return [SuggestionMark];
  },
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: { editingMode: { default: "editing", rendered: false } },
      },
      {
        types: ["paragraph", "heading"],
        attributes: {
          suggestionHeading: {
            default: null,
            renderHTML: (attrs) => {
              const heading = attrs.suggestionHeading as
                | { id?: string; author?: string; time?: string; before?: string; after?: string }
                | null;
              if (!heading?.id) return {};
              return {
                "data-suggestion-heading": heading.id,
                "data-suggestion-author": heading.author,
                "data-suggestion-time": heading.time,
                "data-before": heading.before,
                "data-after": heading.after,
              };
            },
            parseHTML: (element) => {
              const id = element.getAttribute("data-suggestion-heading");
              if (!id) return null;
              return {
                id,
                author: element.getAttribute("data-suggestion-author") ?? "",
                time: element.getAttribute("data-suggestion-time") ?? "",
                before: element.getAttribute("data-before") ?? "0",
                after: element.getAttribute("data-after") ?? "1",
              };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setSuggestionState:
        (next) =>
        ({ tr, dispatch }) => {
          liveSuggestion.mode = next.mode;
          liveSuggestion.author = next.author;
          tr.setMeta(suggestionKey, { ...next });
          tr.setMeta("suggestion-skip", true);
          tr.setMeta("addToHistory", false);
          const mode = tr.doc.attrs.editingMode === "suggesting" ? "suggesting" : "editing";
          if (mode !== next.mode) tr.setDocAttribute("editingMode", next.mode);
          dispatch?.(tr);
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [suggestionPlugin()];
  },
});

export function replaceDocument(state: EditorState, json: unknown): Transaction {
  const node = state.schema.nodeFromJSON(json);
  // Review actions must stay their own undo step, even when they happen in a burst.
  return closeHistory(
    state.tr
      .replaceWith(0, state.doc.content.size, node.content)
      .setMeta("suggestion-skip", true),
  );
}
