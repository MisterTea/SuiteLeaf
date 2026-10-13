import { linkTarget, safeLink } from "./index";

/** Univer's custom-range type for a hyperlink. */
const HYPERLINK = 0;
const LINK_BLUE = "#1a73e8";

type Cell = Record<string, any>;

function oneLine(value: unknown): string {
  if (value == null || typeof value === "object") return "";
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

/** Visible words in a cell, separate from any link address. */
export function cellLabel(cell: Cell | null | undefined): string {
  if (!cell) return "";
  if (typeof cell.v === "string") return cell.v;
  if (typeof cell.v === "number" || typeof cell.v === "boolean") return String(cell.v);
  const stream = cell.p?.body?.dataStream;
  return typeof stream === "string" ? stream.replace(/[\r\n]/g, "") : "";
}

/** The cell's link address, when Docs would accept it. */
export function cellHyperlink(cell: Cell | null | undefined): string | null {
  const ranges = cell?.p?.body?.customRanges;
  if (Array.isArray(ranges)) {
    for (const range of ranges) {
      const url = range?.properties?.url;
      if (range?.rangeType === HYPERLINK && typeof url === "string" && safeLink(url))
        return url;
    }
  }
  const custom = cell?.custom?.hyperlink;
  if (typeof custom === "string" && safeLink(custom)) return custom;
  return null;
}

/** Rich text that shows `label` and keeps `url` on the text, not in the value. */
export function linkDocument(label: string, url: string) {
  const text = oneLine(label) || url;
  return {
    id: "d",
    documentStyle: {},
    drawings: {},
    drawingsOrder: [] as string[],
    body: {
      dataStream: `${text}\r\n`,
      paragraphs: [{ startIndex: text.length, paragraphId: "para_link" }],
      sectionBreaks: [{ startIndex: text.length + 1, sectionId: "section_link" }],
      textRuns: [
        {
          st: 0,
          ed: text.length,
          ts: { cl: { rgb: LINK_BLUE }, ul: { s: 1 } },
        },
      ],
      customRanges: [
        {
          startIndex: 0,
          endIndex: Math.max(0, text.length - 1),
          rangeId: "link",
          rangeType: HYPERLINK,
          properties: { url },
        },
      ],
    },
  };
}

/** Cell fields for a link. The value stays the label. */
export function linkedCell(label: string, url: string): Cell {
  const text = oneLine(label) || url;
  return { v: text, t: 1, p: linkDocument(text, url) };
}

/**
 * Copy an Excel hyperlink onto a cell. Returns false when the address is
 * refused; the label already on the cell is left alone.
 */
export function takeExcelHyperlink(
  source: { l?: { Target?: string } },
  target: Cell,
  dropped: string[],
) {
  const raw = source.l?.Target;
  if (typeof raw !== "string" || !raw.trim()) return;
  const href = linkTarget(raw);
  if (!href) {
    dropped.push(raw);
    return;
  }
  if (target.f) {
    target.custom = { ...(target.custom ?? {}), hyperlink: href };
    return;
  }
  const label = cellLabel(target) || href;
  if (target.v == null || target.v === "") {
    target.v = label;
    target.t = 1;
  }
  const shown = typeof target.v === "string" ? target.v : label;
  target.p = linkDocument(shown, href);
  if (!target.s) target.s = { cl: { rgb: LINK_BLUE }, ul: { s: 1 } };
}

/** Same note Docs uses when an address is dropped and the words stay. */
export function removedLinkWarning(hrefs: string[]): string {
  const schemes = [
    ...new Set(
      hrefs.flatMap((href) => {
        const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(href)?.[1];
        return scheme ? [`${scheme.toLowerCase()}:`] : [];
      }),
    ),
  ];
  const one = hrefs.length === 1;
  return `${hrefs.length} ${one ? "link" : "links"} with an unsafe or unsupported address${schemes.length ? ` (${schemes.join(", ")})` : ""} ${one ? "was" : "were"} removed; ${one ? "its" : "their"} text was kept.`;
}
