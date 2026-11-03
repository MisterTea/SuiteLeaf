/**
 * DrawingML roundRect corner radius, in the same units as the shape box.
 * `adj` is a fraction of the short side, in hundred-thousandths. The preset
 * default is 16667. A zero adjust is a sharp rectangle.
 * Google writes `fmla` before `name`; either order is the same adjust.
 */
export function roundRectCornerRadius(
  xml: string,
  width: number,
  height: number,
): number | undefined {
  if (!/<a:prstGeom\b[^>]*\bprst="roundRect"/.test(xml)) return;
  const ss = Math.min(width, height);
  if (!(ss > 0)) return;
  let adj = 16667;
  for (const tag of xml.matchAll(/<a:gd\b([^>]*)\/?>/g)) {
    const attrs = tag[1];
    if (/\bname="([^"]+)"/.exec(attrs)?.[1] !== "adj") continue;
    const raw = /\bfmla="val (-?\d+(?:\.\d+)?)"/.exec(attrs)?.[1];
    if (raw != null) adj = Number(raw);
    break;
  }
  const pinned = Math.max(0, Math.min(50000, adj));
  return (ss * pinned) / 100000;
}
