import * as CFB from "cfb";
import type { WorkBook } from "xlsx";

export type BinaryExcelLayout = {
  normalFont?: { family: string; size: number };
  fonts?: Array<{
    family: string;
    size: number;
    bold: boolean;
    italic: boolean;
  }>;
  xfs?: Array<{
    font: number;
    horizontal: number;
    vertical: number;
    wrap: boolean;
  }>;
  sheets: Array<{
    frozen?: boolean;
    pane?: { columns: number; rows: number };
    rowHeights?: Record<number, number>;
    cellXfs?: Record<string, number>;
    defaultRowHeight?: number;
    baseColumnWidthChars?: number;
    defaultColumnWidthChars?: number;
  }>;
};

/** Defaults omitted by SheetJS's public BIFF model, read from BIFF5/8 records.
 * Dimensions remain in source points / character units for the XML importer.
 * No macros or workbook code are interpreted.
 */
export function readBinaryExcelLayout(
  bytes: Uint8Array,
  book: WorkBook,
): BinaryExcelLayout {
  const result: BinaryExcelLayout = { sheets: book.SheetNames.map(() => ({})) };
  const font = (book as any).Styles?.Fonts?.[0];
  if (typeof font?.name === "string" && Number(font.sz) > 0)
    result.normalFont = { family: font.name, size: Number(font.sz) };
  if (bytes[0] !== 0xd0 || bytes[1] !== 0xcf) return result;
  const cfb = CFB.read(bytes, { type: "array" });
  const stream = cfb.FileIndex.find(
    (entry) => entry.name === "Workbook" || entry.name === "Book",
  );
  if (!stream?.content) return result;
  const data = new Uint8Array(stream.content);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 8) return result;
  const version = view.getUint16(4, true);
  if (version !== 0x0600 && version !== 0x0500) return result;
  const sheetsByOffset = new Map<number, number>();
  let sheetIndex: number | undefined;
  const fonts: NonNullable<BinaryExcelLayout["fonts"]> = [];
  const xfs: NonNullable<BinaryExcelLayout["xfs"]> = [];
  for (let offset = 0; offset + 4 <= data.length;) {
    const type = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    const start = offset + 4,
      end = start + size;
    if (end > data.length) break;
    if (type === 0x0085 && size >= 8)
      sheetsByOffset.set(view.getUint32(start, true), sheetsByOffset.size);
    if (type === 0x0809) sheetIndex = sheetsByOffset.get(offset);
    if (type === 0x00e0 && version === 0x0600 && size >= 20) {
      const alignment = data[start + 6];
      xfs.push({
        font: view.getUint16(start, true),
        horizontal: alignment & 7,
        vertical: (alignment >> 4) & 7,
        wrap: !!(alignment & 8),
      });
    }
    if (type === 0x0031 && size >= 15) {
      const length = data[start + 14];
      const unicode = version === 0x0600 && (data[start + 15] & 1) !== 0;
      const textStart = start + (version === 0x0600 ? 16 : 15);
      const textEnd = textStart + length * (unicode ? 2 : 1);
      const points = view.getUint16(start, true) / 20;
      if (length && textEnd <= end && points > 0) {
        const characters = data.subarray(textStart, textEnd);
        const family =
          version === 0x0600 && !unicode
            ? String.fromCharCode(...characters)
            : new TextDecoder(unicode ? "utf-16le" : "windows-1252").decode(
                characters,
              );
        result.normalFont ??= { family, size: points };
        fonts.push({
          family,
          size: points,
          bold: view.getUint16(start + 6, true) >= 700,
          italic: !!(view.getUint16(start + 2, true) & 2),
        });
      }
    }
    if (sheetIndex !== undefined && result.sheets[sheetIndex]) {
      const sheet = result.sheets[sheetIndex];
      if (type === 0x023e && size >= 2 && sheet.frozen === undefined)
        sheet.frozen = !!(view.getUint16(start, true) & 8);
      if (type === 0x0041 && size >= 8 && sheet.pane === undefined)
        sheet.pane = {
          columns: view.getUint16(start, true),
          rows: view.getUint16(start + 2, true),
        };
      if (type === 0x0208 && size >= 16) {
        const height = (view.getUint16(start + 6, true) & 0x7fff) / 20;
        if (height > 0)
          (sheet.rowHeights ??= {})[view.getUint16(start, true)] = height;
      }
      const cellRecords = [
        0x0201, 0x0203, 0x0204, 0x0205, 0x0006, 0x00fd, 0x027e,
      ];
      const address = (row: number, column: number) => {
        let name = "";
        for (let n = column + 1; n; n = Math.floor((n - 1) / 26))
          name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
        return name + (row + 1);
      };
      if (cellRecords.includes(type) && size >= 6)
        (sheet.cellXfs ??= {})[
          address(view.getUint16(start, true), view.getUint16(start + 2, true))
        ] = view.getUint16(start + 4, true);
      if ((type === 0x00bd || type === 0x00be) && size >= 8) {
        const row = view.getUint16(start, true),
          first = view.getUint16(start + 2, true),
          stride = type === 0x00bd ? 6 : 2;
        for (
          let pos = start + 4, column = first;
          pos + stride <= end - 2;
          pos += stride, column++
        )
          (sheet.cellXfs ??= {})[address(row, column)] = view.getUint16(
            pos,
            true,
          );
      }
      if (type === 0x0225 && size >= 4) {
        const points = view.getUint16(start + 2, true) / 20;
        if (points > 0) sheet.defaultRowHeight = points;
      }
      if (type === 0x0055 && size >= 2) {
        const chars = view.getUint16(start, true);
        if (chars > 0) sheet.baseColumnWidthChars = chars;
      }
      if (type === 0x0099 && size >= 2) {
        const chars = view.getUint16(start, true) / 256;
        if (chars > 0) sheet.defaultColumnWidthChars = chars;
      }
    }
    if (type === 0x000a) sheetIndex = undefined;
    offset = end;
  }
  if (version === 0x0600) {
    result.fonts = fonts;
    result.xfs = xfs;
  }
  return result;
}
