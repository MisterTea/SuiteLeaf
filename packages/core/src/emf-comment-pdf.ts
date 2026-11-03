import { inflate } from "pako";

/**
 * Some pictures store the real drawing as a PDF inside an EMF GDI comment.
 * The EMF records are only the fallback outlines. Paint the comment's filled
 * rectangles behind those outlines.
 */
export function embeddedPdfShapes(
  emf: Uint8Array,
  width: number,
  height: number,
): string[] {
  const pdf = commentPdf(emf);
  if (!pdf || !(width > 0) || !(height > 0)) return [];
  const text = latin1(pdf);
  const box = /\/MediaBox\s*\[\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(text);
  const pdfWidth = Number(box?.[1]);
  const pdfHeight = Number(box?.[2]);
  if (!(pdfWidth > 0) || !(pdfHeight > 0)) return [];
  const drawing = flateDrawing(pdf, text);
  if (!drawing) return [];
  return fillRects(drawing, graphicsAlphas(text), pdfWidth, pdfHeight, width, height);
}

function commentPdf(emf: Uint8Array): Uint8Array | undefined {
  if (emf.length < 108) return;
  const view = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
  if (view.getUint32(0, true) !== 1) return;
  let offset = view.getUint32(4, true);
  while (offset + 8 <= emf.length) {
    const type = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    if (size < 8 || offset + size > emf.length) return;
    if (type === 14) return;
    if (type === 70 && size >= 16) {
      const declared = view.getUint32(offset + 8, true);
      const start = offset + 12;
      const blob = emf.subarray(start, Math.min(start + declared, offset + size));
      const at = indexOf(blob, [0x25, 0x50, 0x44, 0x46]);
      if (at >= 0) return blob.subarray(at);
    }
    offset += size;
  }
  return;
}

function streamLength(dict: string, text: string): number | undefined {
  const indirect = /\/Length\s+(\d+)\s+0\s+R/.exec(dict);
  if (indirect) {
    const body = new RegExp(`${indirect[1]}\\s+0\\s+obj\\s+(\\d+)`).exec(text);
    return body ? Number(body[1]) : undefined;
  }
  const direct = /\/Length\s+(\d+)/.exec(dict);
  return direct ? Number(direct[1]) : undefined;
}

function flateDrawing(pdf: Uint8Array, text: string): string | undefined {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf("stream", from);
    if (at < 0) return;
    const dict = text.slice(Math.max(0, at - 400), at);
    let dataAt = at + "stream".length;
    if (text.charCodeAt(dataAt) === 13) dataAt += 1;
    if (text.charCodeAt(dataAt) === 10) dataAt += 1;
    const size = streamLength(dict, text);
    if (size == null || !dict.includes("/FlateDecode")) {
      from = dataAt + 1;
      continue;
    }
    try {
      const inflated = inflate(pdf.subarray(dataAt, dataAt + size));
      const drawing = latin1(inflated);
      // Rectangles and path fills. Font programs also inflate, without both.
      if (
        /(?:^|\s)(?:m|re)(?:\s|$)/.test(drawing) &&
        /(?:^|\s)(?:f\*|f|F|B\*|B)(?:\s|$)/.test(drawing)
      )
        return drawing;
    } catch {
      /* The next stream may be the drawing. */
    }
    from = dataAt + size;
  }
  return;
}

function graphicsAlphas(text: string): Map<string, number> {
  const alphas = new Map<string, number>();
  for (const match of text.matchAll(/\/([A-Za-z0-9]+)\s+<<[^<>]*\/ca\s+([\d.]+)/g))
    alphas.set(match[1], Number(match[2]));
  const block = /\/ExtGState\s*<<([\s\S]*?)>>/.exec(text)?.[1] ?? "";
  for (const match of block.matchAll(/\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g)) {
    const body = new RegExp(`${match[2]}\\s+0\\s+obj[\\s\\S]{0,180}?\\/ca\\s+([\\d.]+)`).exec(text);
    if (body) alphas.set(match[1], Number(body[1]));
  }
  return alphas;
}

function fillRects(
  drawing: string,
  alphas: Map<string, number>,
  pdfWidth: number,
  pdfHeight: number,
  width: number,
  height: number,
): string[] {
  const stripped = drawing.replace(/BT[\s\S]*?ET/g, " ");
  const tokens = stripped.split(/\s+/).filter(Boolean);
  let rgb: [number, number, number] = [0, 0, 0];
  let alpha = 1;
  const saved: { rgb: [number, number, number]; alpha: number }[] = [];
  const shapes: string[] = [];
  const sx = width / pdfWidth;
  const sy = height / pdfHeight;
  const nums: number[] = [];
  let name = "";
  let path = "";
  const point = (x: number, y: number) =>
    `${trim(x * sx)} ${trim((pdfHeight - y) * sy)}`;
  const take = (count: number) => {
    if (nums.length < count) {
      nums.length = 0;
      return;
    }
    const got = nums.slice(nums.length - count);
    nums.length = 0;
    return got;
  };
  const emit = (rule: "nonzero" | "evenodd") => {
    if (path && alpha > 0 && path.length < 800000) {
      const opacity = alpha >= 0.999 ? "" : ` fill-opacity="${trim(alpha)}"`;
      const ruleAttr = rule === "evenodd" ? ` fill-rule="evenodd"` : "";
      shapes.push(`<path d="${path}" fill="${channels(rgb)}"${ruleAttr}${opacity}/>`);
    }
    path = "";
    nums.length = 0;
  };
  for (const token of tokens) {
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      nums.push(Number(token));
      continue;
    }
    if (token.startsWith("/")) {
      name = token;
      nums.length = 0;
      continue;
    }
    if (token === "q") saved.push({ rgb: [rgb[0], rgb[1], rgb[2]], alpha });
    else if (token === "Q") {
      const state = saved.pop();
      if (state) {
        rgb = state.rgb;
        alpha = state.alpha;
      }
    } else if (token === "g") {
      // DeviceGray fill. `1 g` is white; ignoring it painted those rectangles black.
      const gray = take(1)?.[0];
      if (gray != null) rgb = [gray, gray, gray];
    } else if (token === "rg" || token === "sc") {
      const channels = take(3);
      if (channels) rgb = [channels[0], channels[1], channels[2]];
    } else if (token === "gs") {
      if (name.startsWith("/")) {
        const next = alphas.get(name.slice(1));
        if (next != null) alpha = next;
      }
    } else if (token === "m") {
      const xy = take(2);
      if (xy) path += `M${point(xy[0], xy[1])}`;
    } else if (token === "l") {
      const xy = take(2);
      if (xy) path += `L${point(xy[0], xy[1])}`;
    } else if (token === "c") {
      const curve = take(6);
      if (curve)
        path += `C${point(curve[0], curve[1])} ${point(curve[2], curve[3])} ${point(curve[4], curve[5])}`;
    } else if (token === "h") path += "Z";
    else if (token === "re") {
      const rect = take(4);
      if (rect && rect[2] > 0 && rect[3] > 0) {
        const [x, y, rectWidth, rectHeight] = rect;
        path += `M${point(x, y + rectHeight)}L${point(x + rectWidth, y + rectHeight)}L${point(x + rectWidth, y)}L${point(x, y)}Z`;
      }
    } else if (token === "f" || token === "F" || token === "B" || token === "b") emit("nonzero");
    else if (token === "f*" || token === "B*" || token === "b*") emit("evenodd");
    else if (token === "S" || token === "s" || token === "n") {
      path = "";
      nums.length = 0;
    } else nums.length = 0;
  }
  return shapes;
}

function channels(rgb: [number, number, number]): string {
  const [red, green, blue] = rgb.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * 255))),
  );
  return `rgb(${red},${green},${blue})`;
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
}

function indexOf(bytes: Uint8Array, needle: number[]): number {
  for (let i = 0; i + needle.length <= bytes.length; i++) {
    let found = true;
    for (let n = 0; n < needle.length; n++) {
      if (bytes[i + n] !== needle[n]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}
