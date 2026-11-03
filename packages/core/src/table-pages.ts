/**
 * Split table rows across pages. The first row is the header. A later page
 * repeats it when asked. A row taller than the page stays on one page.
 * The input heights are not changed.
 */
import { widowSplit } from "./keep-with-next";

export function splitTableRows(
  rowLines: readonly number[],
  linesPerPage: number,
  repeatHeader: boolean,
  firstPageRoom?: number,
): number[][] {
  const limit = Math.max(1, Math.floor(linesPerPage));
  const lines = rowLines.map((line) => Math.max(1, Math.floor(line)));
  if (!lines.length) return [];
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  let room =
    firstPageRoom == null ? limit : Math.max(0, Math.min(limit, Math.floor(firstPageRoom)));
  if (room === 0) room = limit;
  const flush = () => {
    if (!page.length) return;
    pages.push(page);
    page = [];
    used = 0;
    room = limit;
  };
  for (let index = 0; index < lines.length; index++) {
    const height = lines[index];
    if (height > limit) {
      flush();
      pages.push([index]);
      continue;
    }
    if (page.length > 0 && used + height > room) {
      flush();
      if (repeatHeader && index !== 0 && lines[0] <= limit && lines[0] + height <= limit) {
        page.push(0);
        used = lines[0];
      }
    }
    page.push(index);
    used += height;
  }
  flush();
  return pages;
}

export type SectionPiece =
  | { kind: "text"; lines: number; keepNext?: boolean; widowControl?: boolean }
  | { kind: "break" }
  | { kind: "table"; heights: readonly number[]; repeatHeader: boolean };

function followerLines(piece: SectionPiece | undefined, limit: number): number {
  if (!piece) return 0;
  if (piece.kind === "text") return Math.max(0, Math.floor(piece.lines));
  if (piece.kind !== "table") return 0;
  const heights = piece.heights.map((line) => Math.max(1, Math.floor(line)));
  const sum = heights.reduce((total, line) => total + line, 0);
  if (sum <= limit) return sum;
  return heights[0] ?? 0;
}

/** Page index where each piece starts. A keep-with-next line moves with the next piece. */
export function sectionPiecePages(pieces: readonly SectionPiece[], linesPerPage: number): number[] {
  return layoutSection(pieces, linesPerPage).starts;
}

/** Page count for text and tables in order. A table starts in the room the text left. */
export function paginateSection(pieces: readonly SectionPiece[], linesPerPage: number): number {
  return layoutSection(pieces, linesPerPage).count;
}

function layoutSection(
  pieces: readonly SectionPiece[],
  linesPerPage: number,
): { starts: number[]; count: number } {
  const limit = Math.max(1, Math.floor(linesPerPage));
  let pages = 1;
  let used = 0;
  const starts: number[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    if (piece.kind === "break") {
      pages += 1;
      used = 0;
      starts.push(pages - 1);
      continue;
    }
    if (piece.kind === "text" && piece.keepNext && used > 0) {
      const lines = Math.max(0, Math.floor(piece.lines));
      const follow = followerLines(pieces[index + 1], limit);
      if (follow > 0 && lines + follow <= limit && used + lines + follow > limit) {
        pages += 1;
        used = 0;
      }
    }
    if (
      piece.kind === "text" &&
      piece.widowControl &&
      Math.floor(piece.lines) >= 2 &&
      used > 0 &&
      widowSplit(Math.floor(piece.lines), limit, used, true) === 0
    ) {
      pages += 1;
      used = 0;
    }
    starts.push(pages - 1);
    if (piece.kind === "text") {
      let left = Math.max(0, Math.floor(piece.lines));
      while (left > 0) {
        const take =
          piece.widowControl && left >= 2
            ? widowSplit(left, limit, used, true) || (used === 0 ? 1 : 0)
            : Math.min(limit - used, left);
        if (take === 0) {
          pages += 1;
          used = 0;
          continue;
        }
        used += take;
        left -= take;
        if (left > 0) {
          pages += 1;
          used = 0;
        } else if (used >= limit) {
          pages += 1;
          used = 0;
        }
      }
      continue;
    }
    const room = used === 0 ? limit : limit - used;
    const slices = splitTableRows(piece.heights, limit, piece.repeatHeader, room);
    if (!slices.length) continue;
    pages += slices.length - 1;
    const last = slices[slices.length - 1];
    used = last.reduce((sum, index) => sum + Math.max(1, Math.floor(piece.heights[index] ?? 1)), 0);
    if (used >= limit) {
      pages += 1;
      used = 0;
    }
  }
  return { starts, count: pages };
}
