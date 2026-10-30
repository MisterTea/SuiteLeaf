/**
 * Windows metafiles as SVG. Chromium does not paint image/wmf, so a chart or
 * equation stored as a placeable or standard metafile would otherwise be blank.
 * Record parameters are in reverse API order; point arrays stay X then Y.
 */

const base64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

function num(value: number) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

function xml(value: string) {
  return value.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;",
  );
}

/** Adobe Symbol encoding for the bytes MathType writes into a Symbol font. */
const SYMBOL: Record<number, number> = {
  0x22: 0x2200,
  0x24: 0x2203,
  0x27: 0x220b,
  0x2a: 0x2217,
  0x2d: 0x2212,
  0x40: 0x2245,
  0x41: 0x0391,
  0x42: 0x0392,
  0x43: 0x03a7,
  0x44: 0x0394,
  0x45: 0x0395,
  0x46: 0x03a6,
  0x47: 0x0393,
  0x48: 0x0397,
  0x49: 0x0399,
  0x4a: 0x03d1,
  0x4b: 0x039a,
  0x4c: 0x039b,
  0x4d: 0x039c,
  0x4e: 0x039d,
  0x4f: 0x039f,
  0x50: 0x03a0,
  0x51: 0x0398,
  0x52: 0x03a1,
  0x53: 0x03a3,
  0x54: 0x03a4,
  0x55: 0x03a5,
  0x56: 0x03c2,
  0x57: 0x03a9,
  0x58: 0x039e,
  0x59: 0x03a8,
  0x5a: 0x0396,
  0x5c: 0x2234,
  0x5e: 0x22a5,
  0x60: 0x203e,
  0x61: 0x03b1,
  0x62: 0x03b2,
  0x63: 0x03c7,
  0x64: 0x03b4,
  0x65: 0x03b5,
  0x66: 0x03c6,
  0x67: 0x03b3,
  0x68: 0x03b7,
  0x69: 0x03b9,
  0x6a: 0x03d5,
  0x6b: 0x03ba,
  0x6c: 0x03bb,
  0x6d: 0x03bc,
  0x6e: 0x03bd,
  0x6f: 0x03bf,
  0x70: 0x03c0,
  0x71: 0x03b8,
  0x72: 0x03c1,
  0x73: 0x03c3,
  0x74: 0x03c4,
  0x75: 0x03c5,
  0x76: 0x03d6,
  0x77: 0x03c9,
  0x78: 0x03be,
  0x79: 0x03c8,
  0x7a: 0x03b6,
  0x7e: 0x223c,
  0xa1: 0x03d2,
  0xa2: 0x2032,
  0xa3: 0x2264,
  0xa4: 0x2044,
  0xa5: 0x221e,
  0xa6: 0x0192,
  0xa7: 0x2663,
  0xa8: 0x2666,
  0xa9: 0x2665,
  0xaa: 0x2660,
  0xab: 0x2194,
  0xac: 0x2190,
  0xad: 0x2191,
  0xae: 0x2192,
  0xaf: 0x2193,
  0xb0: 0x00b0,
  0xb1: 0x00b1,
  0xb2: 0x2033,
  0xb3: 0x2265,
  0xb4: 0x00d7,
  0xb5: 0x221d,
  0xb6: 0x2202,
  0xb7: 0x2022,
  0xb8: 0x00f7,
  0xb9: 0x2260,
  0xba: 0x2261,
  0xbb: 0x2248,
  0xbc: 0x2026,
  0xbf: 0x21b5,
  0xc0: 0x2135,
  0xc1: 0x2111,
  0xc2: 0x211c,
  0xc3: 0x2118,
  0xc4: 0x2297,
  0xc5: 0x2295,
  0xc6: 0x2205,
  0xc7: 0x2229,
  0xc8: 0x222a,
  0xc9: 0x2283,
  0xca: 0x2287,
  0xcb: 0x2284,
  0xcc: 0x2282,
  0xcd: 0x2286,
  0xce: 0x2208,
  0xcf: 0x2209,
  0xd0: 0x2220,
  0xd1: 0x2207,
  0xd2: 0x00ae,
  0xd3: 0x00a9,
  0xd4: 0x2122,
  0xd5: 0x220f,
  0xd6: 0x221a,
  0xd7: 0x22c5,
  0xd8: 0x00ac,
  0xd9: 0x2227,
  0xda: 0x2228,
  0xdb: 0x21d4,
  0xdc: 0x21d0,
  0xdd: 0x21d1,
  0xde: 0x21d2,
  0xdf: 0x21d3,
  0xe0: 0x25ca,
  0xe1: 0x2329,
  0xe5: 0x2211,
  0xf2: 0x222b,
};

type Pen = {
  kind: "pen";
  color?: string;
  width: number;
  dash: string;
};
type Brush = { kind: "brush"; color?: string };
type Font = {
  kind: "font";
  face: string;
  size: number;
  italic: boolean;
  underline: boolean;
  weight: number;
  escapement: number;
  symbol: boolean;
};
type GdiObject = Pen | Brush | Font;

type Dc = {
  pen: Pen;
  brush: Brush;
  font: Font;
  text: string;
  bk: string;
  bkMode: number;
  align: number;
  x: number;
  y: number;
  clip?: { id: string; x: number; y: number; w: number; h: number };
};

function cssColor(r: number, g: number, b: number) {
  const hex = (n: number) => (n & 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function faceName(bytes: Uint8Array, charset: number) {
  const end = bytes.indexOf(0);
  const raw = end < 0 ? bytes : bytes.subarray(0, end);
  if (charset === 128 || charset === 129 || charset === 134 || charset === 136) {
    const label =
      charset === 128 ? "shift_jis" : charset === 134 ? "gbk" : charset === 136 ? "big5" : "euc-kr";
    try {
      const text = new TextDecoder(label).decode(raw).replace(/\0/g, "").trim();
      if (text) return text;
    } catch {
      /* The label is missing; the Windows-1252 face name is the fallback. */
    }
  }
  const text = new TextDecoder("windows-1252").decode(raw).replace(/\0/g, "").trim();
  return text || "Arial";
}

function symbolText(bytes: Uint8Array, symbol: boolean) {
  let text = "";
  for (const byte of bytes) {
    const mapped = symbol ? SYMBOL[byte] : undefined;
    text += mapped ? String.fromCodePoint(mapped) : String.fromCharCode(byte);
  }
  return text;
}

function stock(index: number): GdiObject | undefined {
  const brushes: Record<number, string | undefined> = {
    0: "#ffffff",
    1: "#c0c0c0",
    2: "#808080",
    3: "#404040",
    4: "#000000",
    5: undefined,
  };
  const pens: Record<number, string | undefined> = {
    6: "#ffffff",
    7: "#000000",
    8: undefined,
  };
  if (index in brushes) return { kind: "brush", color: brushes[index] };
  if (index in pens)
    return { kind: "pen", color: pens[index], width: 0, dash: "" };
}

/** SVG data URL for a path-based WMF, or undefined when the file is not one. */
export function vectorWmf(bytes: Uint8Array): string | undefined {
  if (bytes.length < 18) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  let winOrgX = 0;
  let winOrgY = 0;
  let winExtX = 1;
  let winExtY = 1;
  if (view.getUint32(0, true) === 0x9ac6cdd7 && bytes.length >= 22 + 18) {
    const left = view.getInt16(6, true);
    const top = view.getInt16(8, true);
    const right = view.getInt16(10, true);
    const bottom = view.getInt16(12, true);
    winOrgX = left;
    winOrgY = top;
    winExtX = right - left || 1;
    winExtY = bottom - top || 1;
    pos = 22;
  }
  const type = view.getUint16(pos, true);
  const headerWords = view.getUint16(pos + 2, true);
  if ((type !== 1 && type !== 2) || headerWords < 9) return;
  pos += headerWords * 2;
  if (pos > bytes.length) return;

  const defaultFont = (): Font => ({
    kind: "font",
    face: "Arial",
    size: 12,
    italic: false,
    underline: false,
    weight: 400,
    escapement: 0,
    symbol: false,
  });
  let pen: Pen = { kind: "pen", color: "#000000", width: 0, dash: "" };
  let brush: Brush = { kind: "brush", color: "#ffffff" };
  let font = defaultFont();
  let textColor = "#000000";
  let bkColor = "#ffffff";
  let bkMode = 2;
  let align = 0;
  let currentX = 0;
  let currentY = 0;
  let clip: Dc["clip"];
  const saved: Dc[] = [];
  const objects: (GdiObject | undefined)[] = [];
  const defs: string[] = [];
  const shapes: string[] = [];
  let draw = "";
  let clipId = 0;

  const mapPoint = (x: number, y: number) =>
    [
      ((x - winOrgX) / (winExtX || 1)) * Math.abs(winExtX),
      ((y - winOrgY) / (winExtY || 1)) * Math.abs(winExtY),
    ] as const;
  const clipAttr = () => (clip ? ` clip-path="url(#${clip.id})"` : "");
  const strokeAttrs = (ink: Pen) => {
    if (!ink.color) return "";
    const cosmetic = !(ink.width > 0);
    const width = cosmetic ? 1 : Math.abs(ink.width);
    const scale = cosmetic ? "" : ` stroke-width="${num(width)}"`;
    const effect = cosmetic ? ` stroke-width="1" vector-effect="non-scaling-stroke"` : scale;
    const dash = ink.dash
      ? ` stroke-dasharray="${ink.dash
          .split(" ")
          .map((part) => num(Number(part) * (cosmetic ? 1 : width)))
          .join(" ")}"`
      : "";
    return ` stroke="${ink.color}"${effect} stroke-linecap="round" stroke-linejoin="round"${dash}`;
  };
  const flush = () => {
    if (!draw) return;
    const stroke = strokeAttrs(pen);
    if (stroke) shapes.push(`<path d="${draw}" fill="none"${stroke}${clipAttr()}/>`);
    draw = "";
  };
  const rememberClip = (rect: { x: number; y: number; w: number; h: number }) => {
    const next = clip
      ? {
          x: Math.max(clip.x, rect.x),
          y: Math.max(clip.y, rect.y),
          w: Math.min(clip.x + clip.w, rect.x + rect.w) - Math.max(clip.x, rect.x),
          h: Math.min(clip.y + clip.h, rect.y + rect.h) - Math.max(clip.y, rect.y),
        }
      : rect;
    if (!(next.w > 0) || !(next.h > 0)) return;
    clipId += 1;
    const id = `c${clipId}`;
    clip = { ...next, id };
    defs.push(
      `<clipPath id="${id}"><rect x="${num(next.x)}" y="${num(next.y)}" width="${num(next.w)}" height="${num(next.h)}"/></clipPath>`,
    );
  };
  const alloc = (object: GdiObject) => {
    const index = objects.findIndex((slot) => !slot);
    if (index < 0) objects.push(object);
    else objects[index] = object;
  };
  const select = (index: number) => {
    const object = index & 0x8000 ? stock(index & 0x7fff) : objects[index];
    if (!object) return;
    flush();
    if (object.kind === "pen") pen = object;
    else if (object.kind === "brush") brush = object;
    else font = object;
  };
  const moveTo = (x: number, y: number) => {
    currentX = x;
    currentY = y;
    const [px, py] = mapPoint(x, y);
    draw += `M${num(px)} ${num(py)}`;
  };
  const lineTo = (x: number, y: number) => {
    if (!draw) moveTo(currentX, currentY);
    currentX = x;
    currentY = y;
    const [px, py] = mapPoint(x, y);
    draw += `L${num(px)} ${num(py)}`;
  };
  const points = (at: number, count: number) => {
    const pts: [number, number][] = [];
    for (let n = 0; n < count; n++) {
      const cursor = at + n * 4;
      if (cursor + 4 > bytes.length) break;
      pts.push([view.getInt16(cursor, true), view.getInt16(cursor + 2, true)]);
    }
    return pts;
  };
  const paintClosed = (pts: [number, number][], ellipse?: { cx: number; cy: number; rx: number; ry: number }) => {
    flush();
    const fill = brush.color ?? "none";
    const stroke = strokeAttrs(pen);
    if (fill === "none" && !stroke) return;
    if (ellipse) {
      shapes.push(
        `<ellipse cx="${num(ellipse.cx)}" cy="${num(ellipse.cy)}" rx="${num(ellipse.rx)}" ry="${num(ellipse.ry)}" fill="${fill}"${stroke}${clipAttr()}/>`,
      );
      return;
    }
    if (!pts.length) return;
    let path = "";
    pts.forEach(([x, y], index) => {
      const [px, py] = mapPoint(x, y);
      path += `${index ? "L" : "M"}${num(px)} ${num(py)}`;
    });
    shapes.push(`<path d="${path}Z" fill="${fill}"${stroke}${clipAttr()}/>`);
  };
  const paintText = (x: number, y: number, raw: Uint8Array, dx: number[]) => {
    flush();
    const chars = [...symbolText(raw, font.symbol)];
    if (!chars.length) return;
    const widths = dx.length === chars.length ? dx : chars.map(() => font.size * 0.5);
    const total = widths.reduce((sum, width) => sum + width, 0);
    const horizontal = align & 6;
    let origin = x;
    if (dx.length && horizontal === 6) origin -= total / 2;
    else if (dx.length && horizontal === 2) origin -= total;
    const [px, py] = mapPoint(origin, y);
    const anchor =
      !dx.length && horizontal === 6 ? "middle" : !dx.length && horizontal === 2 ? "end" : "start";
    const vertical = align & 24;
    const baseline =
      vertical === 24 ? "alphabetic" : vertical === 8 ? "text-after-edge" : "text-before-edge";
    const [ax, ay] = mapPoint(x, y);
    const turn =
      font.escapement
        ? ` transform="rotate(${num(-font.escapement / 10)} ${num(ax)} ${num(ay)})"`
        : "";
    const style = [
      `fill="${textColor}"`,
      `font-family="${xml(font.face)}"`,
      `font-size="${num(font.size)}"`,
      font.italic ? `font-style="italic"` : "",
      font.weight >= 600 ? `font-weight="${font.weight}"` : "",
      font.underline ? `text-decoration="underline"` : "",
      `text-anchor="${anchor}"`,
      `dominant-baseline="${baseline}"`,
      `xml:space="preserve"`,
    ]
      .filter(Boolean)
      .join(" ");
    let cursor = origin;
    const body =
      dx.length === chars.length
        ? chars
            .map((char, index) => {
              const [cx, cy] = mapPoint(cursor, y);
              cursor += widths[index];
              return `<tspan x="${num(cx)}" y="${num(cy)}">${xml(char)}</tspan>`;
            })
            .join("")
        : xml(chars.join(""));
    if (bkMode === 2 && bkColor) {
      const top = vertical === 24 ? y - font.size * 0.8 : vertical === 8 ? y - font.size : y;
      const [bx, by] = mapPoint(origin, top);
      const [ex, ey] = mapPoint(origin + total, top + font.size);
      shapes.push(
        `<rect x="${num(Math.min(bx, ex))}" y="${num(Math.min(by, ey))}" width="${num(Math.abs(ex - bx))}" height="${num(Math.abs(ey - by))}" fill="${bkColor}"/>`,
      );
    }
    shapes.push(`<text x="${num(px)}" y="${num(py)}" ${style}${turn}${clipAttr()}>${body}</text>`);
  };

  const i16 = (at: number) => view.getInt16(at, true);
  const u16 = (at: number) => view.getUint16(at, true);

  while (pos + 6 <= bytes.length) {
    const words = view.getUint32(pos, true);
    if (words < 3) break;
    const next = pos + words * 2;
    if (next <= pos || next > bytes.length) break;
    const func = u16(pos + 4);
    const body = pos + 6;
    const end = next;
    if (func === 0) break;
    if (func === 0x020b && end >= body + 4) {
      flush();
      winOrgY = i16(body);
      winOrgX = i16(body + 2);
    } else if (func === 0x020c && end >= body + 4) {
      flush();
      winExtY = i16(body) || 1;
      winExtX = i16(body + 2) || 1;
    } else if (func === 0x0209 && end >= body + 4) {
      textColor = cssColor(bytes[body], bytes[body + 1], bytes[body + 2]);
    } else if (func === 0x0201 && end >= body + 4) {
      bkColor = cssColor(bytes[body], bytes[body + 1], bytes[body + 2]);
    } else if (func === 0x0102 && end >= body + 2) {
      bkMode = u16(body);
    } else if (func === 0x012e && end >= body + 2) {
      align = u16(body);
    } else if (func === 0x02fa && end >= body + 10) {
      const style = u16(body) & 0xf;
      const width = Math.abs(i16(body + 2));
      const dash =
        style === 1
          ? "8 4"
          : style === 2
            ? "1 3"
            : style === 3
              ? "8 3 1 3"
              : style === 4
                ? "8 3 1 3 1 3"
                : "";
      alloc({
        kind: "pen",
        color: style === 5 ? undefined : cssColor(bytes[body + 6], bytes[body + 7], bytes[body + 8]),
        width,
        dash,
      });
    } else if (func === 0x02fc && end >= body + 8) {
      const style = u16(body);
      alloc({
        kind: "brush",
        color: style === 1 ? undefined : cssColor(bytes[body + 2], bytes[body + 3], bytes[body + 4]),
      });
    } else if (func === 0x02fb && end >= body + 19) {
      const height = i16(body);
      const weight = u16(body + 8) || 400;
      const charset = bytes[body + 13];
      const face = faceName(bytes.subarray(body + 18, end), charset);
      alloc({
        kind: "font",
        face,
        size: height < 0 ? -height : height || 12,
        italic: bytes[body + 10] !== 0,
        underline: bytes[body + 11] !== 0,
        weight,
        escapement: i16(body + 4),
        symbol: charset === 2 || /^symbol$/i.test(face),
      });
    } else if (func === 0x012d && end >= body + 2) {
      select(u16(body));
    } else if (func === 0x01f0 && end >= body + 2) {
      const index = u16(body);
      if (index < objects.length) objects[index] = undefined;
    } else if (func === 0x001e) {
      saved.push({
        pen,
        brush,
        font,
        text: textColor,
        bk: bkColor,
        bkMode,
        align,
        x: currentX,
        y: currentY,
        clip,
      });
    } else if (func === 0x0127) {
      const dc = saved.pop();
      if (dc) {
        flush();
        pen = dc.pen;
        brush = dc.brush;
        font = dc.font;
        textColor = dc.text;
        bkColor = dc.bk;
        bkMode = dc.bkMode;
        align = dc.align;
        currentX = dc.x;
        currentY = dc.y;
        clip = dc.clip;
      }
    } else if (func === 0x0214 && end >= body + 4) {
      moveTo(i16(body + 2), i16(body));
    } else if (func === 0x0213 && end >= body + 4) {
      lineTo(i16(body + 2), i16(body));
    } else if ((func === 0x0325 || func === 0x0324) && end >= body + 2) {
      const count = u16(body);
      const pts = points(body + 2, Math.min(count, Math.floor((end - body - 2) / 4)));
      if (func === 0x0324) paintClosed(pts);
      else {
        flush();
        let path = "";
        pts.forEach(([x, y], index) => {
          const [px, py] = mapPoint(x, y);
          path += `${index ? "L" : "M"}${num(px)} ${num(py)}`;
        });
        const stroke = strokeAttrs(pen);
        if (path && stroke) shapes.push(`<path d="${path}" fill="none"${stroke}${clipAttr()}/>`);
      }
    } else if ((func === 0x041b || func === 0x0418) && end >= body + 8) {
      const bottom = i16(body);
      const right = i16(body + 2);
      const top = i16(body + 4);
      const left = i16(body + 6);
      if (func === 0x0418) {
        const [x0, y0] = mapPoint(left, top);
        const [x1, y1] = mapPoint(right, bottom);
        paintClosed([], {
          cx: (x0 + x1) / 2,
          cy: (y0 + y1) / 2,
          rx: Math.abs(x1 - x0) / 2,
          ry: Math.abs(y1 - y0) / 2,
        });
      } else {
        paintClosed([
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ]);
      }
    } else if (func === 0x0416 && end >= body + 8) {
      flush();
      const bottom = i16(body);
      const right = i16(body + 2);
      const top = i16(body + 4);
      const left = i16(body + 6);
      const [x0, y0] = mapPoint(left, top);
      const [x1, y1] = mapPoint(right, bottom);
      rememberClip({
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      });
    } else if (func === 0x012c) {
      // A null or unknown region resets the clip. These charts pass index 0.
      flush();
      clip = undefined;
    } else if (func === 0x0a32 && end >= body + 8) {
      const y = i16(body);
      const x = i16(body + 2);
      const length = u16(body + 4);
      const opts = u16(body + 6);
      let cursor = body + 8;
      if (opts & 0x0006) cursor += 8;
      if (cursor + length > end) {
        pos = next;
        continue;
      }
      const raw = bytes.subarray(cursor, cursor + length);
      cursor += length + (length & 1);
      const dx: number[] = [];
      if (end >= cursor + length * 2) {
        for (let n = 0; n < length; n++) dx.push(i16(cursor + n * 2));
      }
      const horizontal = align & 6;
      const useX = align & 1 ? currentX : x;
      const useY = align & 1 ? currentY : y;
      paintText(useX, useY, raw, dx);
      if (align & 1) {
        currentX = useX + (dx.length ? dx.reduce((sum, width) => sum + width, 0) : length * font.size * 0.5);
        if (horizontal === 6) currentX = useX + length * font.size * 0.25;
      }
    }
    pos = next;
  }
  flush();
  if (!shapes.length) return;
  const width = Math.max(Math.abs(winExtX), 1);
  const height = Math.max(Math.abs(winExtY), 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${shapes.join("")}</svg>`;
  return `data:image/svg+xml;base64,${base64(new TextEncoder().encode(svg))}`;
}
