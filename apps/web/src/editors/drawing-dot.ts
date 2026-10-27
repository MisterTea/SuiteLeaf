import { freshName, indentAt, insertLineBefore, lineOf, removeRanges } from "./drawing-text";

/** Graphviz DOT source, read well enough to find and edit its nodes and edges in place. */

type Token = {
  kind: "id" | "edge" | "punct";
  text: string;
  /** An id's value: unquoted and unescaped. */
  value: string;
  start: number;
  end: number;
  html?: boolean;
};

const BARE = /[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*/y;
const NUMERAL = /-?(?:\.\d+|\d+(?:\.\d*)?)/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const startsLine = (at: number) => !source.slice(source.lastIndexOf("\n", at - 1) + 1, at).trim();
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (source.startsWith("//", i) || (ch === "#" && startsLine(i))) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    const start = i;
    if (ch === '"') {
      i++;
      while (i < source.length && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
      i = Math.min(source.length, i + 1);
      const text = source.slice(start, i);
      tokens.push({ kind: "id", text, value: text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\n/g, ""), start, end: i });
      continue;
    }
    if (ch === "<") {
      let depth = 0;
      for (; i < source.length; i++) {
        if (source[i] === "<") depth++;
        else if (source[i] === ">" && --depth === 0) break;
      }
      i = Math.min(source.length, i + 1);
      const text = source.slice(start, i);
      tokens.push({ kind: "id", text, value: text.slice(1, -1), start, end: i, html: true });
      continue;
    }
    if (source.startsWith("->", i) || source.startsWith("--", i)) {
      i += 2;
      tokens.push({ kind: "edge", text: source.slice(start, i), value: source.slice(start, i), start, end: i });
      continue;
    }
    for (const pattern of [NUMERAL, BARE]) {
      pattern.lastIndex = i;
      const match = pattern.exec(source);
      if (match) {
        i += match[0].length;
        tokens.push({ kind: "id", text: match[0], value: match[0], start, end: i });
        break;
      }
    }
    if (i > start) continue;
    i++;
    tokens.push({ kind: "punct", text: ch, value: ch, start, end: i });
  }
  return tokens;
}

type Attr = { key: Token; value: Token | null };
type AttrList = { open: number; close: number; attrs: Attr[] };
export type DotNodeStatement = { id: string; token: Token; lists: AttrList[]; start: number; end: number };
export type DotEdgeStatement = { ids: string[]; start: number; end: number };
export type DotGraph = {
  directed: boolean;
  /** Offset of the `}` that closes the graph, or the end of the source. */
  close: number;
  /** The first statement inside the graph, for matching its indentation. */
  firstStatement: number | null;
  nodes: DotNodeStatement[];
  edges: DotEdgeStatement[];
  /** Every place a node's id appears as a node, in order. */
  mentions: Map<string, number[]>;
};

const KEYWORDS = new Set(["graph", "digraph", "node", "edge", "subgraph", "strict"]);
const keyword = (token: Token | undefined, word: string) =>
  token?.kind === "id" && !token.text.startsWith('"') && token.text.toLowerCase() === word;

export function parseDot(source: string): DotGraph {
  const tokens = tokenize(source);
  const graph: DotGraph = {
    directed: true,
    close: source.length,
    firstStatement: null,
    nodes: [],
    edges: [],
    mentions: new Map(),
  };
  let i = 0;
  const peek = (ahead = 0) => tokens[i + ahead];
  const punct = (text: string, ahead = 0) => peek(ahead)?.kind === "punct" && peek(ahead)?.text === text;
  const mention = (token: Token) => {
    const list = graph.mentions.get(token.value) ?? [];
    list.push(token.start);
    graph.mentions.set(token.value, list);
  };
  const attrLists = (): AttrList[] => {
    const lists: AttrList[] = [];
    while (punct("[")) {
      const open = peek().start;
      i++;
      const attrs: Attr[] = [];
      while (peek() && !punct("]")) {
        const key = peek();
        if (key.kind !== "id") {
          i++;
          continue;
        }
        i++;
        let value: Token | null = null;
        if (punct("=")) {
          i++;
          if (peek()?.kind === "id") value = tokens[i++];
        }
        attrs.push({ key, value });
        if (punct(",") || punct(";")) i++;
      }
      const close = peek()?.start ?? source.length;
      if (peek()) i++;
      lists.push({ open, close, attrs });
    }
    return lists;
  };
  const nodeRef = (): Token | null => {
    const token = peek();
    if (token?.kind !== "id") return null;
    i++;
    mention(token);
    while (punct(":") && peek(1)?.kind === "id") i += 2;
    return token;
  };
  const statements = (depth: number) => {
    while (peek() && !punct("}")) {
      if (punct(";") || punct(",")) {
        i++;
        continue;
      }
      if (depth === 0 && graph.firstStatement === null) graph.firstStatement = peek().start;
      statement();
    }
  };
  const subgraph = () => {
    if (keyword(peek(), "subgraph")) {
      i++;
      if (peek()?.kind === "id") i++;
    }
    if (punct("{")) {
      i++;
      statements(1);
      if (punct("}")) i++;
    }
  };
  const endpoint = (ids: string[]) => {
    if (keyword(peek(), "subgraph") || punct("{")) {
      subgraph();
      return true;
    }
    const token = nodeRef();
    if (token) ids.push(token.value);
    return !!token;
  };
  const statementEnd = () => (punct(";") ? peek().end : tokens[i - 1].end);
  const statement = () => {
    const first = peek();
    const start = first.start;
    if ((keyword(first, "graph") || keyword(first, "node") || keyword(first, "edge")) && punct("[", 1)) {
      i++;
      attrLists();
      return;
    }
    if (first.kind === "id" && punct("=", 1)) {
      i += 2;
      if (peek()?.kind === "id") i++;
      return;
    }
    const ids: string[] = [];
    const head = first.kind === "id" && !keyword(first, "subgraph") ? first : null;
    if (!endpoint(ids)) {
      i++;
      return;
    }
    if (peek()?.kind === "edge") {
      while (peek()?.kind === "edge") {
        i++;
        if (!endpoint(ids)) break;
      }
      attrLists();
      graph.edges.push({ ids, start, end: statementEnd() });
      return;
    }
    if (!head) return;
    const lists = attrLists();
    graph.nodes.push({ id: head.value, token: head, lists, start, end: statementEnd() });
  };

  if (keyword(peek(), "strict")) i++;
  if (keyword(peek(), "graph")) graph.directed = false;
  if (keyword(peek(), "graph") || keyword(peek(), "digraph")) i++;
  if (peek()?.kind === "id" && !punct("{")) i++;
  if (punct("{")) {
    i++;
    statements(0);
    if (punct("}")) graph.close = peek().start;
  }
  return graph;
}

/** An id written so DOT reads it back the same. */
export function dotId(id: string) {
  if (/^[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*$/.test(id) && !KEYWORDS.has(id.toLowerCase())) return id;
  if (/^-?(?:\.\d+|\d+(?:\.\d*)?)$/.test(id)) return id;
  return `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function labelAttr(graph: DotGraph, id: string) {
  for (const node of graph.nodes)
    if (node.id === id)
      for (const list of node.lists)
        for (const attr of list.attrs) if (attr.key.value === "label" && attr.value) return attr.value;
  return null;
}

/** What a node shows: its label, or its id. `html` labels can only be changed in the source. */
export function dotLabel(source: string, id: string) {
  const value = labelAttr(parseDot(source), id);
  if (!value) return { text: id, html: false };
  return { text: value.html ? value.value : value.value.replace(/\\n/g, "\n"), html: !!value.html };
}

function statementIndent(source: string, graph: DotGraph) {
  return graph.firstStatement === null ? "    " : indentAt(source, graph.firstStatement) || "    ";
}

function addStatement(source: string, graph: DotGraph, statement: string) {
  return insertLineBefore(source, graph.close, statementIndent(source, graph), statement);
}

export function renameDotNode(source: string, id: string, label: string): string {
  const graph = parseDot(source);
  const quoted = `"${label.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  const value = labelAttr(graph, id);
  if (value) return source.slice(0, value.start) + quoted + source.slice(value.end);
  const node = graph.nodes.find((n) => n.id === id);
  const list = node?.lists[0];
  if (list) {
    const empty = !source.slice(list.open + 1, list.close).trim();
    const text = empty ? `label=${quoted}` : `, label=${quoted}`;
    let at = list.close;
    while (at > list.open + 1 && /\s/.test(source[at - 1])) at--;
    return source.slice(0, at) + text + source.slice(at);
  }
  if (node) return source.slice(0, node.token.end) + ` [label=${quoted}]` + source.slice(node.token.end);
  return addStatement(source, graph, `${dotId(id)} [label=${quoted}];`);
}

export function addDotNode(source: string, label = "New node"): { source: string; id: string } {
  const graph = parseDot(source);
  const id = freshName("node", new Set(graph.mentions.keys()));
  const quoted = `"${label.replace(/"/g, '\\"')}"`;
  return { source: addStatement(source, graph, `${id} [label=${quoted}];`), id };
}

export function connectDotNodes(source: string, from: string, to: string): string {
  const graph = parseDot(source);
  return addStatement(source, graph, `${dotId(from)} ${graph.directed ? "->" : "--"} ${dotId(to)};`);
}

/** Remove a node's own statements and every edge that touches it. */
export function removeDotNode(source: string, id: string): string {
  const graph = parseDot(source);
  const ranges = [
    ...graph.nodes.filter((n) => n.id === id),
    ...graph.edges.filter((e) => e.ids.includes(id)),
  ];
  return ranges.length ? removeRanges(source, ranges) : source;
}

/** The line that best shows a node in the source: its own statement, or where it first appears. */
export function dotNodeLine(source: string, id: string): number | null {
  const graph = parseDot(source);
  const node = graph.nodes.find((n) => n.id === id);
  const at = node?.start ?? graph.mentions.get(id)?.[0];
  return at === undefined ? null : lineOf(source, at);
}

/** The node a line of source is about: the first node statement or edge end on it. */
export function dotNodeOnLine(source: string, line: number): string | null {
  const graph = parseDot(source);
  let best: { at: number; id: string } | null = null;
  for (const [id, offsets] of graph.mentions)
    for (const at of offsets)
      if (lineOf(source, at) === line && (!best || at < best.at)) best = { at, id };
  return best?.id ?? null;
}
