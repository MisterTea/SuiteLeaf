import * as XLSX from "xlsx";
import JSZip from "jszip";
import { b } from "./excel-xml";
import { suiteLeafFont } from "./office-fonts";
import { array, parseXml } from "./office";

const indexedColors = [
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "800000",
  "008000",
  "000080",
  "808000",
  "800080",
  "008080",
  "C0C0C0",
  "808080",
  "9999FF",
  "993366",
  "FFFFCC",
  "CCFFFF",
  "660066",
  "FF8080",
  "0066CC",
  "CCCCFF",
  "000080",
  "FF00FF",
  "FFFF00",
  "00FFFF",
  "800080",
  "800000",
  "008080",
  "0000FF",
  "00CCFF",
  "CCFFFF",
  "CCFFCC",
  "FFFF99",
  "99CCFF",
  "FF99CC",
  "CC99FF",
  "FFCC99",
  "3366FF",
  "33CCCC",
  "99CC00",
  "FFCC00",
  "FF9900",
  "FF6600",
  "666699",
  "969696",
  "003366",
  "339966",
  "003300",
  "333300",
  "993300",
  "993366",
  "333399",
  "333333",
].map((value) => "#" + value);
function color(c: any, palette: string[]): string | undefined {
  if (!c) return;
  let rgb = c["@_rgb"];
  if (rgb && /^[a-f\d]{6,8}$/i.test(rgb)) return "#" + rgb.slice(-6);
  if (c["@_theme"] !== undefined) rgb = palette[+c["@_theme"]];
  else if (c["@_indexed"] !== undefined)
    rgb = +c["@_indexed"] === 64 ? "#000000" : indexedColors[+c["@_indexed"]];
  if (!rgb) return;
  const tint = Number(c["@_tint"]) || 0;
  if (!tint) return rgb;
  const channels = (rgb as string)
    .replace("#", "")
    .match(/../g)!
    .map((v: string) => parseInt(v, 16));
  return (
    "#" +
    channels
      .map((n: number) =>
        Math.round(tint < 0 ? n * (1 + tint) : n + (255 - n) * tint)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export async function styleTable(zip: JSZip): Promise<Record<string, any>> {
  const palette = [
    "#FFFFFF",
    "#000000",
    "#EEECE1",
    "#1F497D",
    "#4F81BD",
    "#C0504D",
    "#9BBB59",
    "#8064A2",
    "#4BACC6",
    "#F79646",
    "#0000FF",
    "#800080",
  ];
  const theme = zip.file("xl/theme/theme1.xml");
  if (theme) {
    try {
      const t = parseXml(await theme.async("string"), "theme");
      const scheme = t.theme?.themeElements?.clrScheme;
      const order = [
        "lt1",
        "dk1",
        "lt2",
        "dk2",
        "accent1",
        "accent2",
        "accent3",
        "accent4",
        "accent5",
        "accent6",
        "hlink",
        "folHlink",
      ];
      order.forEach((key, i) => {
        const node = scheme?.[key];
        const value = node?.srgbClr?.["@_val"] ?? node?.sysClr?.["@_lastClr"];
        if (value) palette[i] = "#" + value;
      });
    } catch {
      /* Theme colors fall back to standard Office colors. */
    }
  }
  const f = zip.file("xl/styles.xml");
  if (!f) return { styles: {}, normalFont: { family: suiteLeafFont("Calibri"), size: 11 } };
  const s = parseXml(await f.async("string"), "xl/styles.xml").styleSheet;
  const fonts = array<any>(s?.fonts?.font),
    fills = array<any>(s?.fills?.fill),
    borders = array<any>(s?.borders?.border),
    formats = new Map(
      array<any>(s?.numFmts?.numFmt).map((n) => [
        +n["@_numFmtId"],
        n["@_formatCode"],
      ]),
    );
  const out: Record<string, any> = {};
  array<any>(s?.cellXfs?.xf).forEach((xf, i) => {
    // Native Excel's cell text inset is three points; the grid uses CSS pixels.
    // A stored cell XF replaces the column's alignment in Excel. Explicit
    // General/bottom defaults prevent Univer composing a column alignment
    // into a cell whose XF omits an alignment element.
    const style: any = {
        ht: 0,
        vt: 3,
        tb: 1,
        pd: { l: (3 * 96) / 72, r: (3 * 96) / 72 },
      },
      font = fonts[+xf["@_fontId"]],
      fill = fills[+xf["@_fillId"]],
      border = borders[+xf["@_borderId"]];
    if (font) {
      if (font.name?.["@_val"]) style.ff = suiteLeafFont(font.name["@_val"]);
      if (font.sz?.["@_val"]) style.fs = +font.sz["@_val"];
      if (
        font.b !== undefined &&
        font.b?.["@_val"] !== "0" &&
        font.b?.["@_val"] !== "false"
      )
        style.bl = 1;
      if (
        font.i !== undefined &&
        font.i?.["@_val"] !== "0" &&
        font.i?.["@_val"] !== "false"
      )
        style.it = 1;
      if (font.u !== undefined) style.ul = { s: 1 };
      if (font.strike !== undefined) style.st = { s: 1 };
      const cl = color(font.color, palette);
      if (cl) style.cl = { rgb: cl };
    }
    const bg = color(fill?.patternFill?.fgColor, palette);
    if (bg && fill?.patternFill?.["@_patternType"] !== "none")
      style.bg = { rgb: bg };
    const inherited = array<any>(s?.cellStyleXfs?.xf)[Number(xf["@_xfId"] ?? 0)]
      ?.alignment;
    const a = b(xf["@_applyAlignment"])
      ? (xf.alignment ?? {})
      : (xf.alignment ?? inherited);
    if (a) {
      if (a["@_horizontal"] === "center") style.pd = { l: 0, r: 0 };
      if (a["@_horizontal"] === "right") style.pd = { l: 0, r: 96 / 72 };
      style.ht =
        ({ left: 1, center: 2, right: 3, justify: 4, distributed: 6 } as any)[
          a["@_horizontal"]
        ] ?? 0;
      style.vt =
        ({ top: 1, center: 2, bottom: 3 } as any)[a["@_vertical"]] ?? 3;
      if (b(a["@_wrapText"])) style.tb = 3;
      if (a["@_textRotation"])
        style.tr = { a: Math.min(90, +a["@_textRotation"]) };
    }
    const pattern =
      formats.get(+xf["@_numFmtId"]) ?? XLSX.SSF.get_table()[+xf["@_numFmtId"]];
    if (pattern && pattern !== "General") style.n = { pattern };
    if (border) {
      const bd: any = {};
      const types: any = {
        thin: 1,
        hair: 2,
        dotted: 3,
        dashed: 4,
        dashDot: 5,
        dashDotDot: 6,
        double: 7,
        medium: 8,
        mediumDashed: 9,
        mediumDashDot: 10,
        mediumDashDotDot: 11,
        slantDashDot: 12,
        thick: 13,
      };
      for (const [side, key] of Object.entries({
        top: "t",
        bottom: "b",
        left: "l",
        right: "r",
      })) {
        const edge = border[side];
        if (edge?.["@_style"])
          bd[key] = {
            s: types[edge["@_style"]] ?? 1,
            cl: { rgb: color(edge.color, palette) ?? "#000000" },
          };
      }
      if (Object.keys(bd).length) style.bd = bd;
    }
    if (Object.keys(style).length) out["excel-" + i] = style;
  });
  const normalStyle = array<any>(s?.cellStyles?.cellStyle).find(
    (style) => style["@_builtinId"] === "0" || style["@_name"] === "Normal",
  );
  const normalXf = array<any>(s?.cellStyleXfs?.xf)[
    Number(normalStyle?.["@_xfId"] ?? 0)
  ];
  const normalFont = fonts[Number(normalXf?.["@_fontId"] ?? 0)];
  return {
    styles: out,
    normalFont: {
      family: suiteLeafFont(normalFont?.name?.["@_val"] ?? "Calibri"),
      size: Number(normalFont?.sz?.["@_val"]) || 11,
    },
  };
}
