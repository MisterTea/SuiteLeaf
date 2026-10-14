import type { JsonNode } from "./index";

export interface DocDiff {
  /** The older document with later additions and removals marked inline. */
  content: JsonNode;
  /** Top-level blocks that were inserted, removed, or edited. */
  changedParagraphs: number;
}

const insertion = [
  { type: "underline" },
  { type: "textStyle", attrs: { color: "#137333" } },
];
const deletion = [
  { type: "strike" },
  { type: "textStyle", attrs: { color: "#c5221f" } },
];

type Mark = "same" | "ins" | "del";

function textOf(node: JsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function marked(text: string, mark: Mark): JsonNode {
  if (mark === "same") return { type: "text", text };
  return {
    type: "text",
    text,
    marks: mark === "ins" ? insertion : deletion,
  };
}

function paint(node: JsonNode, mark: Exclude<Mark, "same">): JsonNode {
  if (node.text) return { ...marked(node.text, mark), marks: marked(node.text, mark).marks };
  if (!node.content?.length) return node;
  return { ...node, content: node.content.map((child) => paint(child, mark)) };
}

function wordDiff(before: JsonNode, after: JsonNode): JsonNode {
  const a = textOf(before).split(/(\s+)/);
  const b = textOf(after).split(/(\s+)/);
  const pairs = lcs(a, b, (x, y) => x === y);
  const content: JsonNode[] = [];
  const push = (text: string, mark: Mark) => {
    if (!text) return;
    const last = content[content.length - 1];
    const lastMark = !last?.marks ? "same" : last.marks.some((m) => m.type === "strike") ? "del" : "ins";
    if (last?.text && lastMark === mark) last.text += text;
    else content.push(marked(text, mark));
  };
  let i = 0;
  let j = 0;
  const flush = (bi: number, bj: number) => {
    for (const token of a.slice(i, bi)) push(token, "del");
    for (const token of b.slice(j, bj)) push(token, "ins");
    i = bi;
    j = bj;
  };
  for (const [bi, bj] of pairs) {
    flush(bi, bj);
    push(a[bi], "same");
    i = bi + 1;
    j = bj + 1;
  }
  flush(a.length, b.length);
  return {
    type: before.type,
    attrs: before.attrs,
    content: content.length ? content : [{ type: "text", text: "" }],
  };
}

/**
 * Compare `before` with `after`. Text only in `before` is struck through in
 * red (removed). Text only in `after` is underlined in green (added).
 * Equal blocks stay as they were. Inside a gap between equal blocks, blocks
 * are paired in order so a rewritten paragraph counts once.
 */
export function diffDocuments(before: JsonNode, after: JsonNode): DocDiff {
  const base = before.content ?? [];
  const next = after.content ?? [];
  const same = (a: JsonNode, b: JsonNode) =>
    a.type === b.type && textOf(a) === textOf(b);
  const pairs = lcs(base, next, same);
  const blocks: JsonNode[] = [];
  let changed = 0;
  let i = 0;
  let j = 0;
  const flush = (bi: number, bj: number) => {
    const left = base.slice(i, bi);
    const right = next.slice(j, bj);
    const paired = Math.min(left.length, right.length);
    for (let k = 0; k < paired; k++) {
      if (left[k].type === right[k].type) {
        blocks.push(wordDiff(left[k], right[k]));
        changed++;
      } else {
        blocks.push(paint(left[k], "del"), paint(right[k], "ins"));
        changed += 2;
      }
    }
    for (const block of left.slice(paired)) {
      blocks.push(paint(block, "del"));
      changed++;
    }
    for (const block of right.slice(paired)) {
      blocks.push(paint(block, "ins"));
      changed++;
    }
    i = bi;
    j = bj;
  };
  for (const [bi, bj] of pairs) {
    flush(bi, bj);
    blocks.push(base[bi]);
    i = bi + 1;
    j = bj + 1;
  }
  flush(base.length, next.length);
  return {
    content: { type: "doc", content: blocks },
    changedParagraphs: changed,
  };
}
