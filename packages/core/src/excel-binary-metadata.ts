import * as CFB from "cfb";
import type { WorkBook } from "xlsx";

export type BinaryExcelLayout = {
  normalFont?: { family: string; size: number };
  sheets: Array<{
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
  for (let offset = 0; offset + 4 <= data.length;) {
    const type = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    const start = offset + 4,
      end = start + size;
    if (end > data.length) break;
    if (type === 0x0085 && size >= 8)
      sheetsByOffset.set(view.getUint32(start, true), sheetsByOffset.size);
    if (type === 0x0809) sheetIndex = sheetsByOffset.get(offset);
    if (type === 0x0031 && !result.normalFont && size >= 15) {
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
        result.normalFont = { family, size: points };
      }
    }
    if (sheetIndex !== undefined && result.sheets[sheetIndex]) {
      const sheet = result.sheets[sheetIndex];
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
  return result;
}
