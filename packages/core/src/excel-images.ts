import JSZip from "jszip";
import { deflate } from "pako";
import { array, readXml, relationships } from "./office";
export type ExcelImage = {
  id: string;
  sheetId: string;
  src: string;
  row: number;
  column: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  anchorType: "0" | "1" | "2";
};
const base64 = (b: Uint8Array) => {
  let s = "";
  for (const n of b) s += String.fromCharCode(n);
  return btoa(s);
};
function png(width: number, height: number, pixels: Uint8Array) {
  const chunks: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  ];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12),
      v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    out.set(data, 8);
    let crc = 0xffffffff;
    for (const b of out.subarray(4, -4)) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    v.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0);
    chunks.push(out);
  };
  const header = new Uint8Array(13),
    v = new DataView(header.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  chunk("IHDR", header);
  const scan = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    scan.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  chunk("IDAT", deflate(scan));
  chunk("IEND", new Uint8Array());
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return "data:image/png;base64," + base64(out);
}
/** Static raster EMF appearances: no scripts, external resources, or ActiveX execution. */
export function rasterEmf(bytes: Uint8Array): string | undefined {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u = (o: number) => v.getUint32(o, true),
    i = (o: number) => v.getInt32(o, true);
  if (bytes.length < 108 || u(0) !== 1 || u(40) !== 0x464d4520) return;
  const left = i(8),
    top = i(12),
    w = i(16) - left + 1,
    h = i(20) - top + 1;
  if (w < 1 || h < 1 || w * h > 16000000) return;
  const pixels = new Uint8Array(w * h * 4).fill(255);
  let bitmaps = 0;
  for (let o = 0; o + 8 <= bytes.length;) {
    const t = u(o),
      size = u(o + 4);
    if (size < 8 || o + size > bytes.length) return;
    if (t === 81) {
      if (
        size < 80 ||
        u(o + 48) < 80 ||
        u(o + 52) < 40 ||
        u(o + 48) + 40 > size ||
        u(o + 56) < 80 ||
        u(o + 56) + u(o + 60) > size ||
        u(o + 68) !== 0x00cc0020
      )
        return;
      const info = o + u(o + 48),
        bits = o + u(o + 56),
        bw = i(info + 4),
        bh = i(info + 8),
        depth = v.getUint16(info + 14, true);
      if (
        u(info + 16) !== 0 ||
        depth !== 24 ||
        bw < 1 ||
        bh === 0 ||
        bw * Math.abs(bh) > 16000000
      )
        return;
      const dx = i(o + 24) - left,
        dy = i(o + 28) - top,
        dw = i(o + 72),
        dh = i(o + 76),
        stride = Math.ceil((bw * 3) / 4) * 4;
      if (
        dw !== bw ||
        Math.abs(dh) !== Math.abs(bh) ||
        bits + stride * Math.abs(bh) > o + size
      )
        return;
      for (let y = 0; y < Math.abs(bh); y++)
        for (let x = 0; x < bw; x++) {
          const tx = dx + x,
            ty = dy + y;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          const p = bits + (bh > 0 ? bh - 1 - y : y) * stride + x * 3,
            d = (ty * w + tx) * 4;
          pixels[d] = bytes[p + 2];
          pixels[d + 1] = bytes[p + 1];
          pixels[d + 2] = bytes[p];
        }
      bitmaps++;
    } else if (
      ![
        1, 9, 10, 11, 17, 18, 22, 25, 33, 34, 37, 39, 40, 48, 70, 75, 76, 14,
      ].includes(t)
    ) {
      // A supported raster subset is safer than dropping unknown vector content.
      return;
    } else if (t === 76 && (size < 100 || u(o + 40) !== 0x00f00021)) return;
    else if (
      t === 39 &&
      (size < 24 || u(o + 12) !== 0 || u(o + 16) !== 0x00ffffff)
    )
      return;
    o += size;
  }
  return bitmaps ? png(w, h, pixels) : undefined;
}
async function imageSource(
  zip: JSZip,
  path: string,
): Promise<string | undefined> {
  const part = zip.file(path);
  if (!part) return;
  const bytes = await part.async("uint8array");
  const kind = /\.(png|jpe?g|gif|webp)$/i.exec(path)?.[1].toLowerCase();
  if (kind)
    return `data:image/${kind === "jpg" ? "jpeg" : kind};base64,${base64(bytes)}`;
  if (/\.emf$/i.test(path)) {
    try {
      return rasterEmf(bytes);
    } catch {
      return;
    }
  }
}
export async function readExcelImages(
  zip: JSZip,
  parts: Map<string, string>,
  warnings: string[],
): Promise<ExcelImage[]> {
  const out: ExcelImage[] = [];
  for (const [sheetId, part] of parts)
    for (const rel of (await relationships(zip, part)).values()) {
      if (rel.external) continue;
      if (rel.type.endsWith("/drawing")) {
        const xml = await readXml(zip, rel.path),
          rels = await relationships(zip, rel.path);
        for (const a of [
          ...array<any>(xml.wsDr?.twoCellAnchor),
          ...array<any>(xml.wsDr?.oneCellAnchor),
        ]) {
          if (!a.pic) continue;
          const image = rels.get(
            a.pic.blipFill?.blip?.["@_embed"] ?? a.pic.blipFill?.blip?.["@_id"],
          );
          if (!image || image.external) continue;
          const src = await imageSource(zip, image.path);
          if (!src) {
            warnings.push(
              "An embedded spreadsheet image format could not be displayed.",
            );
            continue;
          }
          const ext = a.pic.spPr?.xfrm?.ext ?? a.ext;
          const width = Number(ext?.["@_cx"]) / 9525,
            height = Number(ext?.["@_cy"]) / 9525;
          if (!(width > 0 && height > 0)) continue;
          out.push({
            id: `excel-image-${sheetId}-${out.length}`,
            sheetId,
            src,
            row: Number(a.from?.row ?? 0),
            column: Number(a.from?.col ?? 0),
            offsetX: Number(a.from?.colOff ?? 0) / 9525,
            offsetY: Number(a.from?.rowOff ?? 0) / 9525,
            width,
            height,
            anchorType:
              a["@_editAs"] === "absolute"
                ? "2"
                : a["@_editAs"] === "oneCell"
                  ? "0"
                  : "1",
          });
        }
      } else if (rel.type.endsWith("/vmlDrawing")) {
        const xml = await readXml(zip, rel.path),
          rels = await relationships(zip, rel.path);
        const styles = (value: string) =>
          Object.fromEntries(value.split(";").map((p) => p.trim().split(":")));
        const dimension = (value: string | undefined) =>
          value?.endsWith("pt")
            ? (Number(value.slice(0, -2)) * 96) / 72
            : Number(value ?? 0);
        const shapes = array<any>(xml.xml?.shape).map((s) => ({
          s,
          group: undefined as any,
        }));
        for (const group of array<any>(xml.xml?.group))
          for (const s of array<any>(group.shape)) shapes.push({ s, group });
        for (const { s, group } of shapes) {
          const image = rels.get(s.imagedata?.["@_relid"]);
          if (!image || image.external) continue;
          const src = await imageSource(zip, image.path);
          if (!src) {
            warnings.push(
              "A legacy spreadsheet image appearance could not be displayed.",
            );
            continue;
          }
          const anchor = String(s.ClientData?.Anchor ?? "")
              .split(",")
              .map(Number),
            style = styles(String(s["@_style"] ?? ""));
          let width = dimension(style.width),
            height = dimension(style.height),
            row = anchor[2],
            column = anchor[0],
            offsetX = anchor[1],
            offsetY = anchor[3];
          if (group) {
            const gs = styles(group["@_style"] ?? ""),
              origin = String(group["@_coordorigin"] ?? "0,0")
                .split(",")
                .map(Number),
              size = String(group["@_coordsize"] ?? "1,1")
                .split(",")
                .map(Number),
              sx = dimension(gs.width) / size[0],
              sy = dimension(gs.height) / size[1];
            column = row = 0;
            offsetX =
              dimension(gs["margin-left"]) +
              (Number(style.left) - origin[0]) * sx;
            offsetY =
              dimension(gs["margin-top"]) +
              (Number(style.top) - origin[1]) * sy;
            width *= sx;
            height *= sy;
          } else if (anchor.length !== 8) continue;
          if (!(width > 0 && height > 0)) continue;
          out.push({
            id: `excel-image-${sheetId}-${out.length}`,
            sheetId,
            src,
            column,
            offsetX,
            row,
            offsetY,
            width,
            height,
            anchorType: "1",
          });
        }
      }
    }
  return out;
}
