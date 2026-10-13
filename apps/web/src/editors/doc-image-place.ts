import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { inlineFrame } from "@suiteleaf/core/image-inline";
import type { ImageWrap } from "@suiteleaf/core/image-wrap";

function renderedSize(
  editor: Editor,
  pos: number,
): { width: number; height: number } | undefined {
  try {
    const dom = editor.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return undefined;
    const img = dom.querySelector("img");
    if (!(img instanceof HTMLImageElement)) return undefined;
    const width = img.offsetWidth || img.naturalWidth;
    const height = img.offsetHeight || img.naturalHeight;
    if (width < 8 || height < 8) return undefined;
    return { width, height };
  } catch {
    return undefined;
  }
}

function inlineAttrs(
  attrs: Record<string, unknown>,
  rendered?: { width: number; height: number },
) {
  const next = { ...attrs };
  delete next.wrap;
  const frame = inlineFrame(next, rendered);
  next.width = frame.width;
  next.height = frame.height;
  return next;
}

/**
 * Move a block picture into the surrounding sentence and shrink it to the
 * height of the words. Adjacent paragraphs join, so the picture does not
 * leave an empty line behind.
 */
export function placeImageInline(editor: Editor, pos: number): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  if (node.type.name === "inlineImage") {
    editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
    return true;
  }
  if (node.type.name !== "image") return false;
  const inlineType = state.schema.nodes.inlineImage;
  if (!inlineType) return false;

  const $pos = state.doc.resolve(pos);
  const index = $pos.index();
  const before = index > 0 ? $pos.parent.child(index - 1) : null;
  const after = index + 1 < $pos.parent.childCount ? $pos.parent.child(index + 1) : null;
  const beforePara = before?.type.name === "paragraph" ? before : null;
  const afterPara = after?.type.name === "paragraph" ? after : null;
  const pieces: PMNode[] = [];
  beforePara?.content.forEach((child) => pieces.push(child));
  pieces.push(inlineType.create(inlineAttrs(node.attrs, renderedSize(editor, pos))));
  afterPara?.content.forEach((child) => pieces.push(child));
  const paragraph = state.schema.nodes.paragraph.create(
    beforePara?.attrs ?? afterPara?.attrs ?? null,
    pieces,
  );
  const start = pos - (beforePara ? beforePara.nodeSize : 0);
  const end = pos + node.nodeSize + (afterPara ? afterPara.nodeSize : 0);
  const tr = state.tr.replaceWith(start, end, paragraph);
  const imagePos = start + 1 + (beforePara ? beforePara.content.size : 0);
  tr.setSelection(NodeSelection.create(tr.doc, imagePos));
  editor.view.dispatch(tr);
  return true;
}

/**
 * Take a picture back out of the sentence for Left, Right, or Break text.
 * Empty sides are not kept, so the words do not gain a blank line.
 */
export function liftInlineImage(editor: Editor, pos: number, wrap: ImageWrap): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "inlineImage") return false;
  const imageType = state.schema.nodes.image;
  if (!imageType) return false;
  const $pos = state.doc.resolve(pos);
  const paragraph = $pos.parent;
  if (!paragraph.isTextblock) return false;
  const before = paragraph.content.cut(0, $pos.parentOffset);
  const after = paragraph.content.cut($pos.parentOffset + node.nodeSize);
  const block = imageType.create({ ...node.attrs, wrap });
  const nodes: PMNode[] = [];
  if (before.size > 0) nodes.push(paragraph.type.create(paragraph.attrs, before));
  nodes.push(block);
  if (after.size > 0) nodes.push(paragraph.type.create(paragraph.attrs, after));
  const paraPos = $pos.before();
  const tr = state.tr.replaceWith(paraPos, paraPos + paragraph.nodeSize, nodes);
  const imagePos = paraPos + (before.size > 0 ? before.size + 2 : 0);
  tr.setSelection(NodeSelection.create(tr.doc, imagePos));
  editor.view.dispatch(tr);
  return true;
}
