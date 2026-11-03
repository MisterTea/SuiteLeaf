import type JSZip from "jszip";
import type { SlideElement, TextRun } from "./index";
import { paintableImage, pictureClip } from "./pptx-pictures";
import { shapeArtwork, shapeIsHidden } from "./pptx-geometry";
import { themePaint } from "./pptx-theme";

type Metrics = {
  width: number;
  height: number;
  emuWidth: number;
  emuHeight: number;
};

type Paragraph = {
  text: string;
  runs: TextRun[];
  bullet?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: number;
  align?: "left" | "center" | "right" | "justify";
  color?: string;
  font?: string;
  lineHeight?: number;
};

type Zip = Pick<JSZip, "file">;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z0-9:]+)="([^"]*)"/g))
    out[match[1]] = match[2];
  return out;
}

function resolveZipPath(basePath: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath.slice(1);
  const parts = basePath.split("/");
  parts.pop();
  for (const seg of relativePath.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

function boxOf(xfrm: string, metrics: Metrics, dx = 0, dy = 0) {
  const off = attrs(/<(?:a|p):off\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  const ext = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(xfrm)?.[1] || "");
  const emuX = (Number(off.x) || 0) + dx;
  const emuY = (Number(off.y) || 0) + dy;
  const emuW = Number(ext.cx) || 0;
  const emuH = Number(ext.cy) || 0;
  if (!(emuW > 0 && emuH > 0)) return;
  return {
    x: (emuX / metrics.emuWidth) * metrics.width,
    y: (emuY / metrics.emuHeight) * metrics.height,
    width: (emuW / metrics.emuWidth) * metrics.width,
    height: (emuH / metrics.emuHeight) * metrics.height,
  };
}

/** A graphic frame clips its drawing. A rectangle is its box, so the intersection is the visible bar. */
function clipToFrame(
  box: { x: number; y: number; width: number; height: number },
  frame: { x: number; y: number; width: number; height: number },
) {
  const x = Math.max(box.x, frame.x);
  const y = Math.max(box.y, frame.y);
  const right = Math.min(box.x + box.width, frame.x + frame.width);
  const bottom = Math.min(box.y + box.height, frame.y + frame.height);
  if (!(right > x && bottom > y)) return;
  return { x, y, width: right - x, height: bottom - y };
}

/** Drawing coordinates are local to the graphic frame. */
function shiftOffs(xml: string, dx: number, dy: number): string {
  return xml.replace(/<a:off\b([^>]*)\/?>/g, (tag, body: string) => {
    const tagAttrs = attrs(body);
    const x = (Number(tagAttrs.x) || 0) + dx;
    const y = (Number(tagAttrs.y) || 0) + dy;
    return `<a:off x="${x}" y="${y}"/>`;
  });
}

function asSlideShape(dspXml: string, dx: number, dy: number): string {
  return shiftOffs(dspXml, dx, dy)
    .replace(/<dsp:/g, "<p:")
    .replace(/<\/dsp:/g, "</p:");
}

function sniffMime(buf: Uint8Array): string | undefined {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46
  )
    return "image/webp";
  return;
}

function relationshipNumber(id: string): number {
  const n = Number(/(\d+)$/.exec(id)?.[1]);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Office allocates the cached drawing as the relationship immediately after
 * the frame's data, layout, style, and color parts. The .rels document order
 * is not the order of graphic frames, so indexing drawings as they appear
 * swaps SmartArt that shares a slide. A different part in that slot means
 * this diagram has no drawing; another frame's drawing must not fill it.
 */
function diagramDrawingRel(
  slideRels: Record<string, { target: string; type: string }>,
  frameXml: string,
  drawingIndex: number,
) {
  const relIds = /<dgm:relIds\b([^>]*)\/?>/.exec(frameXml)?.[1] ?? "";
  let maxId: string | undefined;
  let max = -1;
  for (const match of relIds.matchAll(/\br:(?:dm|lo|qs|cs)="([^"]+)"/g)) {
    const n = relationshipNumber(match[1]);
    if (n > max) {
      max = n;
      maxId = match[1];
    }
  }
  if (maxId) {
    const nextId = maxId.replace(/(\d+)$/, (_, digits: string) => String(Number(digits) + 1));
    const next = slideRels[nextId];
    if (next?.type.endsWith("/diagramDrawing")) return next;
    if (next) return;
  }
  const drawings = Object.values(slideRels).filter((rel) =>
    rel.type.endsWith("/diagramDrawing"),
  );
  return drawings[drawingIndex];
}

/** Diagram drawings keep picture relationships beside the drawing part. */
async function drawingTargets(zip: Zip, drawingPath: string) {
  const slash = drawingPath.lastIndexOf("/");
  const rels = `${drawingPath.slice(0, slash)}/_rels/${drawingPath.slice(slash + 1)}.rels`;
  const xml = await zip.file(rels)?.async("string");
  const targets: Record<string, string> = {};
  if (!xml) return targets;
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const tag = attrs(match[1]);
    if (tag.Id && tag.Target) targets[tag.Id] = tag.Target;
  }
  return targets;
}

type DgmNode = { body: string; children: DgmNode[] };

type EmuBox = { x: number; y: number; w: number; h: number };

function pointFill(spPr: string): string {
  return /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(spPr)?.[0] ?? "";
}

function paragraphsOf(body: string): string {
  const text = /<dgm:t\b[^>]*>([\s\S]*?)<\/dgm:t>/.exec(body)?.[1] ?? "";
  return [...text.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((match) => match[0]).join("");
}

function collectParas(node: DgmNode, deep: boolean): string {
  let out = paragraphsOf(node.body);
  if (deep) for (const child of node.children) out += collectParas(child, true);
  return out;
}

/** Content nodes in connection order. Presentation stubs are not shapes. */
function contentTree(dataXml: string): DgmNode[] {
  const points = new Map<string, { type: string; body: string }>();
  for (const match of dataXml.matchAll(/<dgm:pt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/dgm:pt>)/g)) {
    const tag = attrs(match[1]);
    if (tag.modelId) points.set(tag.modelId, { type: tag.type || "node", body: match[2] ?? "" });
  }
  const links: { src: string; dest: string; ord: number }[] = [];
  for (const match of dataXml.matchAll(/<dgm:cxn\b([^>]*)\/?>/g)) {
    const tag = attrs(match[1]);
    if (!tag.srcId || !tag.destId) continue;
    if (tag.type === "presOf" || tag.type === "presParOf") continue;
    links.push({ src: tag.srcId, dest: tag.destId, ord: Number(tag.srcOrd) || 0 });
  }
  const kids = (id: string): DgmNode[] =>
    links
      .filter((link) => link.src === id && points.get(link.dest)?.type === "node")
      .sort((a, b) => a.ord - b.ord)
      .map((link) => ({
        body: points.get(link.dest)?.body ?? "",
        children: kids(link.dest),
      }));
  const doc = [...points.entries()].find(([, point]) => point.type === "doc")?.[0];
  const top = doc ? kids(doc) : [];
  if (top.length) return top;
  return [...points.values()]
    .filter((point) => point.type === "node")
    .map((point) => ({ body: point.body, children: [] }));
}

function constraintFact(
  layout: string,
  accept: (tag: Record<string, string>) => boolean,
): number | undefined {
  for (const match of layout.matchAll(/<dgm:constr\b([^>]*)\/?>/g)) {
    const tag = attrs(match[1]);
    if (!accept(tag) || !tag.fact) continue;
    const fact = Number(tag.fact);
    if (fact > 0 && fact < 5) return fact;
  }
  return;
}

function diagramKind(layout: string): "snake" | "lin" | "hier" | "cycle" {
  const named = layout.indexOf('<dgm:layoutNode name="diagram"');
  const start = named >= 0 ? named : layout.indexOf("<dgm:layoutNode");
  const head = start >= 0 ? layout.slice(start) : layout;
  if (/type="hier(?:Child|Root)"/.test(head)) return "hier";
  if (/type="cycle"/.test(head)) return "cycle";
  if (/type="snake"/.test(head)) return "snake";
  if (/type="lin"/.test(head)) return "lin";
  return "snake";
}

function algParam(layout: string, alg: string, name: string): string {
  const body = new RegExp(`<dgm:alg type="${alg}"[^>]*>([\\s\\S]*?)</dgm:alg>`).exec(layout)?.[1];
  if (!body) return "";
  return new RegExp(`<dgm:param type="${name}" val="([^"]+)"`).exec(body)?.[1] ?? "";
}

function textPreset(layout: string): string {
  const types = [...layout.matchAll(/<dgm:shape\b[^>]*\btype="([^"]+)"/g)].map(
    (match) => match[1],
  );
  for (const name of ["roundRect", "homePlate", "rect", "ellipse", "chevron"]) {
    if (types.includes(name)) return name;
  }
  return types[0] || "rect";
}

function styleFills(colorsXml: string): string[] {
  const labels = [
    ...colorsXml.matchAll(/<dgm:styleLbl name="node(\d+)">([\s\S]*?)<\/dgm:styleLbl>/g),
  ].sort((a, b) => Number(a[1]) - Number(b[1]));
  const fills: string[] = [];
  for (const label of labels) {
    const list = /<dgm:fillClrLst\b[\s\S]*?<\/dgm:fillClrLst>/.exec(label[2])?.[0] ?? "";
    const color = /<a:(?:schemeClr|srgbClr)\b[^>]*(?:\/>|>[\s\S]*?<\/a:(?:schemeClr|srgbClr)>)/.exec(
      list,
    )?.[0];
    if (color) fills.push(`<a:solidFill>${color}</a:solidFill>`);
  }
  return fills;
}

function fontFor(fillXml: string, preferred: string): string {
  const srgb = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(fillXml)?.[1];
  if (srgb) {
    const red = Number.parseInt(srgb.slice(0, 2), 16);
    const green = Number.parseInt(srgb.slice(2, 4), 16);
    const blue = Number.parseInt(srgb.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 > 160 ? "dk1" : "lt1";
  }
  const scheme = /schemeClr val="([^"]+)"/.exec(fillXml)?.[1] ?? "";
  if (scheme === "lt1" || scheme === "lt2") return "dk1";
  if (scheme.startsWith("accent") || scheme === "dk1" || scheme === "dk2") return "lt1";
  return preferred || "lt1";
}

function fittedTxBody(paragraphs: string, emuW: number, emuH: number, bullet = false): string {
  const paras = paragraphs.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  if (!paras.length) return "";
  const texts = paras.map((para) =>
    [...para.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((match) => match[1]).join(""),
  );
  const ptW = Math.max(12, emuW / 12700);
  const ptH = Math.max(12, emuH / 12700);
  let size = Math.min(32, ptH / Math.max(1, texts.length));
  for (let pass = 0; pass < 8; pass += 1) {
    const perLine = Math.max(4, ptW / (size * 0.5));
    let lines = 0;
    for (const text of texts) lines += Math.max(1, Math.ceil(Math.max(1, text.trim().length) / perLine));
    const next = Math.max(7, Math.min(36, (ptH * 0.78) / (lines * 1.25)));
    if (Math.abs(next - size) < 0.4) {
      size = next;
      break;
    }
    size = next;
  }
  const sz = String(Math.round(size * 100));
  const fitted = paras
    .map((para) => {
      let next = para;
      const bulletXml = bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : "";
      if (/<a:pPr\b/.test(next)) {
        if (!/\balgn=/.test(next)) next = next.replace(/<a:pPr\b/, '<a:pPr algn="ctr"');
        if (bulletXml && !/<a:buChar\b/.test(next)) {
          next = next.replace(/<a:pPr\b([^>]*?)(\/?)>/, (_full, body: string, slash: string) =>
            slash ? `<a:pPr${body}>${bulletXml}</a:pPr>` : `<a:pPr${body}>${bulletXml}`,
          );
        }
      } else {
        next = next.replace(
          /<a:p\b[^>]*>/,
          (open) => `${open}<a:pPr algn="ctr">${bulletXml}</a:pPr>`,
        );
      }
      if (/<a:rPr\b[^>]*\bsz=/.test(next)) return next;
      if (/<a:rPr\b/.test(next)) {
        return next.replace(/<a:rPr\b([^>]*?)(\/?>)/g, (full, body: string, end: string) =>
          /\bsz=/.test(body) ? full : `<a:rPr${body} sz="${sz}"${end}`,
        );
      }
      return next.replace(/<a:r\b[^>]*>/g, (open) => `${open}<a:rPr sz="${sz}"/>`);
    })
    .join("");
  const inset = Math.round(Math.min(emuW, emuH) * 0.06);
  return `<a:bodyPr anchor="ctr" lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}"/><a:lstStyle/>${fitted}`;
}

function snakeBoxes(
  count: number,
  frameW: number,
  frameH: number,
  aspect: number,
  gap: number,
  grDir: string,
): EmuBox[] {
  let cols = 1;
  let best = -1;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const gridW = columns + Math.max(0, columns - 1) * gap;
    const gridH = rows * aspect + Math.max(0, rows - 1) * gap;
    const scale = Math.min(frameW / gridW, frameH / gridH);
    const cover = (scale * gridW * scale * gridH) / (frameW * frameH);
    if (cover > best + 1e-6) {
      best = cover;
      cols = columns;
    }
  }
  const rows = Math.ceil(count / cols);
  const gridW = cols + (cols - 1) * gap;
  const gridH = rows * aspect + (rows - 1) * gap;
  const scale = Math.min(frameW / gridW, frameH / gridH);
  const nodeW = scale;
  const nodeH = scale * aspect;
  const gapEmu = scale * gap;
  const usedW = cols * nodeW + (cols - 1) * gapEmu;
  const usedH = rows * nodeH + (rows - 1) * gapEmu;
  const originX = (frameW - usedW) / 2;
  const originY = (frameH - usedH) / 2;
  const rtl = grDir.endsWith("R");
  const bottom = grDir.startsWith("b");
  const boxes: EmuBox[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const rowUsed = inRow * nodeW + (inRow - 1) * gapEmu;
    const rowX = originX + (usedW - rowUsed) / 2;
    const xIndex = rtl ? inRow - 1 - col : col;
    const yIndex = bottom ? rows - 1 - row : row;
    boxes.push({
      x: rowX + xIndex * (nodeW + gapEmu),
      y: originY + yIndex * (nodeH + gapEmu),
      w: nodeW,
      h: nodeH,
    });
  }
  return boxes;
}

function linBoxes(
  count: number,
  frameW: number,
  frameH: number,
  dir: string,
  gapFact: number,
): EmuBox[] {
  const vertical = dir === "fromT" || dir === "fromB";
  const span = vertical ? frameH : frameW;
  const cross = vertical ? frameW : frameH;
  const node = span / (count + Math.max(0, count - 1) * gapFact);
  const gapEmu = node * gapFact;
  const boxes: EmuBox[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = dir === "fromB" || dir === "fromR" ? count - 1 - index : index;
    const main = slot * (node + gapEmu);
    boxes.push(
      vertical
        ? { x: 0, y: main, w: cross, h: node }
        : { x: main, y: 0, w: node, h: cross },
    );
  }
  return boxes;
}

function hierBoxes(count: number, frameW: number, frameH: number): EmuBox[] {
  if (count <= 1) return [{ x: frameW * 0.25, y: frameH * 0.2, w: frameW * 0.5, h: frameH * 0.28 }];
  const kids = count - 1;
  const rootH = frameH * 0.28;
  const rootW = Math.min(frameW * 0.42, rootH * 2.4);
  const child = frameW / (kids + (kids - 1) * 0.12);
  const gap = child * 0.12;
  const used = kids * child + (kids - 1) * gap;
  const boxes: EmuBox[] = [
    { x: (frameW - rootW) / 2, y: 0, w: rootW, h: rootH },
  ];
  for (let index = 0; index < kids; index += 1) {
    boxes.push({
      x: (frameW - used) / 2 + index * (child + gap),
      y: rootH + frameH * 0.08,
      w: child,
      h: frameH - rootH - frameH * 0.08,
    });
  }
  return boxes;
}

function cycleBoxes(count: number, frameW: number, frameH: number): EmuBox[] {
  const cx = frameW / 2;
  const cy = frameH / 2;
  const span = Math.min(frameW, frameH);
  const center = span * 0.28;
  const sat = span * 0.2;
  const boxes: EmuBox[] = [{ x: cx - center / 2, y: cy - center / 2, w: center, h: center }];
  const orbit = span * 0.34;
  const sats = Math.max(0, count - 1);
  for (let index = 0; index < sats; index += 1) {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sats;
    boxes.push({
      x: cx + orbit * Math.cos(angle) - sat / 2,
      y: cy + orbit * Math.sin(angle) - sat / 2,
      w: sat,
      h: sat,
    });
  }
  return boxes;
}

type CompositePart = {
  name: string;
  preset: string;
  text: "self" | "desc" | "all" | "none";
  style: string;
  rot?: number;
  bullet: boolean;
};

/** The dir=norm branch wins. A later else list must not slide the chevron back to full width. */
function activeConstraints(xml: string): string {
  const norm = /<dgm:if\b[^>]*\bval="norm"[^>]*>\s*(<dgm:constrLst>[\s\S]*?<\/dgm:constrLst>)/.exec(
    xml,
  );
  if (norm) return norm[1];
  return /<dgm:constrLst>[\s\S]*?<\/dgm:constrLst>/.exec(xml)?.[0] ?? "";
}

function constraintTags(xml: string, forName: string): Record<string, string>[] {
  const tags: Record<string, string>[] = [];
  for (const match of activeConstraints(xml).matchAll(/<dgm:constr\b([^>]*)\/?>/g)) {
    const tag = attrs(match[1]);
    if (tag.forName === forName) tags.push(tag);
  }
  return tags;
}

/**
 * A node forEach that draws more than one shape (a circle beside a chevron,
 * a card beside an arrow) keeps each shape. One shape still uses the node box.
 */
function compositeParts(layout: string): { xml: string; parts: CompositePart[] } | undefined {
  const each = /<dgm:forEach\b[^>]*\bptType="node"[\s\S]*?<\/dgm:forEach>/.exec(layout)?.[0];
  if (!each) return;
  const parts: CompositePart[] = [];
  for (const match of each.matchAll(
    /<dgm:layoutNode\b([^>]*)>(?:(?!<dgm:layoutNode\b)[\s\S])*?<\/dgm:layoutNode>/g,
  )) {
    const shape = attrs(/<dgm:shape\b([^>]*)>/.exec(match[0])?.[1] ?? "");
    const open = attrs(match[1]);
    if (!shape.type || !open.name) continue;
    const text = /axis="desOrSelf"/.test(match[0])
      ? "all"
      : /axis="des"/.test(match[0])
        ? "desc"
        : /axis="self"/.test(match[0]) || /<dgm:alg\b[^>]*\btype="tx"/.test(match[0])
          ? "self"
          : "none";
    const rot = Number(shape.rot);
    parts.push({
      name: open.name,
      preset: shape.type,
      text,
      style: open.styleLbl || "",
      ...(Number.isFinite(rot) ? { rot } : {}),
      bullet: /<dgm:param\b[^>]*\btype="stBulletLvl"/.test(match[0]),
    });
  }
  if (parts.length < 2) return;
  return { xml: each, parts };
}

function constraintMeasure(
  tag: Record<string, string>,
  parent: EmuBox,
  known: Map<string, EmuBox>,
  selfName: string,
  self: EmuBox,
): number {
  const fact = tag.fact == null || tag.fact === "" ? 1 : Number(tag.fact);
  if (!tag.refType) return tag.val != null && tag.val !== "" ? Number(tag.val) : 0;
  const named = tag.refForName;
  const src = named ? (named === selfName ? self : known.get(named) ?? parent) : parent;
  const base = tag.refType === "h" ? src.h : tag.refType === "w" ? src.w : 0;
  return (Number.isFinite(fact) ? fact : 1) * base;
}

function placeComposite(box: EmuBox, xml: string, parts: CompositePart[]): EmuBox[] {
  const known = new Map<string, EmuBox>();
  const sequential = /<dgm:alg\b[^>]*\btype="lin"/.test(xml);
  let cursor = 0;
  return parts.map((part) => {
    let left = 0;
    let top = 0;
    let width = box.w;
    let height = box.h;
    let setLeft = false;
    let setTop = false;
    for (const tag of constraintTags(xml, part.name)) {
      const self = { x: left, y: top, w: width, h: height };
      const value = constraintMeasure(tag, box, known, part.name, self);
      const op = tag.op === "lte" || tag.op === "gte" ? tag.op : "equ";
      const apply = (current: number) =>
        op === "lte" ? Math.min(current, value) : op === "gte" ? Math.max(current, value) : value;
      if (tag.type === "w") width = Math.max(0, apply(width));
      else if (tag.type === "h") height = Math.max(0, apply(height));
      else if (tag.type === "l") {
        left = apply(setLeft ? left : 0);
        setLeft = true;
      } else if (tag.type === "t") {
        top = apply(setTop ? top : 0);
        setTop = true;
      } else if (tag.type === "wOff") width = Math.max(0, width + value);
      else if (tag.type === "hOff") height = Math.max(0, height + value);
      else if (tag.type === "lOff") left += value;
      else if (tag.type === "tOff") top += value;
      else if (tag.type === "b") height = Math.max(0, apply(top + height) - top);
      else if (tag.type === "bOff") height = Math.max(0, height + value);
      else if (tag.type === "r") width = Math.max(0, apply(left + width) - left);
      else if (tag.type === "ctrX") {
        left = value - width / 2;
        setLeft = true;
      } else if (tag.type === "ctrY") {
        top = value - height / 2;
        setTop = true;
      }
      known.set(part.name, { x: left, y: top, w: width, h: height });
    }
    if (!setLeft && sequential) {
      left = cursor;
      cursor += width;
    }
    if (!setTop) top = Math.max(0, (box.h - height) / 2);
    const placed = { x: left, y: top, w: Math.max(0, width), h: Math.max(0, height) };
    known.set(part.name, placed);
    return { x: box.x + placed.x, y: box.y + placed.y, w: placed.w, h: placed.h };
  });
}

function partParagraphs(node: DgmNode, text: CompositePart["text"], separate: boolean): string {
  if (text === "none") return "";
  if (text === "self") return paragraphsOf(node.body);
  if (text === "desc") return node.children.map((child) => collectParas(child, true)).join("");
  return collectParas(node, !separate);
}

function nodeShape(
  box: EmuBox,
  preset: string,
  fillXml: string,
  paragraphs: string,
  font: string,
  rotDeg?: number,
  bullet = false,
  strokeXml = "",
) {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  if (!(w > 0 && h > 0)) return "";
  // A quarter turn is stored on the pre-rotation box, so a tall chevron points
  // down and a wide round2SameRect stays a horizontal bar.
  let sx = x;
  let sy = y;
  let sw = w;
  let sh = h;
  let rotAttr = "";
  if (rotDeg != null && Number.isFinite(rotDeg)) {
    const turn = ((rotDeg % 360) + 360) % 360;
    const quarter = Math.abs(turn - 90) < 0.5 || Math.abs(turn - 270) < 0.5;
    if (quarter) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      sw = h;
      sh = w;
      sx = Math.round(cx - sw / 2);
      sy = Math.round(cy - sh / 2);
      sw = Math.round(sw);
      sh = Math.round(sh);
    }
    rotAttr = ` rot="${Math.round(rotDeg * 60000)}"`;
  }
  const body = fittedTxBody(paragraphs, w, h, bullet);
  const text = body
    ? `<dsp:txBody>${body}</dsp:txBody><dsp:txXfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></dsp:txXfrm>`
    : "";
  const stroke = strokeXml
    ? `<a:ln w="12700"><a:solidFill>${strokeXml}</a:solidFill></a:ln>`
    : "";
  return `<dsp:sp><dsp:nvSpPr><dsp:cNvPr id="2" name="Diagram node"/></dsp:nvSpPr><dsp:spPr><a:xfrm${rotAttr}><a:off x="${sx}" y="${sy}"/><a:ext cx="${sw}" cy="${sh}"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${fillXml}${stroke}</dsp:spPr><dsp:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="${font}"/></a:fontRef></dsp:style>${text}</dsp:sp>`;
}

function nodeColorElements(colorsXml: string): string[] {
  return [...colorsXml.matchAll(/<dgm:styleLbl name="node(\d+)">([\s\S]*?)<\/dgm:styleLbl>/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .flatMap((label) => {
      const list = /<dgm:fillClrLst\b[\s\S]*?<\/dgm:fillClrLst>/.exec(label[2])?.[0] ?? "";
      const color = /<a:(?:schemeClr|srgbClr)\b[^>]*(?:\/>|>[\s\S]*?<\/a:(?:schemeClr|srgbClr)>)/.exec(list)?.[0];
      return color ? [color] : [];
    });
}

function colorMods(xml: string): string {
  return [...xml.matchAll(/<a:(?:tint|shade|alpha|satMod|lumMod|lumOff|hueMod|hueOff|satOff)\b[^>]*\/>/g)]
    .map((match) => match[0])
    .join("");
}

function listColors(block: string, list: string): string[] {
  const body = new RegExp(`<dgm:${list}\\b[\\s\\S]*?<\\/dgm:${list}>`).exec(block)?.[0] ?? "";
  return [...body.matchAll(/<a:(?:schemeClr|srgbClr)\b[^>]*(?:\/>|>[\s\S]*?<\/a:(?:schemeClr|srgbClr)>)/g)].map(
    (match) => match[0],
  );
}

function partPaint(
  colorsXml: string,
  label: string,
  index: number,
  nodeColors: string[],
  cycle: boolean,
  preferred: string,
): { fill: string; stroke: string; font: string } {
  const node = nodeColors[index % Math.max(1, nodeColors.length)] || `<a:schemeClr val="accent1"/>`;
  const block = label
    ? new RegExp(`<dgm:styleLbl name="${label}">([\\s\\S]*?)</dgm:styleLbl>`).exec(colorsXml)?.[1] ?? ""
    : "";
  const fills = listColors(block, "fillClrLst");
  const lines = listColors(block, "linClrLst");
  const scheme = /<a:schemeClr\b[^>]*\bval="([^"]+)"/.exec(node)?.[1] || "accent1";
  let inner = node;
  if (label.includes("FollowNode") && fills.length) {
    inner = `<a:schemeClr val="${scheme}">${colorMods(fills[index % fills.length])}</a:schemeClr>`;
  } else if (fills.length && (label.includes("Acc") || !cycle)) inner = fills[index % fills.length];
  let stroke = "";
  if (lines.length) {
    stroke = label.includes("FollowNode")
      ? `<a:schemeClr val="${scheme}">${colorMods(lines[index % lines.length])}</a:schemeClr>`
      : label.includes("Acc")
        ? node
        : lines[index % lines.length];
  }
  const fill = `<a:solidFill>${inner}</a:solidFill>`;
  const tx = /<dgm:txFillClrLst\b[\s\S]*?<a:schemeClr\b[^>]*\bval="([^"]+)"/.exec(block)?.[1];
  return { fill, stroke, font: tx || fontFor(fill, preferred) };
}

function stackBoxes(count: number, box: EmuBox, gap: number): EmuBox[] {
  const safeGap = Math.min(Math.max(0, gap), box.h / Math.max(2, count * 2));
  const height = (box.h - Math.max(0, count - 1) * safeGap) / Math.max(1, count);
  return Array.from({ length: count }, (_, index) => ({
    x: box.x,
    y: box.y + index * (height + safeGap),
    w: box.w,
    h: height,
  }));
}

function compositeStaticList(
  layoutXml: string,
  colorsXml: string,
  nodes: DgmNode[],
  frameW: number,
  frameH: number,
  preferred: string,
): string {
  if (/<dgm:alg\b[^>]*\btype="([^"]+)"/.exec(layoutXml)?.[1] !== "composite" || !nodes.length)
    return "";
  const shape = /<dgm:layoutNode name="([^"]+)"([^>]*)>\s*<dgm:alg\b[^>]*\btype="sp"[\s\S]*?<dgm:shape\b[^>]*\btype="([^"]+)"[\s\S]*?<\/dgm:layoutNode>/.exec(
    layoutXml,
  );
  const list = /<dgm:layoutNode name="([^"]+)"[^>]*>\s*<dgm:alg\b[^>]*\btype="lin"[\s\S]*?<dgm:forEach\b[^>]*\bptType="node"[\s\S]*?<dgm:layoutNode name="[^"]+"([^>]*)>[\s\S]*?<dgm:shape\b[^>]*\btype="([^"]+)"/.exec(
    layoutXml,
  );
  if (!shape || !list) return "";
  const frame = { x: 0, y: 0, w: frameW, h: frameH };
  const placed = placeComposite(frame, layoutXml, [
    { name: shape[1], preset: shape[3], text: "none", style: "", bullet: false },
    { name: list[1], preset: list[3], text: "none", style: "", bullet: false },
  ]);
  const shapeBox = placed[0];
  const listBox = placed[1];
  if (!shapeBox || !listBox || !(shapeBox.w > 0 && listBox.w > 0)) return "";
  const space = constraintFact(layoutXml, (tag) => tag.type === "h" && tag.forName === "aSpace") ?? 0.08;
  const nodeColors = nodeColorElements(colorsXml);
  const anchor = partPaint(colorsXml, attrs(shape[2]).styleLbl || "", 0, nodeColors, false, preferred);
  const cards = stackBoxes(nodes.length, listBox, frameH * space).map((box, index) => {
    const paint = partPaint(
      colorsXml,
      attrs(list[2]).styleLbl || "",
      index,
      nodeColors,
      true,
      preferred,
    );
    return nodeShape(
      box,
      list[3],
      paint.fill,
      collectParas(nodes[index], true),
      paint.font,
      undefined,
      false,
      paint.stroke,
    );
  });
  return (
    nodeShape(shapeBox, shape[3], anchor.fill, "", anchor.font, undefined, false, anchor.stroke) +
    cards.join("")
  );
}

/**
 * A diagram whose drawing cache has no shapes still has a data model.
 * PowerPoint lays those nodes out from the layout algorithm; an empty
 * cache used to drop the whole graphic frame.
 */
function diagramFromData(
  dataXml: string,
  layoutXml: string,
  colorsXml: string,
  styleXml: string,
  frameW: number,
  frameH: number,
): string {
  if (!(frameW > 0 && frameH > 0) || !dataXml) return "";
  const kind = diagramKind(layoutXml);
  const tree = contentTree(dataXml);
  if (!tree.length) return "";
  const preferred =
    /<a:fontRef\b[^>]*>[\s\S]*?<a:schemeClr\b[^>]*\bval="([^"]+)"/.exec(styleXml)?.[1] || "lt1";
  const staticList = compositeStaticList(layoutXml, colorsXml, tree, frameW, frameH, preferred);
  if (staticList) return staticList;
  const separate = kind === "hier" || kind === "cycle";
  const nodes = separate && tree[0]?.children.length ? [tree[0], ...tree[0].children] : tree;
  const aspect = constraintFact(
    layoutXml,
    (tag) => tag.type === "h" && tag.refType === "w" && tag.for === "ch" && tag.forName !== "sibTrans",
  ) ?? 0.6;
  const gap = constraintFact(
    layoutXml,
    (tag) => tag.type === "w" && tag.forName === "sibTrans",
  ) ?? constraintFact(layoutXml, (tag) => tag.type === "sp") ?? 0.1;
  const boxes =
    kind === "hier"
      ? hierBoxes(nodes.length, frameW, frameH)
      : kind === "cycle"
        ? cycleBoxes(nodes.length, frameW, frameH)
        : kind === "lin"
          ? linBoxes(nodes.length, frameW, frameH, algParam(layoutXml, "lin", "linDir") || "fromL", gap)
          : snakeBoxes(nodes.length, frameW, frameH, aspect, gap, algParam(layoutXml, "snake", "grDir") || "tL");
  const preset = textPreset(layoutXml);
  const composite = compositeParts(layoutXml);
  const fills = styleFills(colorsXml);
  const nodeColors = nodeColorElements(colorsXml);
  return nodes
    .map((node, index) => {
      const own = pointFill(/<dgm:spPr\b[\s\S]*?<\/dgm:spPr>/.exec(node.body)?.[0] ?? "");
      const fill = own || fills[index % Math.max(1, fills.length)] || `<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>`;
      const font = fontFor(fill, preferred);
      const box = boxes[index] ?? boxes[0];
      if (!composite) {
        return nodeShape(box, preset, fill, collectParas(node, !separate), font);
      }
      const placed = placeComposite(box, composite.xml, composite.parts);
      return composite.parts
        .map((part, partIndex) => {
          const painted = part.style
            ? partPaint(colorsXml, part.style, index, nodeColors, true, preferred)
            : undefined;
          const accent = !!part.style && (part.style.includes("Acc") || part.style.includes("Follow"));
          return nodeShape(
            placed[partIndex] ?? box,
            part.preset,
            accent ? painted!.fill : fill,
            partParagraphs(node, part.text, separate),
            accent ? painted!.font : font,
            part.rot,
            part.bullet,
            painted?.stroke ?? "",
          );
        })
        .join("");
    })
    .join("");
}

async function relatedXml(
  zip: Zip,
  slidePath: string,
  slideRels: Record<string, { target: string; type: string }>,
  frameXml: string,
  key: string,
): Promise<string> {
  const relIds = /<dgm:relIds\b([^>]*)\/?>/.exec(frameXml)?.[1] ?? "";
  const id = new RegExp(`\\br:${key}="([^"]+)"`).exec(relIds)?.[1];
  const rel = id ? slideRels[id] : undefined;
  if (!rel) return "";
  return (await zip.file(resolveZipPath(slidePath, rel.target))?.async("string")) ?? "";
}

/**
 * SmartArt saved with a diagram drawing. The drawing is the picture PowerPoint
 * paints. A missing or empty drawing is laid out from the data model instead.
 */
export async function diagramElements(
  zip: Zip,
  slidePath: string,
  slideRels: Record<string, { target: string; type: string }>,
  frameXml: string,
  drawingIndex: number,
  metrics: Metrics,
  themeXml: string | undefined,
  mapXml: string | undefined,
  parseText: (
    txBody: string,
    inherited: string[],
    defaults?: { color?: string },
  ) => Promise<Paragraph[]>,
): Promise<Omit<SlideElement, "id">[]> {
  if (!/<dgm:relIds\b/.test(frameXml)) return [];
  const rel = diagramDrawingRel(slideRels, frameXml, drawingIndex);
  let drawingPath = "";
  let drawing = "";
  if (rel) {
    drawingPath = resolveZipPath(slidePath, rel.target);
    drawing = (await zip.file(drawingPath)?.async("string")) ?? "";
  }
  const frameXfrm =
    /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(frameXml)?.[0] ?? "";
  const frameOff = attrs(/<(?:a|p):off\b([^>]*)\/?>/.exec(frameXfrm)?.[1] || "");
  const frameExt = attrs(/<(?:a|p):ext\b([^>]*)\/?>/.exec(frameXfrm)?.[1] || "");
  const dx = Number(frameOff.x) || 0;
  const dy = Number(frameOff.y) || 0;
  const framePx = {
    x: (dx / metrics.emuWidth) * metrics.width,
    y: (dy / metrics.emuHeight) * metrics.height,
    width: ((Number(frameExt.cx) || 0) / metrics.emuWidth) * metrics.width,
    height: ((Number(frameExt.cy) || 0) / metrics.emuHeight) * metrics.height,
  };
  const frameClips = framePx.width > 0 && framePx.height > 0;
  if (!/<dsp:sp\b/.test(drawing)) {
    const laidOut = diagramFromData(
      await relatedXml(zip, slidePath, slideRels, frameXml, "dm"),
      await relatedXml(zip, slidePath, slideRels, frameXml, "lo"),
      await relatedXml(zip, slidePath, slideRels, frameXml, "cs"),
      await relatedXml(zip, slidePath, slideRels, frameXml, "qs"),
      Number(frameExt.cx) || 0,
      Number(frameExt.cy) || 0,
    );
    if (!laidOut) return [];
    drawing = `<dsp:drawing>${laidOut}</dsp:drawing>`;
  }
  const pictureRels = drawingPath ? await drawingTargets(zip, drawingPath) : {};
  const elements: Omit<SlideElement, "id">[] = [];
  for (const match of drawing.matchAll(/<dsp:sp\b[\s\S]*?<\/dsp:sp>/g)) {
    const xml = asSlideShape(match[0], dx, dy);
    if (shapeIsHidden(xml)) continue;
    const xfrm = /<p:spPr\b[\s\S]*?<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(xml)?.[0] ?? "";
    const shapeXfrm = /<a:xfrm\b[\s\S]*?<\/a:xfrm>/.exec(xfrm)?.[0] ?? "";
    const box = boxOf(shapeXfrm, metrics);
    if (!box) continue;
    const geom = /<a:prstGeom\s+prst="([^"]+)"/.exec(xml)?.[1];
    const shapeBox = frameClips && geom === "rect" ? clipToFrame(box, framePx) : box;
    if (!shapeBox) continue;
    const paint = themePaint(themeXml, xml, mapXml);
    const blip = /<a:blipFill\b[\s\S]*?<\/a:blipFill>/.exec(xml)?.[0] ?? "";
    const embed = /\br:embed="([^"]+)"/.exec(blip)?.[1];
    const picture = embed ? pictureRels[embed] : undefined;
    let paintedPicture = false;
    if (picture) {
      const bytes = await zip
        .file(resolveZipPath(drawingPath, picture))
        ?.async("uint8array");
      const src = bytes ? paintableImage(bytes, sniffMime(bytes)) : undefined;
      // The style fillRef is often black. The blip is the shape's real fill.
      // A square bitmap still has to follow the preset, or its corners cover a
      // home-plate callout that sits beside the ellipse.
      if (src) {
        elements.push({
          type: "image",
          ...shapeBox,
          src,
          alt: "Diagram picture",
          ...pictureClip(xml, shapeBox.width, shapeBox.height),
        });
        paintedPicture = true;
      }
    }
    const art = paintedPicture
      ? paint.stroke
        ? shapeArtwork(
            xml,
            { stroke: paint.stroke, strokeEmu: paint.strokeEmu, dash: paint.dash },
            shapeBox,
            metrics,
          )
        : undefined
      : paint.fill || paint.stroke
        ? shapeArtwork(xml, paint, shapeBox, metrics)
        : undefined;
    if (art) elements.push({ ...art, alt: "Diagram shape" });
    const tx = /<p:txBody\b[\s\S]*?<\/p:txBody>/.exec(xml)?.[0];
    if (!tx) continue;
    const paragraphs = await parseText(tx, [], { color: paint.fontColor });
    if (!paragraphs.some((paragraph) => paragraph.text.trim())) continue;
    const textXfrm = /<p:txXfrm\b[\s\S]*?<\/p:txXfrm>/.exec(xml)?.[0] ?? shapeXfrm;
    const rawText = boxOf(textXfrm, metrics) ?? shapeBox;
    const textBox = frameClips ? clipToFrame(rawText, framePx) : rawText;
    if (!textBox) continue;
    const body = attrs(/<a:bodyPr\b([^>]*)\/?>/.exec(tx)?.[1] || "");
    const inset = (name: string, fallback: number) =>
      (Math.max(0, Number(body[name] ?? fallback) || 0) / metrics.emuWidth) *
      metrics.width;
    const pad = /<a:bodyPr\b/.test(tx)
      ? {
          t: inset("tIns", 45720),
          r: inset("rIns", 91440),
          b: inset("bIns", 45720),
          l: inset("lIns", 91440),
        }
      : undefined;
    const first = paragraphs[0];
    const valign =
      body.anchor === "ctr" ? "middle" : body.anchor === "b" ? "bottom" : undefined;
    elements.push({
      type: "text",
      ...textBox,
      content: paragraphs.map((paragraph) => paragraph.text).join("\n"),
      runs: paragraphs.flatMap((paragraph, index) => [
        ...(index ? [{ text: "\n", paragraphBreak: true as const }] : []),
        ...paragraph.runs,
      ]),
      bold: first?.bold,
      italic: first?.italic,
      ...(first?.underline ? { underline: true } : {}),
      fontSize: first?.size || 18,
      fontFamily: first?.font || "Arial",
      color: first?.color || paint.fontColor || "#1e293b",
      align: first?.align || "left",
      bullet: paragraphs.some((paragraph) => paragraph.bullet),
      ...(valign ? { valign } : {}),
      ...(pad
        ? {
            inset: pad.t,
            padLeft: pad.l,
            ...(pad.r !== pad.l ? { padRight: pad.r } : {}),
            ...(pad.b !== pad.t ? { padBottom: pad.b } : {}),
          }
        : {}),
      ...(first?.lineHeight ? { lineHeight: first.lineHeight } : {}),
      ...(body.wrap === "none" ? { nowrap: true } : {}),
    });
  }
  return elements;
}
