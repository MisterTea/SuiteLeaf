/**
 * A document image crop hides part of the picture without scaling what remains.
 * Each edge is the percentage of the full image concealed on that side.
 * Width and height stay the full picture, so a corner resize still scales
 * everything, including the hidden part.
 */
export type ImageCrop = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** At least this much of each axis stays visible, so a drag cannot erase the photo. */
const MIN_VISIBLE = 8;

export function imageCrop(
  attrs: Record<string, unknown> | null | undefined,
): ImageCrop {
  const edge = (key: string) => {
    const value = Number(attrs?.[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return clampImageCrop({
    left: edge("cropLeft"),
    top: edge("cropTop"),
    right: edge("cropRight"),
    bottom: edge("cropBottom"),
  });
}

export function clampImageCrop(crop: ImageCrop): ImageCrop {
  const pair = (a: number, b: number): [number, number] => {
    let x = Math.max(0, a);
    let y = Math.max(0, b);
    const limit = 100 - MIN_VISIBLE;
    if (x + y > limit) {
      const scale = limit / (x + y);
      x *= scale;
      y *= scale;
    }
    return [x, y];
  };
  const [left, right] = pair(crop.left, crop.right);
  const [top, bottom] = pair(crop.top, crop.bottom);
  return { left, top, right, bottom };
}

export function imageCropActive(crop: ImageCrop): boolean {
  return crop.left > 0.05 || crop.top > 0.05 || crop.right > 0.05 || crop.bottom > 0.05;
}

/** Visible box of a full-size image after hiding each edge. Offsets are the hidden left and top. */
export function croppedFrame(
  full: { width: number; height: number },
  crop: ImageCrop,
): { width: number; height: number; offsetX: number; offsetY: number } {
  return {
    width: full.width * (1 - (crop.left + crop.right) / 100),
    height: full.height * (1 - (crop.top + crop.bottom) / 100),
    offsetX: (full.width * crop.left) / 100,
    offsetY: (full.height * crop.top) / 100,
  };
}

/**
 * Move one edge by a pixel delta. A positive delta hides more on that edge.
 * The full image size is unchanged, so the remaining picture does not scale.
 */
export function cropByEdge(
  crop: ImageCrop,
  edge: keyof ImageCrop,
  full: { width: number; height: number },
  deltaPx: number,
): ImageCrop {
  const span = edge === "left" || edge === "right" ? full.width : full.height;
  if (span <= 0) return crop;
  return clampImageCrop({ ...crop, [edge]: crop[edge] + (deltaPx / span) * 100 });
}

/**
 * Read OOXML `a:srcRect`. Each edge is thousandths of a percent (`42000` is
 * 42%) or a percentage string (`42%`). An omitted edge hides nothing.
 */
export function imageCropFromSrcRect(
  attrs: Record<string, string | undefined> | null | undefined,
): ImageCrop {
  const edge = (key: string) => {
    const raw = attrs?.[key] ?? attrs?.[`a:${key}`];
    if (raw == null || raw.trim() === "") return 0;
    const text = raw.trim();
    if (text.endsWith("%")) {
      const pct = Number(text.slice(0, -1));
      return Number.isFinite(pct) ? pct : 0;
    }
    const thousandths = Number(text);
    return Number.isFinite(thousandths) ? thousandths / 1000 : 0;
  };
  return clampImageCrop({
    left: edge("l"),
    top: edge("t"),
    right: edge("r"),
    bottom: edge("b"),
  });
}

/**
 * Percentages for docx's ImageRun crop (0–100). The library writes them as
 * OOXML `a:srcRect` thousandths of a percent. Undefined means no crop, so the
 * drawing stays the full picture.
 */
export function docxImageCrop(
  crop: ImageCrop,
): { left: number; top: number; right: number; bottom: number } | undefined {
  if (!imageCropActive(crop)) return undefined;
  const pct = (value: number) => Math.round(value * 1000) / 1000;
  return {
    left: pct(crop.left),
    top: pct(crop.top),
    right: pct(crop.right),
    bottom: pct(crop.bottom),
  };
}
