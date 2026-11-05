/** A DrawingML group transform, in EMU. `rot` is clockwise degrees. */
export type GroupXfrm = {
  childStart: number;
  end: number;
  ox: number;
  oy: number;
  cx: number;
  cy: number;
  chx: number;
  chy: number;
  chcx: number;
  chcy: number;
  rot: number;
  /** Mirror the group’s children. Flipping happens before the group rotation. */
  flipH?: boolean;
  flipV?: boolean;
  pr: string;
};

/**
 * Group frames in a slide, layout, or master part.
 * The root `p:spTree` group is included; a zero extent stays a unit scale.
 */
export function readGroups(partXml: string): GroupXfrm[] {
  const groups: GroupXfrm[] = [];
  const stack: number[] = [];
  const marker = /<p:grpSp\b|<\/p:grpSp>/g;
  let found: RegExpExecArray | null;
  while ((found = marker.exec(partXml))) {
    if (found[0] !== "</p:grpSp>") {
      stack.push(found.index);
      continue;
    }
    const start = stack.pop();
    if (start == null) continue;
    const body = partXml.slice(start, found.index);
    const pr = /<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/.exec(body)?.[0] ?? "";
    const num = (tag: string, name: string) =>
      Number(new RegExp(`<a:${tag}\\b[^>]*\\b${name}="(-?\\d+)"`).exec(pr)?.[1] ?? 0);
    const prAt = body.indexOf("</p:grpSpPr>");
    const xfrmTag = /<a:xfrm\b([^>]*)>/.exec(pr)?.[1] ?? "";
    const flipped = (name: string) => new RegExp(`\\b${name}="(?:1|true)"`).test(xfrmTag);
    const rot = Number(/<a:xfrm\b[^>]*\brot="(-?\d+)"/.exec(pr)?.[1] ?? 0) / 60000;
    groups.push({
      childStart: prAt < 0 ? start : start + prAt,
      end: found.index,
      ox: num("off", "x"),
      oy: num("off", "y"),
      cx: num("ext", "cx") || 1,
      cy: num("ext", "cy") || 1,
      chx: num("chOff", "x"),
      chy: num("chOff", "y"),
      chcx: num("chExt", "cx") || 1,
      chcy: num("chExt", "cy") || 1,
      rot,
      ...(flipped("flipH") ? { flipH: true } : {}),
      ...(flipped("flipV") ? { flipV: true } : {}),
      pr,
    });
  }
  return groups;
}

/**
 * Map a child box through the groups that contain it, innermost first.
 * Positive rotation is clockwise about the group center, matching DrawingML.
 * The returned box stays the pre-rotation rectangle so the painter can turn it.
 */
export function mapThroughGroups(
  groups: GroupXfrm[],
  at: number,
  emuX: number,
  emuY: number,
  emuW: number,
  emuH: number,
  childRotation?: number,
) {
  let rotation = 0;
  let flipH = false;
  let flipV = false;
  const chain = groups
    .filter((group) => at >= group.childStart && at < group.end)
    .sort((a, b) => b.childStart - a.childStart);
  for (const group of chain) {
    const sx = group.cx / group.chcx;
    const sy = group.cy / group.chcy;
    const rotRad = ((childRotation ?? 0) * Math.PI) / 180;
    const cosR = Math.abs(Math.cos(rotRad));
    const sinR = Math.abs(Math.sin(rotRad));
    const effectiveScaleW = Math.sqrt((sx * cosR) ** 2 + (sy * sinR) ** 2);
    const effectiveScaleH = Math.sqrt((sx * sinR) ** 2 + (sy * cosR) ** 2);
    const lw = emuW * effectiveScaleW;
    const lh = emuH * effectiveScaleH;
    const childCx = emuX + emuW / 2;
    const childCy = emuY + emuH / 2;
    let lx = (childCx - group.chx) * sx - lw / 2;
    let ly = (childCy - group.chy) * sy - lh / 2;
    // A group flip mirrors the child in the group box and mirrors its outline.
    if (group.flipH) {
      lx = group.cx - lx - lw;
      flipH = !flipH;
    }
    if (group.flipV) {
      ly = group.cy - ly - lh;
      flipV = !flipV;
    }
    if (group.rot) {
      const rad = (group.rot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = lx + lw / 2 - group.cx / 2;
      const dy = ly + lh / 2 - group.cy / 2;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      lx = group.cx / 2 + rx - lw / 2;
      ly = group.cy / 2 + ry - lh / 2;
      rotation += group.rot;
    }
    emuX = group.ox + lx;
    emuY = group.oy + ly;
    emuW = lw;
    emuH = lh;
  }
  return {
    emuX,
    emuY,
    emuW,
    emuH,
    rotation,
    ...(flipH ? { flipH: true } : {}),
    ...(flipV ? { flipV: true } : {}),
  };
}

/** Shape rotation plus the groups around it. Zero stays unset. */
export function composeRotation(group?: number, own?: number) {
  const sum = (group || 0) + (own || 0);
  return sum ? sum : undefined;
}

type SlideMetrics = {
  width: number;
  height: number;
  emuWidth: number;
  emuHeight: number;
};

/**
 * A diagram drawing is stored in its graphic frame's child space. When that
 * frame sits in a group, the drawing has to use the same scale and origin as
 * a text box that shares the group. An ungrouped frame is unchanged.
 */
export function placeGroupedBox<
  T extends { x: number; y: number; width: number; height: number; rotation?: number },
>(groups: GroupXfrm[], at: number, box: T, metrics: SlideMetrics): T {
  if (!(metrics.width > 0 && metrics.height > 0 && metrics.emuWidth > 0 && metrics.emuHeight > 0))
    return box;
  const mapped = mapThroughGroups(
    groups,
    at,
    (box.x / metrics.width) * metrics.emuWidth,
    (box.y / metrics.height) * metrics.emuHeight,
    (box.width / metrics.width) * metrics.emuWidth,
    (box.height / metrics.height) * metrics.emuHeight,
    box.rotation,
  );
  const rotation = composeRotation(mapped.rotation, box.rotation);
  const own = box as T & { flipH?: boolean; flipV?: boolean };
  const flipH = !!mapped.flipH !== !!own.flipH;
  const flipV = !!mapped.flipV !== !!own.flipV;
  const placed = {
    ...box,
    x: (mapped.emuX / metrics.emuWidth) * metrics.width,
    y: (mapped.emuY / metrics.emuHeight) * metrics.height,
    width: Math.max(0, (mapped.emuW / metrics.emuWidth) * metrics.width),
    height: Math.max(0, (mapped.emuH / metrics.emuHeight) * metrics.height),
  } as T & { flipH?: boolean; flipV?: boolean };
  if (rotation) placed.rotation = rotation;
  else delete placed.rotation;
  if (flipH) placed.flipH = true;
  else delete placed.flipH;
  if (flipV) placed.flipV = true;
  else delete placed.flipV;
  return placed;
}
