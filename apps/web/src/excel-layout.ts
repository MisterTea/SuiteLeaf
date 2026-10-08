import type { IWorkbookData } from "@univerjs/presets";

/** Excel stores character widths against its Normal font, including five pixels
 * of padding. Native macOS Excel rounds the corresponding 72 dpi glyph metric
 * and padding in points; the editor uses 96 dpi CSS pixels. */
export function excelColumnWidthPixels(
  maxDigitWidthCss: number,
  storedCharacters: number | undefined,
  baseCharacters = 8,
  nativeMac = true,
): number {
  if (storedCharacters === 0) return 0;
  const sourceDigitWidth = Math.max(1, Math.round(maxDigitWidthCss));
  if (!nativeMac) {
    return storedCharacters === undefined
      ? baseCharacters * sourceDigitWidth + 5
      : Math.floor(
          ((256 * storedCharacters + Math.floor(128 / sourceDigitWidth)) /
            256) *
            sourceDigitWidth,
        );
  }
  const nativeDigitWidth = Math.max(
    1,
    Math.round((maxDigitWidthCss * 72) / 96),
  );
  const contentCharacters =
    storedCharacters === undefined
      ? baseCharacters
      : Math.max(0, storedCharacters - 5 / sourceDigitWidth);
  return (Math.round(contentCharacters * nativeDigitWidth + 5) * 96) / 72;
}

type ExcelLayout = {
  normalFont: { family: string; size: number };
  defaultColumnWidthChars?: number;
  baseColumnWidthChars: number;
  columnWidths: Record<string, number>;
  resolved?: boolean;
};

/** Resolve imported widths once before creating the actual spreadsheet engine.
 * Retaining a resolution marker prevents reopening from undoing user resizes. */
export async function resolveExcelColumnWidths(workbook: IWorkbookData) {
  const pending = Object.values(workbook.sheets).flatMap((sheet) => {
    const layout = sheet.custom?.excelLayout as ExcelLayout | undefined;
    return layout && !layout.resolved ? [{ sheet, layout }] : [];
  });
  if (!pending.length) return;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Excel font metrics are unavailable.");
  const fontSpec = (layout: ExcelLayout) =>
    `${layout.normalFont.size}pt ${JSON.stringify(layout.normalFont.family)}`;
  await Promise.all(
    pending.map(({ layout }) => document.fonts.load(fontSpec(layout))),
  );
  await document.fonts.ready;
  const nativeMac = navigator.platform.includes("Mac");
  for (const { sheet, layout } of pending) {
    context.font = fontSpec(layout);
    const digitWidth = Math.max(
      ...Array.from("0123456789", (digit) => context.measureText(digit).width),
    );
    sheet.defaultColumnWidth = excelColumnWidthPixels(
      digitWidth,
      layout.defaultColumnWidthChars,
      layout.baseColumnWidthChars,
      nativeMac,
    );
    for (const [column, characters] of Object.entries(layout.columnWidths)) {
      sheet.columnData ??= {};
      sheet.columnData[Number(column)] = {
        ...sheet.columnData[Number(column)],
        w: excelColumnWidthPixels(digitWidth, characters, 8, nativeMac),
      };
    }
    layout.resolved = true;
  }
}
