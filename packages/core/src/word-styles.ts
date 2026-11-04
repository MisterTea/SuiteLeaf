interface StyleInfo {
  id: string;
  type: string;
  name?: string;
  basedOn?: string;
  outlineLvl?: number;
  isHeading?: boolean;
  headingLevel?: number;
  numPr?: { numId: string; ilvl: string };
  isBold?: boolean;
  tableFirstRowBold?: boolean;
  tableFirstColBold?: boolean;
}
interface NumberingLevel {
  start: number;
  numFmt: string;
  lvlText: string;
  pStyle?: string;
}
export function parseWordStyles(stylesXml: string): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!stylesXml) return styles;

  const styleRegex = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g;
  let match: RegExpExecArray | null;
  while ((match = styleRegex.exec(stylesXml)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const idMatch = attrs.match(/w:styleId="([^"]+)"/);
    const typeMatch = attrs.match(/w:type="([^"]+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const type = typeMatch ? typeMatch[1] : "";

    const nameMatch = body.match(/<w:name\b[^>]*w:val="([^"]+)"/);
    const basedOnMatch = body.match(/<w:basedOn\b[^>]*w:val="([^"]+)"/);
    const outlineMatch = body.match(/<w:outlineLvl\b[^>]*w:val="([^"]+)"/);

    let numPr: { numId: string; ilvl: string } | undefined;
    const numPrMatch = body.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/);
    if (numPrMatch) {
      const numIdMatch = numPrMatch[1].match(/<w:numId\b[^>]*w:val="([^"]+)"/);
      const ilvlMatch = numPrMatch[1].match(/<w:ilvl\b[^>]*w:val="([^"]+)"/);
      if (numIdMatch && ilvlMatch) {
        numPr = { numId: numIdMatch[1], ilvl: ilvlMatch[1] };
      }
    }

    const hasBold =
      /<w:rPr>[\s\S]*?<w:b(?:\s+[^>]*w:val="(?:true|1|on)")?(?:\/|\s*>[\s\S]*?<\/w:b)[\s\S]*?<\/w:rPr>/.test(
        body,
      ) || /<w:rPr>[\s\S]*?<w:b\/>[\s\S]*?<\/w:rPr>/.test(body);
    const boldDisabled =
      /<w:rPr>[\s\S]*?<w:b\s+[^>]*w:val="(?:false|0|off)"/.test(body);
    const isBold = hasBold && !boldDisabled;

    let tableFirstRowBold = false;
    let tableFirstColBold = false;
    if (type === "table") {
      const firstRowMatch = body.match(
        /<w:tblStylePr\b[^>]*w:type="firstRow"[\s\S]*?<\/w:tblStylePr>/,
      );
      if (
        firstRowMatch &&
        /<w:b(?:\/|\s|>)/.test(firstRowMatch[0]) &&
        !/w:val="(?:false|0|off)"/.test(firstRowMatch[0])
      ) {
        tableFirstRowBold = true;
      }
      const firstColMatch = body.match(
        /<w:tblStylePr\b[^>]*w:type="firstCol"[\s\S]*?<\/w:tblStylePr>/,
      );
      if (
        firstColMatch &&
        /<w:b(?:\/|\s|>)/.test(firstColMatch[0]) &&
        !/w:val="(?:false|0|off)"/.test(firstColMatch[0])
      ) {
        tableFirstColBold = true;
      }
    }

    styles.set(id, {
      id,
      type,
      name: nameMatch ? nameMatch[1] : undefined,
      basedOn: basedOnMatch ? basedOnMatch[1] : undefined,
      outlineLvl: outlineMatch ? parseInt(outlineMatch[1], 10) : undefined,
      numPr,
      isBold,
      tableFirstRowBold,
      tableFirstColBold,
    });
  }

  // Resolve inheritance
  for (const style of styles.values()) {
    let curr = style;
    const visited = new Set<string>([style.id]);
    while (curr.basedOn && styles.has(curr.basedOn)) {
      if (visited.has(curr.basedOn)) break;
      visited.add(curr.basedOn);
      const parent = styles.get(curr.basedOn)!;
      if (style.outlineLvl === undefined && parent.outlineLvl !== undefined) {
        style.outlineLvl = parent.outlineLvl;
      }
      if (!style.isBold && parent.isBold) {
        style.isBold = true;
      }
      if (!style.numPr && parent.numPr) {
        style.numPr = parent.numPr;
      }
      curr = parent;
    }

    if (
      style.outlineLvl !== undefined &&
      style.outlineLvl >= 0 &&
      style.outlineLvl <= 8
    ) {
      style.isHeading = true;
      style.headingLevel = Math.min(6, style.outlineLvl + 1);
    } else {
      const name = style.name || style.id;
      const m = name.match(
        /(?:heading|titre|überschrift|encabezado)\s*([1-6])/i,
      );
      if (m) {
        style.isHeading = true;
        style.headingLevel = parseInt(m[1], 10);
      } else if (name.toLowerCase() === "title") {
        style.isHeading = true;
        style.headingLevel = 1;
      } else if (name.toLowerCase() === "subtitle") {
        style.isHeading = true;
        style.headingLevel = 2;
      }
    }
  }

  return styles;
}
export function parseWordNumbering(numXml: string) {
  const nums = new Map<string, string>();
  const abstractNums = new Map<string, Map<number, NumberingLevel>>();
  const pStyleToNum = new Map<string, { numId: string; ilvl: number }>();
  if (!numXml) return { nums, abstractNums, pStyleToNum };

  const absRegex =
    /<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[\s\S]*?<\/w:abstractNum>/g;
  let absMatch: RegExpExecArray | null;
  while ((absMatch = absRegex.exec(numXml)) !== null) {
    const absId = absMatch[1];
    const absBody = absMatch[0];
    const levels = new Map<number, NumberingLevel>();

    const lvlRegex = /<w:lvl\b[^>]*w:ilvl="([^"]+)"[\s\S]*?<\/w:lvl>/g;
    let lvlMatch: RegExpExecArray | null;
    while ((lvlMatch = lvlRegex.exec(absBody)) !== null) {
      const ilvl = parseInt(lvlMatch[1], 10);
      const lvlBody = lvlMatch[0];

      const startMatch = lvlBody.match(/<w:start\b[^>]*w:val="([^"]+)"/);
      const fmtMatch = lvlBody.match(/<w:numFmt\b[^>]*w:val="([^"]+)"/);
      const txtMatch = lvlBody.match(/<w:lvlText\b[^>]*w:val="([^"]+)"/);
      const pStyleMatch = lvlBody.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/);

      levels.set(ilvl, {
        start: startMatch ? parseInt(startMatch[1], 10) : 1,
        numFmt: fmtMatch ? fmtMatch[1] : "decimal",
        lvlText: txtMatch ? txtMatch[1] : `%${ilvl + 1}`,
        pStyle: pStyleMatch ? pStyleMatch[1] : undefined,
      });
    }
    abstractNums.set(absId, levels);
  }

  const numRegex = /<w:num\b[^>]*w:numId="([^"]+)"[\s\S]*?<\/w:num>/g;
  let numMatch: RegExpExecArray | null;
  while ((numMatch = numRegex.exec(numXml)) !== null) {
    const numId = numMatch[1];
    const numBody = numMatch[0];
    const absRefMatch = numBody.match(/<w:abstractNumId\b[^>]*w:val="([^"]+)"/);
    if (absRefMatch) {
      const absId = absRefMatch[1];
      nums.set(numId, absId);

      const levels = abstractNums.get(absId);
      if (levels) {
        for (const [ilvl, lvl] of levels.entries()) {
          if (lvl.pStyle) {
            pStyleToNum.set(lvl.pStyle, { numId, ilvl });
          }
        }
      }
    }
  }

  return { nums, abstractNums, pStyleToNum };
}
export function formatNumber(val: number, fmt: string): string {
  if (fmt === "lowerLetter") {
    return String.fromCharCode(97 + ((val - 1) % 26));
  }
  if (fmt === "upperLetter") {
    return String.fromCharCode(65 + ((val - 1) % 26));
  }
  return String(val);
}
