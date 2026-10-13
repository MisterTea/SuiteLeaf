/** Quarter turns only. A missing value is upright, so older documents still open. */
export const IMAGE_ROTATIONS = [0, 90, 180, 270] as const;
export type ImageRotation = (typeof IMAGE_ROTATIONS)[number];

export function imageRotation(value: unknown): ImageRotation {
  const angle = typeof value === "number" ? value : Number(value);
  if (angle === 90 || angle === 180 || angle === 270) return angle;
  return 0;
}

/** One click. Right adds 90 degrees, left subtracts 90, and both wrap at a full turn. */
export function turnImageRotation(
  value: unknown,
  direction: "left" | "right",
): ImageRotation {
  const angle = imageRotation(value);
  const next = direction === "right" ? angle + 90 : angle - 90;
  return imageRotation((next + 360) % 360);
}

/**
 * The on-page box. 90 and 270 swap the stored pair so the picture is not
 * stretched. 0 and 180 keep that pair. The stored width and height stay put.
 */
export function displayedImageBox(
  stored: { width: number; height: number },
  rotation: unknown,
): { width: number; height: number } {
  const angle = imageRotation(rotation);
  if (angle === 90 || angle === 270) return { width: stored.height, height: stored.width };
  return { width: stored.width, height: stored.height };
}

/**
 * Degrees for docx `ImageRun`. The library writes `a:xfrm rot` as
 * degrees × 60,000, so 90 becomes `rot="5400000"`. Upright omits it.
 */
export function docxImageRotation(value: unknown): number | undefined {
  const angle = imageRotation(value);
  return angle === 0 ? undefined : angle;
}
