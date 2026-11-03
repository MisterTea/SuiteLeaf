/**
 * DrawingML flips a picture about its center, then rotates it.
 * Print bakes that into one SVG transform because a CSS rotate on the
 * frame drops the flip and turns a bent arrow the wrong way.
 */
export function turnedPictureTransform(
  el: { rotation?: number; flipH?: boolean; flipV?: boolean },
  frame: { width: number; height: number },
) {
  const cx = frame.width / 2;
  const cy = frame.height / 2;
  const sx = el.flipH ? -1 : 1;
  const sy = el.flipV ? -1 : 1;
  if (sx === 1 && sy === 1) return `rotate(${el.rotation ?? 0} ${cx} ${cy})`;
  return `translate(${cx} ${cy}) rotate(${el.rotation ?? 0}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`;
}

/**
 * Axis-aligned box of a picture after rotation about its center.
 * PowerPoint shows that rotated rectangle, not the strip that still
 * overlaps the unrotated box. The shape itself stays centered inside.
 */
export function rotatedPictureFrame(el: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
  shapeX: number;
  shapeY: number;
} {
  const rad = ((el.rotation ?? 0) * Math.PI) / 180;
  const snap = (value: number) =>
    value < 1e-10 ? 0 : value > 1 - 1e-10 ? 1 : value;
  const cosine = snap(Math.abs(Math.cos(rad)));
  const sine = snap(Math.abs(Math.sin(rad)));
  const width = el.width * cosine + el.height * sine;
  const height = el.width * sine + el.height * cosine;
  const centerX = el.x + el.width / 2;
  const centerY = el.y + el.height / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    shapeX: (width - el.width) / 2,
    shapeY: (height - el.height) / 2,
  };
}
