import { useState } from "react";
import type { FRange } from "@univerjs/sheets/facade";
import { applyNamedFormat, numberFormatById } from "../formats";

type Ref<T> = { current: T };

const HEADER_FILL = "#d2e3fc";
const DATA_FILLS = ["#ffffff", "#e8f0fe"] as const;
type CellBounds = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};
function singleCell(box: CellBounds) {
  return box.startRow === box.endRow && box.startColumn === box.endColumn;
}
function boundsCover(outer: CellBounds, inner: CellBounds) {
  return (
    inner.startRow >= outer.startRow &&
    inner.endRow <= outer.endRow &&
    inner.startColumn >= outer.startColumn &&
    inner.endColumn <= outer.endColumn
  );
}
/**
 * A single cell grows to the sheet's used block when that block is more than
 * one cell and contains the selection. Univer range themes persist as a
 * workbook resource and paint through a render interceptor, so they never
 * land on cell style bg. A single style command paints the block instead.
 */
function rangeForAlternatingColors(sheet: {
  getDataRange?: () => { getRange: () => CellBounds };
}, range: { getRange: () => CellBounds }) {
  const box = range.getRange();
  if (!singleCell(box)) return range;
  const data = sheet.getDataRange?.();
  if (!data) return range;
  const used = data.getRange();
  const rows = used.endRow - used.startRow + 1;
  const columns = used.endColumn - used.startColumn + 1;
  if ((rows < 2 && columns < 2) || !boundsCover(used, box)) return range;
  return data;
}
/** Univer's facade names right alignment "normal" and throws on "right". */
export function facadeAlign(align: "left" | "center" | "right") {
  return align === "right" ? "normal" : align;
}

export function useSheetTextFormat() {
  const [zoom, setZoom] = useState("100%"),
    [fontFamily, setFontFamily] = useState("Arial"),
    [fontSize, setFontSize] = useState(10),
    [isBold, setIsBold] = useState(false),
    [isItalic, setIsItalic] = useState(false),
    [isStrike, setIsStrike] = useState(false),
    [textColor, setTextColor] = useState("#000000"),
    [fillColor, setFillColor] = useState("#ffffff"),
    [hAlign, setHAlign] = useState<"left" | "center" | "right">("left"),
    [vAlign, setVAlign] = useState<"top" | "middle" | "bottom">("middle"),
    [isWrap, setIsWrap] = useState(false);
  return {
    zoom,
    setZoom,
    fontFamily,
    setFontFamily,
    fontSize,
    setFontSize,
    isBold,
    setIsBold,
    isItalic,
    setIsItalic,
    isStrike,
    setIsStrike,
    textColor,
    setTextColor,
    fillColor,
    setFillColor,
    hAlign,
    setHAlign,
    vAlign,
    setVAlign,
    isWrap,
    setIsWrap,
  };
}

export type SheetTextFormat = ReturnType<typeof useSheetTextFormat>;

/** Toolbar and menu commands that format the selected cells. */
export function sheetFormatCommands({
  book,
  api,
  persist,
  syncTextStyle,
  onError,
  setNotice,
  format,
}: {
  book: Ref<any>;
  api: Ref<any>;
  persist: Ref<() => void>;
  syncTextStyle: Ref<() => void>;
  onError: (s: string) => void;
  setNotice: (notice: string) => void;
  format: SheetTextFormat;
}) {
  const {
    setZoom,
    setFontFamily,
    setFontSize,
    setTextColor,
    setFillColor,
    hAlign,
    setHAlign,
    vAlign,
    setVAlign,
    isWrap,
    setIsWrap,
  } = format;
  // Univer's own currency command applies an accounting pattern with red
  // parentheses; the toolbar $ follows Sheets' plain currency instead.
  const formatCurrency = () => {
    const ranges =
      book.current?.getActiveSheet()?.getSelection()?.getActiveRangeList() ??
      [];
    try {
      for (const r of ranges)
        r.setNumberFormat(numberFormatById("currency2")!.code);
    } catch {}
    persist.current();
  };
  const formatPercent = () => {
    try {
      api.current?.executeCommand("sheet.command.numfmt.set.percent");
    } catch {}
    persist.current();
  };
  const addDecimal = () => {
    try {
      api.current?.executeCommand("sheet.command.numfmt.add.decimal.command");
    } catch {}
    persist.current();
  };
  const subtractDecimal = () => {
    try {
      api.current?.executeCommand(
        "sheet.command.numfmt.subtract.decimal.command",
      );
    } catch {}
    persist.current();
  };
  // "More formats": apply a named catalog format (currency, percent, date, …)
  // to the active range by its Excel/Univer number-format code. Unknown ids are
  // a no-op; the active range is read exactly like the currency/percent tools.
  const applyNamedFormatNow = (id: string) => {
    const r = book.current?.getActiveRange();
    if (!r) return;
    const applied = applyNamedFormat(id, (code) => {
      try {
        (r as any).setNumberFormat?.(code);
      } catch {}
    });
    if (applied.ok) persist.current();
  };
  // The same commands as Cmd+B/I and Alt+Shift+5: they toggle from the active
  // cell's style and also format the text being edited inside a cell.
  const toggleTextStyle = (command: string) =>
    void Promise.resolve(api.current?.executeCommand(command))
      .then(() => {
        syncTextStyle.current();
        persist.current();
      })
      .catch((e) => onError(e instanceof Error ? e.message : String(e)));
  const toggleBold = () => toggleTextStyle("sheet.command.set-range-bold");
  const toggleItalic = () => toggleTextStyle("sheet.command.set-range-italic");
  const toggleStrike = () => toggleTextStyle("sheet.command.set-range-stroke");
  const handleTextColor = (color: string) => {
    setTextColor(color);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setFontColor(color);
      persist.current();
    }
  };
  const handleFillColor = (color: string) => {
    setFillColor(color);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setBackgroundColor(color);
      persist.current();
    }
  };
  const alternatingColors = () => {
    const sheet = book.current?.getActiveSheet?.();
    const selected = book.current?.getActiveRange?.();
    if (!sheet || !selected) return;
    const target = rangeForAlternatingColors(sheet, selected);
    const box = target.getRange();
    const width = box.endColumn - box.startColumn + 1;
    const height = box.endRow - box.startRow + 1;
    if (width < 1 || height < 1) return;
    api.current?.syncExecuteCommand("sheet.command.set-style", {
      unitId: book.current.getId(),
      subUnitId: sheet.getSheetId(),
      range: box,
      style: {
        type: "bg",
        value: Array.from({ length: height }, (_, row) =>
          Array.from({ length: width }, () => ({
            rgb: row === 0 ? HEADER_FILL : DATA_FILLS[(row - 1) % 2],
          })),
        ),
      },
    });
    persist.current();
  };
  const applyBorders = () => {
    const r = book.current?.getActiveRange();
    if (r && api.current) {
      try {
        r.setBorder(
          api.current.Enum.BorderType.ALL,
          api.current.Enum.BorderStyleTypes.THIN,
          "#000000",
        );
      } catch {}
      persist.current();
    }
  };
  const mergeCells = () => {
    const r = book.current?.getActiveRange();
    if (r) {
      try {
        r.merge();
      } catch {}
      persist.current();
    }
  };
  const unmergeCells = () => {
    const listed = book.current?.getActiveSheet()?.getSelection()?.getActiveRangeList();
    const active = book.current?.getActiveRange();
    const selected: FRange[] =
      Array.isArray(listed) && listed.length ? listed : active ? [active] : [];
    if (!selected.length) return;
    if (!selected.some((range) => range.isPartOfMerge())) {
      setNotice("These cells are not merged.");
      return;
    }
    try {
      for (const range of selected) {
        if (range.isPartOfMerge()) range.breakApart();
      }
    } catch {}
    setNotice("");
    persist.current();
  };
  const cycleHorizontalAlign = () => {
    const next =
      hAlign === "left" ? "center" : hAlign === "center" ? "right" : "left";
    setHAlign(next);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setHorizontalAlignment(facadeAlign(next));
      persist.current();
    }
  };
  const cycleVerticalAlign = () => {
    const next =
      vAlign === "top" ? "middle" : vAlign === "middle" ? "bottom" : "top";
    setVAlign(next);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setVerticalAlignment(next);
      persist.current();
    }
  };
  const toggleWrap = () => {
    const next = !isWrap;
    setIsWrap(next);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setWrap(next);
      persist.current();
    }
  };
  // Positive tr.a is clockwise on this grid. A non-number is stacked text
  // ({ a: 0, v: 1 }). Null removes tr and leaves wrap.
  const rotateText = (angle: number | { a: 0; v: 1 } | null) => {
    const r = book.current?.getActiveRange();
    if (!r) return;
    if (angle == null) r.setValue({ s: { tr: null } });
    else r.setTextRotation(angle);
    persist.current();
  };
  const handleFontFamily = (family: string) => {
    setFontFamily(family);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setFontFamily(family);
      persist.current();
    }
  };
  const handleFontSize = (size: number) => {
    setFontSize(size);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setFontSize(size);
      persist.current();
    }
  };
  const handleZoom = (z: string) => {
    setZoom(z);
    const ratio = parseInt(z, 10) / 100;
    try {
      const s = book.current?.getActiveSheet();
      s?.zoom(ratio);
    } catch {}
  };
  return {
    formatCurrency,
    formatPercent,
    addDecimal,
    subtractDecimal,
    applyNamedFormatNow,
    toggleBold,
    toggleItalic,
    toggleStrike,
    handleTextColor,
    handleFillColor,
    alternatingColors,
    applyBorders,
    mergeCells,
    unmergeCells,
    cycleHorizontalAlign,
    cycleVerticalAlign,
    toggleWrap,
    rotateText,
    handleFontFamily,
    handleFontSize,
    handleZoom,
  };
}

export type SheetFormatCommands = ReturnType<typeof sheetFormatCommands>;
