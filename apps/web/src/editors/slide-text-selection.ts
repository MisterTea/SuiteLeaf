import { readSlideMath } from "./slide-math";

function mathLength(node: Node): number | undefined {
  if (node instanceof HTMLElement && node.dataset.slideMath) {
    const run = readSlideMath(node.dataset.slideMath);
    if (run) return run.text.length;
  }
}

/** Visual MathML omits linear separators such as '/'; offsets use authored text. */
export function semanticTextLength(node: Node): number {
  const math = mathLength(node);
  if (math != null) return math;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  return Array.from(node.childNodes).reduce((sum, child) => sum + semanticTextLength(child), 0);
}

export function semanticPoint(root: Node, wanted: number): { node: Node; offset: number } | undefined {
  let seen = 0;
  const visit = (node: Node): { node: Node; offset: number } | undefined => {
    const math = mathLength(node);
    if (math != null) {
      const end = seen + math;
      if (wanted <= end && node.parentNode) {
        const index = Array.from(node.parentNode.childNodes).indexOf(node as ChildNode);
        return { node: node.parentNode, offset: index + (wanted - seen > math / 2 ? 1 : 0) };
      }
      seen = end;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (wanted <= seen + length) return { node, offset: Math.max(0, wanted - seen) };
      seen += length;
      return;
    }
    for (const child of node.childNodes) {
      const point = visit(child);
      if (point) return point;
    }
  };
  return visit(root);
}
