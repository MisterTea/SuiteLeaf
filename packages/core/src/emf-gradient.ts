/** EMR_GRADIENTFILL vertices. One-pixel chart strips stay with the scanline joiner. */

export type EmfGradientVertex = { x: number; y: number; color: string };

export type EmfQuadGradient = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Colour at the minimum end of `axis`. */
  from: string;
  to: string;
  axis: "x" | "y";
};

const TOL = 1.5;

function clusters(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (!out.length || value - out[out.length - 1] > TOL) out.push(value);
  }
  return out;
}

function cornerColor(
  verts: EmfGradientVertex[],
  x: number,
  y: number,
): string | undefined {
  const hits = verts.filter(
    (vert) => Math.abs(vert.x - x) <= TOL && Math.abs(vert.y - y) <= TOL,
  );
  if (!hits.length) return;
  const color = hits[0].color;
  if (hits.some((hit) => hit.color !== color)) return;
  return color;
}

export function readEmfGradientVertices(
  view: DataView,
  offset: number,
  size: number,
): EmfGradientVertex[] {
  if (offset < 0 || size < 52) return [];
  const nVer = view.getUint32(offset + 24, true);
  if (nVer <= 0 || nVer >= 64 || offset + 36 + nVer * 16 > offset + size) return [];
  const verts: EmfGradientVertex[] = [];
  for (let n = 0; n < nVer; n++) {
    const at = offset + 36 + n * 16;
    const x = view.getInt32(at, true);
    const y = view.getInt32(at + 4, true);
    if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) continue;
    const channel = (shift: number) =>
      (view.getUint16(at + shift, true) >> 8).toString(16).padStart(2, "0");
    verts.push({
      x,
      y,
      color: `#${channel(8)}${channel(10)}${channel(12)}`,
    });
  }
  return verts;
}

/**
 * An axis-aligned quad whose colour changes along one edge.
 * One-pixel stacks and flat fills return undefined so chart bars can still merge.
 */
export function emfQuadGradient(
  verts: EmfGradientVertex[],
): EmfQuadGradient | undefined {
  const finite = verts.filter(
    (vert) =>
      Number.isFinite(vert.x) &&
      Number.isFinite(vert.y) &&
      Math.abs(vert.x) <= 1_000_000 &&
      Math.abs(vert.y) <= 1_000_000,
  );
  if (finite.length < 4) return;
  const xs = clusters(finite.map((vert) => vert.x));
  const ys = clusters(finite.map((vert) => vert.y));
  if (xs.length !== 2 || ys.length !== 2) return;
  const x0 = xs[0];
  const x1 = xs[1];
  const y0 = ys[0];
  const y1 = ys[1];
  const c00 = cornerColor(finite, x0, y0);
  const c10 = cornerColor(finite, x1, y0);
  const c01 = cornerColor(finite, x0, y1);
  const c11 = cornerColor(finite, x1, y1);
  if (!c00 || !c10 || !c01 || !c11) return;
  if (c00 === c10 && c00 === c01 && c00 === c11) return;
  if (c00 === c01 && c10 === c11)
    return { x0, y0, x1, y1, from: c00, to: c10, axis: "x" };
  if (c00 === c10 && c01 === c11)
    return { x0, y0, x1, y1, from: c00, to: c01, axis: "y" };
}
