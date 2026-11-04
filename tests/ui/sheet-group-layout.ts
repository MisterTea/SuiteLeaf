/** A grid host whose canvas sits at a fixed spot on screen, so overlay buttons can be placed. */
export function gridHost({ left = 0, top = 0, width = 1200, height = 800, canvasLeft = 40, canvasTop = 20 } = {}) {
  const box = (x: number, y: number, w: number, hgt: number) =>
    ({ left: x, top: y, x, y, width: w, height: hgt, right: x + w, bottom: y + hgt, toJSON: () => ({}) }) as DOMRect;
  const host = document.createElement("div");
  host.className = "sheet-host";
  host.getBoundingClientRect = () => box(left, top, width, height);
  const tiny = document.createElement("canvas");
  tiny.getBoundingClientRect = () => box(0, 0, 10, 10);
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => box(left + canvasLeft, top + canvasTop, width - canvasLeft, height - canvasTop);
  const second = document.createElement("canvas");
  second.getBoundingClientRect = () => box(left + canvasLeft, top + canvasTop, 100, 100);
  host.append(tiny, second, canvas);
  document.body.append(host);
  return host;
}

export const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
