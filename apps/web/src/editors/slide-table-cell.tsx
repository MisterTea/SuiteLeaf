import type { TextRun } from "@suiteleaf/core";
import { runsToHtml } from "./slide-runs";


function cellText(cell: string) {
  if (!cell.includes("`")) return cell;
  return cell.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={index}>{part.slice(1, -1)}</code>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/** A trailing newline is an empty paragraph. CSS drops it unless it is its own line. */
function cellParagraphs(
  cell: string,
  mark?: { bold?: boolean; italic?: boolean; font?: string; fontSize?: number; tabSize?: number },
) {
  const paint = (part: string) =>
    part.includes("\t") ? tabbedCellLine(part, mark) : cellText(part);
  if (!cell.includes("\n")) return paint(cell);
  return cell.split("\n").map((part, index) => (
    <span key={index} style={{ display: "block", minHeight: part ? undefined : "1lh" }}>
      {part ? paint(part) : "\u00a0"}
    </span>
  ));
}

function tabbedCellLine(
  part: string,
  mark?: { bold?: boolean; italic?: boolean; font?: string; fontSize?: number; tabSize?: number },
  line?: { margin?: number; hang?: number; first?: number; tabs?: TextRun["paraTabs"] },
) {
  const html = runsToHtml(
    [
      {
        text: part,
        ...(mark?.bold ? { bold: true } : {}),
        ...(mark?.italic ? { italic: true } : {}),
        ...(mark?.font ? { font: mark.font } : {}),
        ...(mark?.fontSize ? { fontSize: mark.fontSize } : {}),
        ...(mark?.tabSize ? { paraTab: mark.tabSize } : {}),
        ...(line?.margin ? { paraMargin: line.margin } : {}),
        ...(line?.hang ? { paraHang: line.hang } : {}),
        ...(line?.first ? { paraFirst: line.first } : {}),
        ...(line?.tabs?.length ? { paraTabs: line.tabs } : {}),
      },
    ],
    undefined,
    undefined,
    { fontFamily: mark?.font, fontSize: mark?.fontSize, bold: mark?.bold, italic: mark?.italic },
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function cellBody(
  cell: string,
  mark:
    | {
        font?: string;
        bold?: boolean;
        italic?: boolean;
        fontSize?: number;
        lines?: { margin?: number; hang?: number; first?: number; tabs?: TextRun["paraTabs"] }[];
        tabSize?: number;
        runs?: {
          text: string;
          color?: string;
          font?: string;
          fontSize?: number;
          baseline?: number;
          bold?: boolean;
          fraction?: {
            num: { text: string; script?: "sub" | "sup" }[];
            den: { text: string; script?: "sub" | "sup" }[];
          };
        }[];
      }
    | undefined,
) {
  if (mark?.runs?.length) {
    return (
      <span
        dangerouslySetInnerHTML={{
          __html: runsToHtml(mark.runs as TextRun[], undefined, undefined, {
            fontFamily: mark.font,
            fontSize: mark.fontSize,
            bold: mark.bold,
            italic: mark.italic,
          }),
        }}
      />
    );
  }
  const lines = mark?.lines;
  if (!lines?.some((line) => line.margin || line.hang || line.first || line.tabs?.length))
    return cellParagraphs(cell, mark);
  return cell.split("\n").map((part, index) => {
    const line = lines[index];
    const hang = line?.hang ?? 0;
    const inset = (line?.margin ?? 0) + hang;
    const indented = !!(line?.first || part.includes("\t") || line?.tabs?.length);
    return (
      <span
        key={index}
        style={{
          display: "block",
          margin: 0,
          paddingLeft: inset ? `calc(${inset}px * var(--canvas-fit, 1))` : undefined,
          textIndent: !indented && hang ? `calc(${-hang}px * var(--canvas-fit, 1))` : undefined,
        }}
      >
        {part
          ? indented
            ? tabbedCellLine(part, mark, { first: line?.first, tabs: line?.tabs })
            : cellText(part)
          : "\u00a0"}
      </span>
    );
  });
}
