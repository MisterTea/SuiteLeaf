import { appendLine, freshName, indentAt, lineOf, lineRange, removeRanges } from "./drawing-text";

/**
 * Mermaid flowchart source, read well enough to find each node and its label
 * where they were typed. Other diagram kinds are edited through their text.
 */

export type MermaidLabel = {
  /** The label's text, inside any quotes. */
  start: number;
  end: number;
  /** The label as written between the shape's brackets, quotes included. */
  bodyStart: number;
  bodyEnd: number;
};
export type MermaidNode = { id: string; start: number; end: number; label: MermaidLabel | null };

/** The line that names the diagram, past front matter, blank lines, and comments. */
function header(source: string) {
  const lines = source.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  for (; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text && !text.startsWith("%%")) return { line: i, text };
  }
  return null;
}

export function isFlowchart(source: string) {
  return /^(flowchart|graph)\b/i.test(header(source)?.text ?? "");
}

const SHAPES: [string, string[]][] = [
  ["(((", [")))"]],
  ["([", ["])"]],
  ["[[", ["]]"]],
  ["[(", [")]"]],
  ["((", ["))"]],
  ["{{", ["}}"]],
  ["[/", ["/]", "\\]"]],
  ["[\\", ["\\]", "/]"]],
  ["[", ["]"]],
  ["(", [")"]],
  ["{", ["}"]],
  [">", ["]"]],
];
const ID = /[\p{L}\p{N}_]+/uy;
const LINK = /\s*(?:<|x|o)?(?:-{2,}[->xo]?|={2,}[=>xo]?|-\.+-[>xo]?|~{3,})/y;
const LINK_END = /-{2,}[->xo]|={2,}[=>xo]|\.-[>xo]?|-{3,}/g;
const SKIPPED = /^\s*(%%|classDef\b|class\b|style\b|linkStyle\b|click\b|subgraph\b|end\b|direction\b|accTitle\b|accDescr\b)/;

function shapeAt(source: string, at: number, lineEnd: number): MermaidLabel & { after: number } | null {
  for (const [open, closers] of SHAPES) {
    if (!source.startsWith(open, at)) continue;
    const bodyStart = at + open.length;
    if (source[bodyStart] === '"') {
      const quote = source.indexOf('"', bodyStart + 1);
      if (quote < 0 || quote > lineEnd) return null;
      const closer = closers.find((c) => source.startsWith(c, quote + 1));
      if (!closer) return null;
      return { start: bodyStart + 1, end: quote, bodyStart, bodyEnd: quote + 1, after: quote + 1 + closer.length };
    }
    let best = -1;
    let closer = "";
    for (const c of closers) {
      const found = source.indexOf(c, bodyStart);
      if (found >= 0 && found <= lineEnd && (best < 0 || found < best)) [best, closer] = [found, c];
    }
    if (best < 0) return null;
    return { start: bodyStart, end: best, bodyStart, bodyEnd: best, after: best + closer.length };
  }
  return null;
}

/** Every place a flowchart names a node, in order. Empty for other diagram kinds. */
export function mermaidNodes(source: string): MermaidNode[] {
  const top = header(source);
  if (!top || !isFlowchart(source)) return [];
  const nodes: MermaidNode[] = [];
  const lines = source.split("\n");
  let offset = 0;
  for (let line = 0; line < lines.length; offset += lines[line].length + 1, line++) {
    if (line <= top.line || SKIPPED.test(lines[line])) continue;
    const lineEnd = offset + lines[line].length;
    let at = offset;
    while (at < lineEnd) {
      const ch = source[at];
      if (/[\s;&]/.test(ch)) {
        at++;
        continue;
      }
      ID.lastIndex = at;
      const id = ID.exec(source)?.[0];
      if (!id) {
        at++;
        continue;
      }
      const end = at + id.length;
      const shape = shapeAt(source, end, lineEnd);
      nodes.push({
        id,
        start: at,
        end,
        label: shape ? { start: shape.start, end: shape.end, bodyStart: shape.bodyStart, bodyEnd: shape.bodyEnd } : null,
      });
      at = shape?.after ?? end;
      const style = /^:::[\w-]+/.exec(source.slice(at, lineEnd));
      if (style) at += style[0].length;
      LINK.lastIndex = at;
      const link = LINK.exec(source);
      if (!link || link.index !== at) continue;
      at += link[0].length;
      const bare = link[0].trim();
      if (bare === "--" || bare === "==" || bare === "-.") {
        LINK_END.lastIndex = at;
        const close = LINK_END.exec(source.slice(0, lineEnd));
        at = close ? close.index + close[0].length : lineEnd;
      }
      while (at < lineEnd && /\s/.test(source[at])) at++;
      if (source[at] === "|") {
        const bar = source.indexOf("|", at + 1);
        at = bar < 0 || bar > lineEnd ? lineEnd : bar + 1;
      }
    }
  }
  return nodes;
}

/** What a node shows: the label it was first given, or its id. */
export function mermaidLabel(source: string, id: string) {
  const labelled = mermaidNodes(source).find((n) => n.id === id && n.label);
  return labelled?.label ? source.slice(labelled.label.start, labelled.label.end) : id;
}

function labelBody(label: string) {
  const text = label.replace(/\n/g, "<br>");
  return /^[^"[\](){}<>|#;]*$/.test(text) && text.trim() === text && text ? text : `"${text.replace(/"/g, "#quot;")}"`;
}

export function renameMermaidNode(source: string, id: string, label: string): string {
  const nodes = mermaidNodes(source).filter((n) => n.id === id);
  const labelled = nodes.find((n) => n.label);
  const body = labelBody(label);
  if (labelled?.label)
    return source.slice(0, labelled.label.bodyStart) + body + source.slice(labelled.label.bodyEnd);
  const first = nodes[0];
  if (!first) return source;
  return `${source.slice(0, first.end)}[${body}]${source.slice(first.end)}`;
}

function statementIndent(source: string) {
  const first = mermaidNodes(source)[0];
  return first ? indentAt(source, first.start) || "    " : "    ";
}

export function addMermaidNode(source: string, label = "New node"): { source: string; id: string } {
  const id = freshName("node", new Set(mermaidNodes(source).map((n) => n.id)));
  return { source: appendLine(source, `${statementIndent(source)}${id}[${labelBody(label)}]`), id };
}

export function connectMermaidNodes(source: string, from: string, to: string): string {
  return appendLine(source, `${statementIndent(source)}${from} --> ${to}`);
}

/** Remove every line that names the node, so its edges and styles go with it. */
export function removeMermaidNode(source: string, id: string): string {
  const lines = new Set(mermaidNodes(source).filter((n) => n.id === id).map((n) => lineOf(source, n.start)));
  const styled = new RegExp(`^\\s*(style|click)\\s+${id}\\b`);
  source.split("\n").forEach((text, line) => {
    if (styled.test(text)) lines.add(line);
  });
  if (!lines.size) return source;
  return removeRanges(source, [...lines].map((line) => lineRange(source, line)));
}

export function mermaidNodeLine(source: string, id: string): number | null {
  const nodes = mermaidNodes(source).filter((n) => n.id === id);
  const best = nodes.find((n) => n.label) ?? nodes[0];
  return best ? lineOf(source, best.start) : null;
}

export function mermaidNodeOnLine(source: string, line: number): string | null {
  return mermaidNodes(source).find((n) => lineOf(source, n.start) === line)?.id ?? null;
}

const squash = (text: string) => text.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();

/** The first line, past the header, whose text holds what a diagram shows. */
export function lineWithText(source: string, text: string): number | null {
  const wanted = squash(text);
  if (!wanted) return null;
  const lines = source.split("\n");
  const from = (header(source)?.line ?? -1) + 1;
  for (let line = from; line < lines.length; line++) if (squash(lines[line]).includes(wanted)) return line;
  return null;
}

/** Replace the first exact use of `from` on one line. */
export function replaceOnLine(source: string, line: number, from: string, to: string): string {
  const range = lineRange(source, line);
  const at = source.indexOf(from, range.start);
  if (!from || at < 0 || at + from.length > range.end) return source;
  return source.slice(0, at) + to + source.slice(at + from.length);
}
