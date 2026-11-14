import { isCaretBreak, startsTextBlock } from "./slide-text-breaks";
import { readSlideMath } from "./slide-math";

function mathLength(node: Node): number | undefined {
  if (node instanceof HTMLElement && node.dataset.slideMath) {
    const run = readSlideMath(node.dataset.slideMath);
    if (run) return run.text.length;
  }
}


type Point = { node: Node; offset: number };

/** Map DOM positions to authored text, including implicit paragraph breaks. */
function positions(root: Node) {
  const offsets = new Map<Node, number | number[]>();
  const textRanges: { node: Node; start: number; end: number }[] = [];
  const carets = new Map<number, Point>();
  let length = 0;
  let newline = false;
  const visit = (node: Node, editable: boolean) => {
    const element = node instanceof HTMLElement ? node : null;
    const math = mathLength(node);
    const block = startsTextBlock(node);
    if (node !== root && block && ((length && !newline) || startsTextBlock(node.previousSibling))) {
      length++;
      newline = true;
    }
    if (element?.getAttribute("contenteditable") === "false" && node !== root) editable = false;
    const start = length;
    const points: number[] = [];
    offsets.set(node, points);
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      offsets.set(node, start);
      length += value.length;
      if (editable) textRanges.push({ node, start, end: length });
      if (value) newline = value.endsWith("\n");
    } else if (math != null || element?.tagName === "BR") {
      points.push(start);
      if (!element || !isCaretBreak(element)) {
        length += math ?? 1;
        newline = math == null;
      }
    } else {
      points.push(length);
      for (const child of node.childNodes) {
        visit(child, editable);
        points.push(length);
      }
      if (editable) points.forEach((at, offset) => {
        if (!carets.has(at)) carets.set(at, { node, offset });
      });
    }
  };
  visit(root, true);
  return { offsets, carets, textRanges, length };
}

export function semanticTextLength(root: Node): number {
  return positions(root).length;
}

export function semanticOffset(root: Node, node: Node, offset: number): number | undefined {
  const { offsets } = positions(root);
  const position = offsets.get(node);
  return typeof position === "number" ? position + offset : position?.[offset];
}

export function semanticPoint(root: Node, wanted: number, clamp = false): Point | undefined {
  const { carets, textRanges, length } = positions(root);
  if (wanted > length && !clamp) return;
  wanted = Math.min(wanted, length);
  // A fixed bullet or equation has no editable positions inside it.
  const text = textRanges.find(({ start, end }) => wanted >= start && wanted <= end);
  if (text) return { node: text.node, offset: wanted - text.start };
  let next = Infinity;
  for (const at of carets.keys()) {
    if (at >= wanted && at < next) next = at;
  }
  const following = textRanges.find(({ start }) => start === next);
  return following ? { node: following.node, offset: 0 } : carets.get(next);
}


/** Use the words' caret at a bullet boundary, outside its zero-size spacer. */
export function normalizeBulletCaret(root: HTMLElement): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) return;
  const anchor = selection.anchorNode;
  const slot = anchor.parentElement?.closest(".slide-bullet-slot");
  if (!slot || anchor.nodeType !== Node.TEXT_NODE ||
      anchor.textContent !== " " || selection.anchorOffset !== 1) return;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = slot;
  let next = walker.nextNode();
  while (next && slot.contains(next)) next = walker.nextNode();
  if (next && slot.parentElement?.contains(next)) selection.collapse(next, 0);
}
