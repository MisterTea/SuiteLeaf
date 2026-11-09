import type { SlideElement } from "./index";
import { assignClickAnimations } from "./slide-motion";

/** A source shape can paint separate text, fill, picture, and outline elements. */
export function assignPaintedShapeAnimations(
  xml: string,
  elements: SlideElement[],
  shapeIndex: ReadonlyMap<string, number>,
  elementOrder: ReadonlyMap<number, number>,
): number {
  const partsBySource = new Map<number, number[]>();
  const sourceByIndex = new Map<number, number>();
  let source: number | undefined;
  for (let index = 0; index < elements.length; index += 1) {
    source = elementOrder.get(index) ?? source;
    if (source == null) continue;
    sourceByIndex.set(index, source);
    const parts = partsBySource.get(source) ?? [];
    parts.push(index);
    partsBySource.set(source, parts);
  }
  const shapeParts = new Map<string, number | readonly number[]>();
  for (const [id, index] of shapeIndex) {
    const source = sourceByIndex.get(index);
    shapeParts.set(id, source == null ? index : partsBySource.get(source)!);
  }
  for (const [id, indexes] of shapeParts) {
    for (const index of typeof indexes === "number" ? [indexes] : indexes) {
      if (elements[index]) elements[index].sourceShapeId = id;
    }
  }
  return assignClickAnimations(xml, elements, shapeParts);
}
