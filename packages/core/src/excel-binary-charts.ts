import * as CFB from "cfb";
import * as XLSX from "xlsx";
import type { ChartDefinition, SourceRange } from "./index";

// BIFF8 chart records: MS-XLS 2.4 (Series, BRAI, SeriesText,
// SerToCrt, ValueRange, LineFormat, MarkerFormat, TxO and Continue).
export function readBinaryLineCharts(
  bytes: Uint8Array,
  book: XLSX.WorkBook,
): ChartDefinition[] {
  if (bytes[0] !== 0xd0 || bytes[1] !== 0xcf) return [];
  const entry = CFB.read(bytes, { type: "array" }).FileIndex.find(
    (e) => e.name === "Workbook",
  );
  if (!entry?.content) return [];
  const data = new Uint8Array(entry.content),
    v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 8 || v.getUint16(4, true) !== 0x0600) return [];
  const offsets = new Map<number, number>(),
    xti: number[] = [];
  const charts: ChartDefinition[] = [];
  let index: number | undefined,
    current: any,
    activeSeries: any,
    lastAI = -1,
    textLength = 0;
  const range = (p: number, size: number): SourceRange | undefined => {
    if (size < 15) return;
    const token = data[p + 8] & 0x3f,
      sheet = xti[v.getUint16(p + 9, true)];
    if (sheet === undefined || !book.SheetNames[sheet]) return;
    if (token !== 0x3b && token !== 0x3a) return;
    if (token === 0x3b && size < 19) return;
    return {
      sheetId: `sheet-${sheet + 1}`,
      startRow: v.getUint16(p + 11, true),
      endRow: v.getUint16(p + (token === 0x3b ? 13 : 11), true),
      startColumn: v.getUint16(p + (token === 0x3b ? 15 : 13), true) & 0x3fff,
      endColumn: v.getUint16(p + (token === 0x3b ? 17 : 13), true) & 0x3fff,
    };
  };
  const values = (r: SourceRange) => {
    const sheet = book.Sheets[book.SheetNames[Number(r.sheetId.slice(6)) - 1]];
    const result: string[] = [];
    for (let row = r.startRow; row <= r.endRow; row++)
      for (let col = r.startColumn; col <= r.endColumn; col++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
        result.push(cell ? XLSX.utils.format_cell(cell) : "");
      }
    return result;
  };
  for (let offset = 0; offset + 4 <= data.length;) {
    const type = v.getUint16(offset, true),
      size = v.getUint16(offset + 2, true),
      p = offset + 4,
      end = p + size;
    if (end > data.length) break;
    if (type === 0x0085 && size >= 8)
      offsets.set(v.getUint32(p, true), offsets.size);
    if (type === 0x0017 && size >= 2)
      for (let i = 0; i < v.getUint16(p, true) && p + 8 + i * 6 <= end; i++) {
        // External / multi-sheet references cannot be treated as a local range.
        const first = v.getUint16(p + 4 + i * 6, true),
          last = v.getUint16(p + 6 + i * 6, true);
        xti.push(first === last ? first : -1);
      }
    if (type === 0x0809 && offsets.has(offset)) {
      index = offsets.get(offset);
      activeSeries = undefined;
      current =
        (book.Sheets[book.SheetNames[index!]] as any)?.["!type"] === "chart"
          ? {
              series: [],
              titles: [],
              axes: [],
              annotations: [],
              line: false,
              dataTable: false,
            }
          : undefined;
    }
    if (current) {
      if (type === 0x1003) {
        activeSeries = { name: "", color: "#000000", axis: 0, marker: 0 };
        current.series.push(activeSeries);
      }
      if (type === 0x1051 && size >= 8) {
        lastAI = data[p];
        if (activeSeries && lastAI === 1) {
          activeSeries.values = range(p, size);
          activeSeries.numberFormat =
            (book as any).SSF?.[v.getUint16(p + 4, true)] ??
            (XLSX.SSF as any)._table[v.getUint16(p + 4, true)] ??
            "General";
        }
        if (activeSeries && lastAI === 2) {
          const r = range(p, size);
          if (r) current.categories = values(r);
        }
      }
      if (type === 0x100d && size >= 4) {
        const len = data[p + 2],
          unicode = !!(data[p + 3] & 1),
          length = len * (unicode ? 2 : 1);
        if (p + 4 + length <= end) {
          const text = unicode
            ? new TextDecoder("utf-16le").decode(
                data.subarray(p + 4, p + 4 + length),
              )
            : String.fromCharCode(...data.subarray(p + 4, p + 4 + length));
          if (activeSeries && lastAI === 0) activeSeries.name = text;
          else current.titles.push(text);
        }
      }
      if (activeSeries && type === 0x1007 && size >= 4)
        activeSeries.color =
          "#" +
          [...data.subarray(p, p + 3)]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("");
      if (activeSeries && type === 0x1009 && size >= 10)
        activeSeries.marker = v.getUint16(p + 8, true);
      if (activeSeries && type === 0x1045 && size >= 2) {
        activeSeries.axis = v.getUint16(p, true);
        activeSeries = undefined;
      }
      if (type === 0x1018) current.line = true;
      if (type === 0x1063) current.dataTable = true;
      if (type === 0x101f && size >= 42) {
        const flags = v.getUint16(p + 40, true);
        current.axes.push({
          min: flags & 1 ? undefined : v.getFloat64(p, true),
          max: flags & 2 ? undefined : v.getFloat64(p + 8, true),
          step: flags & 4 ? undefined : v.getFloat64(p + 16, true),
        });
      }
      if (type === 0x01b6 && size >= 12) textLength = v.getUint16(p + 10, true);
      else if (type === 0x003c && textLength && size > 1) {
        const unicode = !!(data[p] & 1),
          length = Math.min(
            textLength,
            Math.floor((size - 1) / (unicode ? 2 : 1)),
          );
        const text = unicode
          ? new TextDecoder("utf-16le").decode(
              data.subarray(p + 1, p + 1 + length * 2),
            )
          : String.fromCharCode(...data.subarray(p + 1, p + 1 + length));
        current.annotations.push(text.trim());
        textLength = 0;
      }
    }
    if (type === 0x000a && index !== undefined) {
      if (
        current?.line &&
        current.series.length &&
        current.series.every((s: any) => s.values)
      ) {
        const { series, titles, axes, categories, annotations, dataTable } =
          current;
        charts.push({
          id: crypto.randomUUID(),
          sheetId: `sheet-${index + 1}`,
          title: titles.at(-1) ?? "",
          type: "line",
          source: series[0].values,
          x: 20,
          y: 10,
          width: 1160,
          height: 620,
          excel: {
            series,
            markers: true,
            legend: "none",
            anchorResolved: true,
            anchor: {
              fromColumn: 0,
              fromRow: 0,
              fromColumnOffset: 20,
              fromRowOffset: 10,
              toColumn: 0,
              toRow: 0,
              toColumnOffset: 1180,
              toRowOffset: 630,
            },
            biff: {
              axes,
              categories: categories ?? [],
              annotations,
              dataTable,
              axisTitles: titles.slice(0, -1),
            },
          },
        });
      }
      index = undefined;
      current = undefined;
      activeSeries = undefined;
      textLength = 0;
    }
    offset = end;
  }
  return charts;
}
