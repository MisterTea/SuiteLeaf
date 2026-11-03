export type SlideBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  rotation?: number;
};

export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";

function copy<T extends SlideBox>(object: T): T {
  return { ...object };
}

/** Later boxes are painted on top. The input list is not changed. */
export function orderSlideObjects<T extends { id: string }>(
  objects: readonly T[],
  id: string,
  direction: "forward" | "backward" | "front" | "back",
): T[] {
  const index = objects.findIndex((object) => object.id === id);
  if (index < 0) return objects.map((object) => ({ ...object }));
  const next = objects.map((object) => ({ ...object }));
  const [item] = next.splice(index, 1);
  if (direction === "front") next.push(item);
  else if (direction === "back") next.unshift(item);
  else if (direction === "forward") next.splice(Math.min(next.length, index + 1), 0, item);
  else next.splice(Math.max(0, index - 1), 0, item);
  return next;
}

export type SlideSnap = {
  x: number;
  y: number;
  /** Vertical guide, in slide units. Null when this move did not snap sideways. */
  guideX: number | null;
  /** Horizontal guide, in slide units. Null when this move did not snap vertically. */
  guideY: number | null;
};

function closest(
  value: number,
  choices: readonly { at: number; guide: number }[],
  threshold: number,
): { at: number; guide: number } | null {
  let best: { at: number; guide: number } | null = null;
  let distance = threshold + 1;
  for (const choice of choices) {
    const gap = Math.abs(value - choice.at);
    if (gap <= threshold && gap < distance) {
      best = choice;
      distance = gap;
    }
  }
  return best;
}

/** Give two or more boxes the same group. One box is left unchanged. */
export function groupSlideObjects<T extends { id: string; groupId?: string }>(
  objects: readonly T[],
  ids: readonly string[],
  groupId: string,
): T[] {
  const present = ids.filter((id) => objects.some((object) => object.id === id));
  if (present.length < 2) return objects.map((object) => ({ ...object }));
  const chosen = new Set(present);
  return objects.map((object) => (chosen.has(object.id) ? { ...object, groupId } : { ...object }));
}

/** Clear the group of the chosen boxes and of every box that shares it. */
export function ungroupSlideObjects<T extends { id: string; groupId?: string }>(
  objects: readonly T[],
  ids: readonly string[],
): T[] {
  const chosen = new Set(ids);
  const groupIds = new Set(
    objects.filter((object) => chosen.has(object.id) && object.groupId).map((object) => object.groupId),
  );
  return objects.map((object) => {
    if (!object.groupId || (!chosen.has(object.id) && !groupIds.has(object.groupId))) {
      return { ...object };
    }
    const copy = { ...object };
    delete copy.groupId;
    return copy;
  });
}

/** Move a group from the positions where the drag started. A locked box stays. */
export function placeSlideGroup<T extends SlideBox & { groupId?: string }>(
  objects: readonly T[],
  starts: readonly { id: string; x: number; y: number }[],
  dx: number,
  dy: number,
): T[] {
  const byId = new Map(starts.map((start) => [start.id, start]));
  return objects.map((object) => {
    const start = byId.get(object.id);
    if (!start || object.locked) return { ...object };
    return { ...object, x: start.x + dx, y: start.y + dy };
  });
}

/** Snap a moving box to the slide or to another box, within 8 units. The inputs stay put. */
export function snapSlideBox(
  moving: SlideBox,
  others: readonly SlideBox[],
  slide: { width: number; height: number },
  threshold = 8,
): SlideSnap {
  const xs = [
    { at: 0, guide: 0 },
    { at: slide.width - moving.width, guide: slide.width },
    { at: (slide.width - moving.width) / 2, guide: slide.width / 2 },
  ];
  const ys = [
    { at: 0, guide: 0 },
    { at: slide.height - moving.height, guide: slide.height },
    { at: (slide.height - moving.height) / 2, guide: slide.height / 2 },
  ];
  for (const other of others) {
    if (other.id === moving.id) continue;
    xs.push({ at: other.x, guide: other.x });
    xs.push({ at: other.x + other.width - moving.width, guide: other.x + other.width });
    const centerX = other.x + other.width / 2;
    xs.push({ at: centerX - moving.width / 2, guide: centerX });
    ys.push({ at: other.y, guide: other.y });
    ys.push({ at: other.y + other.height - moving.height, guide: other.y + other.height });
    const centerY = other.y + other.height / 2;
    ys.push({ at: centerY - moving.height / 2, guide: centerY });
  }
  const x = closest(moving.x, xs, threshold);
  const y = closest(moving.y, ys, threshold);
  return {
    x: x?.at ?? moving.x,
    y: y?.at ?? moving.y,
    guideX: x?.guide ?? null,
    guideY: y?.guide ?? null,
  };
}

export type SlideGeometry = { x: number; y: number; width: number; height: number; rotation?: number };

/** Four measurements for one box. A value that is not a number is refused without repeating it. */
export function readSlideGeometry(input: {
  x: string;
  y: string;
  width: string;
  height: string;
  rotation?: string;
}): SlideGeometry | { error: string } {
  const raw = [input.x, input.y, input.width, input.height];
  const names = ["x", "y", "width", "height"] as const;
  const numbers: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = Number(raw[index]);
    if (!Number.isFinite(value)) return { error: `Enter a number for ${names[index]}.` };
    numbers.push(value);
  }
  const [x, y, width, height] = numbers;
  if (width <= 0 || height <= 0) return { error: "Width and height must be greater than zero." };
  if ([x, y, width, height].some((value) => value < 0 || value > 2000)) {
    return { error: "Keep each measurement between 0 and 2000." };
  }
  const rotationText = input.rotation?.trim() ?? "";
  if (!rotationText) return { x, y, width, height };
  const rotation = Number(rotationText);
  if (!Number.isFinite(rotation)) return { error: "Enter a number for rotation." };
  if (rotation < 0 || rotation > 360) return { error: "Keep rotation between 0 and 360." };
  return { x, y, width, height, rotation };
}

export type NudgeDirection = "left" | "right" | "up" | "down";

/** Move the selected box and every unlocked box in its group. The input is not changed. */
export function nudgeSlideSelection<T extends SlideBox & { groupId?: string }>(
  objects: readonly T[],
  id: string,
  direction: NudgeDirection,
  step = 1,
): T[] {
  const selected = objects.find((object) => object.id === id);
  if (!selected || selected.locked) return objects.map(copy);
  const group = selected.groupId?.trim() ?? "";
  return objects.map((object) => {
    const chosen = object.id === id || (group !== "" && object.groupId?.trim() === group);
    return chosen ? nudgeSlideObject(object, direction, step) : copy(object);
  });
}

/** Move one box by a whole step. A locked box stays. The input is not changed. */
export function nudgeSlideObject<T extends SlideBox>(
  object: T,
  direction: NudgeDirection,
  step = 1,
): T {
  const amount = Number.isInteger(step) && step > 0 && step <= 100 ? step : 1;
  if (object.locked || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return copy(object);
  const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
  const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
  return {
    ...object,
    x: Math.min(2000, Math.max(0, object.x + dx)),
    y: Math.min(2000, Math.max(0, object.y + dy)),
  };
}

/** Apply a change. A locked box keeps its place unless this change unlocks it. */
export function placeSlideObject<T extends SlideBox>(object: T, next: Partial<T>): T {
  const placed = { ...object, ...next };
  if (!object.locked || next.locked === false) return placed;
  placed.x = object.x;
  placed.y = object.y;
  placed.width = object.width;
  placed.height = object.height;
  placed.rotation = object.rotation;
  return placed;
}

/** Move the selected boxes to one shared edge. A locked box and every other box stay put. */
export function alignSlideObjects<T extends SlideBox>(
  objects: readonly T[],
  ids: readonly string[],
  edge: AlignEdge,
): T[] {
  const chosen = new Set(ids);
  const selected = objects.filter((object) => chosen.has(object.id) && !object.locked);
  if (selected.length < 2) return objects.map(copy);
  const left = Math.min(...selected.map((object) => object.x));
  const right = Math.max(...selected.map((object) => object.x + object.width));
  const top = Math.min(...selected.map((object) => object.y));
  const bottom = Math.max(...selected.map((object) => object.y + object.height));
  return objects.map((object) => {
    if (!chosen.has(object.id) || object.locked) return copy(object);
    if (edge === "left") return { ...object, x: left };
    if (edge === "right") return { ...object, x: right - object.width };
    if (edge === "center") return { ...object, x: (left + right) / 2 - object.width / 2 };
    if (edge === "top") return { ...object, y: top };
    if (edge === "bottom") return { ...object, y: bottom - object.height };
    return { ...object, y: (top + bottom) / 2 - object.height / 2 };
  });
}

/** Even gaps between three or more boxes. The first and last stay, and a locked box is not a gap. */
export function distributeSlideObjects<T extends SlideBox>(
  objects: readonly T[],
  ids: readonly string[],
  axis: "horizontal" | "vertical",
): T[] {
  const chosen = new Set(ids);
  const selected = objects.filter((object) => chosen.has(object.id) && !object.locked);
  if (selected.length < 3) return objects.map(copy);
  const sorted = [...selected].sort((a, b) => (axis === "horizontal" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span =
    axis === "horizontal" ? last.x + last.width - first.x : last.y + last.height - first.y;
  const used = sorted.reduce(
    (sum, object) => sum + (axis === "horizontal" ? object.width : object.height),
    0,
  );
  const gap = (span - used) / (sorted.length - 1);
  let cursor = axis === "horizontal" ? first.x : first.y;
  const placed = new Map<string, number>();
  for (const object of sorted) {
    placed.set(object.id, cursor);
    cursor += (axis === "horizontal" ? object.width : object.height) + gap;
  }
  return objects.map((object) => {
    const at = placed.get(object.id);
    if (at === undefined) return copy(object);
    return axis === "horizontal" ? { ...object, x: at } : { ...object, y: at };
  });
}

/** Move one box to the slide edge. A locked box stays where it is. */
export function alignObjectToSlide<T extends SlideBox>(
  object: T,
  slide: { width: number; height: number },
  edge: AlignEdge,
): T {
  if (object.locked) return copy(object);
  if (edge === "left") return { ...object, x: 0 };
  if (edge === "right") return { ...object, x: slide.width - object.width };
  if (edge === "center") return { ...object, x: (slide.width - object.width) / 2 };
  if (edge === "top") return { ...object, y: 0 };
  if (edge === "bottom") return { ...object, y: slide.height - object.height };
  return { ...object, y: (slide.height - object.height) / 2 };
}

/**
 * One selected box moves to the slide edge. Two or more move to a shared edge.
 * A box that is not selected stays put.
 */
export function alignSelection<T extends SlideBox>(
  objects: readonly T[],
  ids: readonly string[],
  slide: { width: number; height: number },
  edge: AlignEdge,
): T[] {
  if (ids.length >= 2) return alignSlideObjects(objects, ids, edge);
  const id = ids[0];
  const object = objects.find((item) => item.id === id);
  if (!object) return objects.map(copy);
  const next = alignObjectToSlide(object, slide, edge);
  return objects.map((item) => (item.id === id ? next : copy(item)));
}
