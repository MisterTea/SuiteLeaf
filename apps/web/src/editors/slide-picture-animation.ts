import type { SlideElement } from "@suiteleaf/core";

/** Older imports may animate a picture without timing on its separate painted frame. */
export function pictureAnimationOwner(
  element: SlideElement,
  elements: readonly SlideElement[],
): SlideElement {
  // Preserve independently authored effects and text builds.
  if (element.type !== "shape" || element.animation || element.animationExit ||
    element.paragraphBuilds?.length || element.marpHtml || element.content) return element;
  if (element.sourceShapeId) {
    return elements.find((item) => item.type === "image" &&
      item.sourceShapeId === element.sourceShapeId) ?? element;
  }
  if (element.shapeType !== "rect") return element;
  const index = elements.indexOf(element);
  if (index < 0) return element;
  // Legacy imports paint fill, picture, outline consecutively, with identical bounds.
  // Never attach a frame to a different known source object or a nearby rectangle.
  return [elements[index - 1], elements[index + 1]].find((item) =>
    item?.type === "image" &&
    item.x === element.x && item.y === element.y &&
    item.width === element.width && item.height === element.height &&
    (item.rotation ?? 0) === (element.rotation ?? 0) &&
    !!item.flipH === !!element.flipH && !!item.flipV === !!element.flipV,
  ) ?? element;
}
