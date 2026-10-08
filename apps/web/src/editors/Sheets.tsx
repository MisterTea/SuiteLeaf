import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createUniver,
  defaultTheme,
  darkBlueTheme,
  LocaleType,
  mergeLocales,
  numfmt,
  type IWorkbookData,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import CoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import DrawingEnUS from "@univerjs/preset-sheets-drawing/locales/en-US";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import FilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import SortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import FindEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-drawing/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import Papa from "papaparse";
import {
  BarChart3,
  TableProperties,
  X,
  RefreshCw,
  Filter,
  Undo2,
  Redo2,
  Printer,
  PaintRoller,
  Search,
  Minus,
  Plus,
  Bold,
  Italic,
  Strikethrough,
  PaintBucket,
  Grid,
  Split,
  AlignLeft,
  AlignVerticalSpaceAround,
  WrapText,
  Link,
  MessageSquarePlus,
  ChevronDown,
} from "lucide-react";
import {
  filename,
  parseRange,
  rangeLabel,
  type SheetFile,
  type ChartDefinition,
  type PivotDefinition,
  type SourceRange,
} from "@suiteleaf/core";
import { pivotResult, shiftRange, type CellValue } from "../analysis";
import { exportText, printDocument } from "../storage";
import { Tool, type EditorActions } from "../ui";
import "../excel-overflow";
import "../excel-number-display";
import "../excel-wrap";
import { resolveExcelColumnWidths } from "../excel-layout";
import { useTheme } from "../theme";

type ChartState = {
  definition: ChartDefinition;
  values: CellValue[][];
  numberFormats: string[];
  excelValues?: CellValue[][];
};
function ExcelLineChart({
  chart,
  series,
}: {
  chart: ChartDefinition;
  series: CellValue[][];
}) {
  const w = chart.width,
    h = chart.height;
  const count = Math.max(1, ...series.map((s) => s.length));
  const maximum = Math.max(
    0,
    ...series.flat().filter((v): v is number => typeof v === "number"),
  );
  const step =
    Math.pow(10, Math.floor(Math.log10(maximum || 1))) *
    (maximum <= 20 ? 0.2 : 0.5);
  const top = 15,
    bottom = h - 34,
    left = 34,
    right = w - (chart.excel?.legend === "r" ? 128 : 20);
  const limit = Math.max(step, Math.ceil(maximum / step) * step);
  const px = (i: number) => left + ((right - left) * (i + 0.5)) / count;
  const py = (v: number) => bottom - ((bottom - top) * v) / limit;
  const ticks = Array.from(
    { length: Math.round(limit / step) + 1 },
    (_, i) => i * step,
  );
  return (
    <svg
      className="excel-line-chart"
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{
        background: "white",
        fontFamily: "Calibri",
        fontSize: 12,
      }}
      aria-label="Imported Excel line chart"
    >
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        fill="none"
        stroke="#808080"
      />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={right} y1={py(v)} y2={py(v)} stroke="#808080" />
          <text x={left - 12} y={py(v) + 4} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <line x1={left} x2={left} y1={top} y2={bottom} stroke="#808080" />
      {Array.from({ length: count }, (_, i) => (
        <g key={i}>
          <line
            x1={px(i)}
            x2={px(i)}
            y1={bottom}
            y2={bottom + 5}
            stroke="#808080"
          />
          <text x={px(i)} y={bottom + 22} textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
      {series.map((s, i) => {
        const color = chart.excel!.series[i].color;
        const points = s.flatMap((v, j) =>
          typeof v === "number" ? [{ x: px(j), y: py(v) }] : [],
        );
        return (
          <g key={i}>
            <polyline
              fill="none"
              stroke={color}
              strokeWidth={3.3}
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {chart.excel?.markers &&
              points.map((p, j) =>
                i % 2 ? (
                  <rect
                    key={j}
                    x={p.x - 5}
                    y={p.y - 5}
                    width={10}
                    height={10}
                    fill={color}
                  />
                ) : (
                  <path
                    key={j}
                    d={`M${p.x} ${p.y - 5}l5 5-5 5-5-5Z`}
                    fill={color}
                  />
                ),
              )}
            {chart.excel?.legend === "r" && (
              <g
                transform={`translate(${right + 20},${h / 2 + (i - (series.length - 1) / 2) * 24})`}
              >
                <line x2={27} stroke={color} strokeWidth={3.3} />
                {i % 2 ? (
                  <rect x={10} y={-4} width={8} height={8} fill={color} />
                ) : (
                  <path d="M14 -4l4 4-4 4-4-4Z" fill={color} />
                )}
                <text x={30} y={4}>
                  {chart.excel.series[i].name}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
function suggestedChartTitle(headers: CellValue[]) {
  const names = headers
    .slice(1)
    .map((value) => String(value ?? ""))
    .filter(Boolean);
  if (!names.length) return "Chart";
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
const charts = new Map<string, ChartState>();
const emptyChart: ChartState | undefined = undefined;
function EmbeddedChart({ data }: { data?: { chartId: string } }) {
  const id = data?.chartId ?? "";
  const state = useSyncExternalStore(
    (callback) => {
      const event = `chart:${id}`;
      window.addEventListener(event, callback);
      return () => window.removeEventListener(event, callback);
    },
    () => charts.get(id) ?? emptyChart,
  );
  if (!state) return <div>Loading chart…</div>;
  const { definition: c, values, numberFormats } = state;
  if (c.excel && !c.invalid)
    return <ExcelLineChart chart={c} series={state.excelValues ?? []} />;
  const formatValue = (value: unknown, column: number) =>
    numberFormats[column]
      ? numfmt.format(numberFormats[column], value)
      : String(value ?? "");
  const formatAxis = (value: number) => formatValue(value, 1);
  const formatTooltip = (
    value: unknown,
    _name: unknown,
    item: { dataKey?: unknown },
  ) => {
    const column =
      item.dataKey === "y"
        ? 1
        : Number(String(item.dataKey ?? "v0").slice(1)) + 1;
    return formatValue(value, column);
  };
  if (c.invalid)
    return (
      <div className="suiteleaf-chart">
        <strong>{c.title}</strong>
        <p>Source range unavailable. Edit this chart to select a new range.</p>
      </div>
    );
  const headers = values[0] ?? [],
    keys = headers.slice(1).map((_, i) => `v${i}`);
  const rows = values.slice(1).map((r) => ({
    label: String(r[0] ?? ""),
    ...Object.fromEntries(
      keys.map((k, i) => [k, typeof r[i + 1] === "number" ? r[i + 1] : null]),
    ),
  }));
  const colors = ["#267c60", "#5989c7", "#d6a348", "#8c70b8", "#c77366"];
  return (
    <div className="suiteleaf-chart" aria-label={`Chart: ${c.title}`}>
      <strong>{c.title}</strong>
      <ResponsiveContainer width="100%" height="88%">
        {c.type === "pie" ? (
          <PieChart>
            <Pie
              data={rows}
              dataKey="v0"
              nameKey="label"
              fill={colors[0]}
              label
            />
            <Tooltip formatter={formatTooltip} />
          </PieChart>
        ) : c.type === "scatter" ? (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={String(headers[0] ?? "X")}
              tickFormatter={(v) => formatValue(v, 0)}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={String(headers[1] ?? "Y")}
              tickFormatter={formatAxis}
            />
            <Tooltip formatter={formatTooltip} />
            <Scatter
              data={values
                .slice(1)
                .filter(
                  (r) => typeof r[0] === "number" && typeof r[1] === "number",
                )
                .map((r) => ({ x: r[0], y: r[1] }))}
              fill={colors[0]}
            />
          </ScatterChart>
        ) : c.type === "line" ? (
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              label={{
                value: String(headers[0] ?? ""),
                position: "insideBottom",
                offset: -5,
              }}
              height={48}
            />
            <YAxis tickFormatter={formatAxis} width={85} />
            <Tooltip formatter={formatTooltip} />
            <Legend itemSorter={null} verticalAlign="top" />
            {keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                name={String(headers[i + 1] ?? k)}
                stroke={colors[i % colors.length]}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              label={{
                value: String(headers[0] ?? ""),
                position: "insideBottom",
                offset: -5,
              }}
              height={48}
            />
            <YAxis tickFormatter={formatAxis} width={85} />
            <Tooltip formatter={formatTooltip} />
            <Legend itemSorter={null} verticalAlign="top" />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                name={String(headers[i + 1] ?? k)}
                fill={colors[i % colors.length]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
export default function Sheets({
  file,
  onChange,
  onActions,
  onError,
}: {
  file: SheetFile;
  onChange: (content: SheetFile["content"]) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
}) {
  const { isDark } = useTheme();
  const host = useRef<HTMLDivElement>(null),
    api = useRef<any>(null),
    book = useRef<any>(null),
    content = useRef(structuredClone(file.content)),
    changes = useRef(onChange),
    error = useRef(onError);
  changes.current = onChange;
  error.current = onError;
  const [ready, setReady] = useState(false),
    [panel, setPanel] = useState<"chart" | "pivot" | null>(null),
    [editing, setEditing] = useState<string>(),
    [range, setRange] = useState("A1:B5"),
    [sourceSheet, setSourceSheet] = useState(""),
    [title, setTitle] = useState("Chart"),
    [chartType, setChartType] = useState<ChartDefinition["type"]>("bar"),
    [rowFields, setRowFields] = useState("0"),
    [columnFields, setColumnFields] = useState(""),
    [valueField, setValueField] = useState(1),
    [aggregate, setAggregate] = useState<PivotDefinition["aggregate"]>("SUM"),
    [filterColumn, setFilterColumn] = useState(-1),
    [filterValue, setFilterValue] = useState(""),
    [, setRevision] = useState(0),
    [zoom, setZoom] = useState("100%"),
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
  const pending = useRef(false);
  const persist = useRef<() => void>(() => {}),
    refreshCharts = useRef<() => void>(() => {});
  const readRange = (r: SourceRange): CellValue[][] => {
    const s = book.current?.getSheetBySheetId(r.sheetId);
    if (!s || r.endRow >= s.getMaxRows() || r.endColumn >= s.getMaxColumns())
      throw new Error("Source range is unavailable.");
    return s.getRange(rangeLabel(r)).getRawValues();
  };
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    const sessionContent = content.current;
    let disposed = false,
      busy = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      chartHydrationTimer: ReturnType<typeof setTimeout> | undefined;
    const chartOrigins = new Map<string, { left: number; top: number }>();
    const hydratedImageIds = new Set<string>();
    let cleanup: (() => void) | undefined;
    let partialCleanup: (() => void) | undefined;
    const initialize = () => {
      const { univer, univerAPI } = createUniver({
        theme: isDark ? darkBlueTheme : defaultTheme,
        darkMode: isDark,
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(
            CoreEnUS,
            DrawingEnUS,
            FilterEnUS,
            SortEnUS,
            FindEnUS,
          ),
        },
        presets: [
          UniverSheetsCorePreset({
            container,
            header: true,
            toolbar: false,
          }),
          UniverSheetsDrawingPreset(),
          UniverSheetsFilterPreset(),
          UniverSheetsSortPreset(),
          UniverSheetsFindReplacePreset(),
        ],
      });
      partialCleanup = () => {
        clearTimeout(timer);
        api.current = null;
        book.current = null;
        persist.current = () => {};
        refreshCharts.current = () => {};
        for (const c of sessionContent.charts) charts.delete(c.id);
        univer.dispose();
      };
      api.current = univerAPI;
      univerAPI.registerComponent("suiteleaf-chart", EmbeddedChart);
      const workbook = univerAPI.createWorkbook(
        content.current.workbook as unknown as IWorkbookData,
      );
      book.current = workbook;
      // Import inert embedded appearances through the editor's native drawing service.
      // Restored workbook resources retain the same IDs, avoiding duplicate images.
      const hydrateImages = async () => {
        for (const image of content.current.images ?? []) {
          if (disposed) return;
          const sheet = workbook.getSheetBySheetId(image.sheetId);
          if (!sheet) continue;
          if (sheet.getImageById(image.id)) {
            hydratedImageIds.add(image.id);
            continue;
          }
          const config = (content.current.workbook as unknown as IWorkbookData)
            .sheets[image.sheetId];
          const span = (axis: "row" | "column", from: number, to: number) => {
            let sum = 0;
            for (let index = from; index < to; index++) {
              if (axis === "column") {
                const column = config.columnData?.[index];
                if (column?.hd === 1) continue;
                sum += column?.w ?? config.defaultColumnWidth ?? 100;
              } else {
                const row = config.rowData?.[index];
                if (row?.hd === 1) continue;
                sum += row?.h ?? config.defaultRowHeight ?? 24;
              }
            }
            return sum;
          };
          const width = image.to
            ? span("column", image.column, image.to.column) +
              image.to.offsetX -
              image.offsetX
            : image.width;
          const height = image.to
            ? span("row", image.row, image.to.row) +
              image.to.offsetY -
              image.offsetY
            : image.height;
          const builder = sheet
            .newOverGridImage()
            .setSource(image.src, univerAPI.Enum.ImageSourceType.BASE64)
            .setColumn(image.column)
            .setRow(image.row)
            .setColumnOffset(image.offsetX)
            .setRowOffset(image.offsetY)
            .setWidth(width)
            .setHeight(height)
            .setAnchorType(image.anchorType as any);
          if (image.to && image.anchorType === "1") {
            builder.setPlacement({
              kind: univerAPI.Enum.SheetDrawingAnchorType.Both,
              from: {
                row: image.row,
                column: image.column,
                rowOffset: image.offsetY,
                columnOffset: image.offsetX,
              },
              to: {
                row: image.to.row,
                column: image.to.column,
                rowOffset: image.to.offsetY,
                columnOffset: image.to.offsetX,
              },
            });
          } else if (image.anchorType === "1") {
            // Grouped VML children use absolute offsets from A1. Normalize
            // those bounds into cell markers before cell sizes can change.
            const markerAt = (axis: "row" | "column", position: number) => {
              let index = 0;
              while (
                index <
                (axis === "row"
                  ? (config.rowCount ?? 1000)
                  : (config.columnCount ?? 26)) -
                  1
              ) {
                const size = span(axis, index, index + 1);
                if (size > 0 && position < size) break;
                position -= size;
                index++;
              }
              return { index, offset: position };
            };
            const left = span("column", 0, image.column) + image.offsetX;
            const top = span("row", 0, image.row) + image.offsetY;
            const fromColumn = markerAt("column", left);
            const fromRow = markerAt("row", top);
            const toColumn = markerAt("column", left + width);
            const toRow = markerAt("row", top + height);
            builder.setPlacement({
              kind: univerAPI.Enum.SheetDrawingAnchorType.Both,
              from: {
                row: fromRow.index,
                column: fromColumn.index,
                rowOffset: fromRow.offset,
                columnOffset: fromColumn.offset,
              },
              to: {
                row: toRow.index,
                column: toColumn.index,
                rowOffset: toRow.offset,
                columnOffset: toColumn.offset,
              },
            });
          }
          const built = await builder.buildAsync();
          if (disposed) return;
          sheet.insertImages([{ ...built, drawingId: image.id }]);
          hydratedImageIds.add(image.id);
        }
      };
      void hydrateImages().catch((cause: unknown) => {
        if (!disposed)
          error.current(
            `Embedded image import failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
      });

      const hydrateCharts = () => {
        if (disposed) return;
        for (const c of content.current.charts) {
          const sheet = workbook.getSheetBySheetId(c.sheetId);
          if (!sheet) continue;
          try {
            const values = c.invalid ? [] : readRange(c.source);
            const numberFormats = c.invalid
              ? []
              : workbook
                  .getSheetBySheetId(c.source.sheetId)!
                  .getRange(rangeLabel(c.source))
                  .getNumberFormats();
            const formats = (values[0] ?? []).map((_, column) => {
              const row = values.findIndex(
                (cells, i) => i > 0 && typeof cells[column] === "number",
              );
              return numberFormats[row]?.[column] ?? "";
            });
            charts.set(c.id, {
              definition: { ...c },
              values,
              numberFormats: formats,
              excelValues: c.excel?.series.map((s) =>
                readRange(s.values).flat(),
              ),
            });
          } catch {
            c.invalid = true;
            charts.set(c.id, {
              definition: { ...c },
              values: [],
              numberFormats: [],
            });
          }
          window.dispatchEvent(new Event(`chart:${c.id}`));
          let origin: { left: number; top: number };
          try {
            origin = JSON.parse(sheet.getRange("A1").getCellRect().toJSON());
          } catch {
            // The canvas for an inactive sheet may not exist until activation.
            continue;
          }
          const gridX = c.excel ? origin.left : 0;
          const gridY = c.excel ? origin.top : 0;
          if (c.excel && !chartOrigins.has(c.id))
            chartOrigins.set(c.id, origin);
          if (!sheet.getFloatDomById(c.id))
            sheet.addFloatDomToPosition(
              {
                componentKey: "suiteleaf-chart",
                data: { chartId: c.id },
                initPosition: {
                  startX: c.x + gridX - (c.excel ? 2 : 0),
                  endX: c.x + c.width + gridX + (c.excel ? 2 : 0),
                  startY: c.y + gridY - (c.excel ? 2 : 0),
                  endY: c.y + c.height + gridY + (c.excel ? 2 : 0),
                },
              },
              c.id,
            );
        }
      };
      refreshCharts.current = () => {
        busy = true;
        try {
          hydrateCharts();
        } finally {
          busy = false;
        }
      };
      const scheduleChartHydration = (remaining = 100) => {
        clearTimeout(chartHydrationTimer);
        chartHydrationTimer = setTimeout(() => {
          if (disposed) return;
          refreshCharts.current();
          const active = workbook.getActiveSheet();
          const missing = content.current.charts.some(
            (c) =>
              c.sheetId === active.getSheetId() &&
              !active.getFloatDomById(c.id),
          );
          if (missing && remaining > 0) scheduleChartHydration(remaining - 1);
          else if (missing)
            error.current(
              "The chart canvas did not become ready. Reopen this workbook to retry.",
            );
        }, 50);
      };
      busy = true;
      hydrateCharts();
      busy = false;
      // Floating drawings need the sheet selection renderer, which is created
      // after the workbook facade. Retry once the initial canvas has mounted.
      scheduleChartHydration();
      persist.current = () => {
        if (disposed) return;
        pending.current = false;
        if (content.current.images)
          content.current.images = content.current.images.filter(
            (image) =>
              !hydratedImageIds.has(image.id) ||
              !!workbook
                .getSheetBySheetId(image.sheetId)
                ?.getImageById(image.id),
          );

        for (const c of content.current.charts) {
          const dom = workbook
            .getSheetBySheetId(c.sheetId)
            ?.getFloatDomById(c.id);
          if (dom) {
            c.x =
              dom.position.left === undefined
                ? c.x
                : dom.position.left -
                  (c.excel ? (chartOrigins.get(c.id)?.left ?? 46) - 2 : 0);
            c.y =
              dom.position.top === undefined
                ? c.y
                : dom.position.top -
                  (c.excel ? (chartOrigins.get(c.id)?.top ?? 20) - 2 : 0);
            c.width =
              dom.position.width === undefined
                ? c.width
                : dom.position.width - (c.excel ? 4 : 0);
            c.height =
              dom.position.height === undefined
                ? c.height
                : dom.position.height - (c.excel ? 4 : 0);
          }
        }
        content.current.workbook =
          workbook.save() as unknown as SheetFile["content"]["workbook"];
        changes.current(structuredClone(content.current));
        setRevision((v) => v + 1);
      };
      const listener = workbook.onCommandExecuted((command: any) => {
        if (busy || disposed || !command.id.includes("mutation")) return;
        pending.current = true;
        const p = command.params ?? {};
        const structural = /sheet\.mutation\.(insert|remove)-(row|col)$/.exec(
          command.id,
        );
        if (structural && p.range) {
          const axis = structural[2] === "row" ? "row" : "column";
          const start = axis === "row" ? p.range.startRow : p.range.startColumn;
          const end = axis === "row" ? p.range.endRow : p.range.endColumn;
          for (const chart of content.current.charts) {
            for (const series of chart.excel?.series ?? []) {
              if (series.values.sheetId !== p.subUnitId) continue;
              const shifted = shiftRange(
                series.values,
                axis,
                start,
                end - start + 1,
                structural[1] === "remove",
              );
              if (shifted) series.values = shifted;
              else chart.invalid = true;
            }
          }
          for (const item of [
            ...content.current.charts,
            ...content.current.pivots,
          ])
            if (item.source.sheetId === p.subUnitId) {
              const shifted = shiftRange(
                item.source,
                axis,
                start,
                end - start + 1,
                structural[1] === "remove",
              );
              if (shifted) item.source = shifted;
              else item.invalid = true;
            }
        }
        for (const item of [
          ...content.current.charts,
          ...content.current.pivots,
        ])
          if (!workbook.getSheetBySheetId(item.source.sheetId))
            item.invalid = true;
        if (command.id.includes("remove-sheet"))
          content.current.pivots = content.current.pivots.filter((p) =>
            workbook.getSheetBySheetId(p.targetSheetId),
          );
        clearTimeout(timer);
        timer = setTimeout(() => {
          refreshCharts.current();
          persist.current();
        }, 180);
      });
      const activeSheetChanged = univerAPI.addEvent(
        univerAPI.Event.ActiveSheetChanged,
        () => {
          setRevision((v) => v + 1);
          scheduleChartHydration();
        },
      );
      const removed = univerAPI.addEvent(
        univerAPI.Event.FloatDomDeleted,
        ({ drawings }) => {
          if (busy || disposed) return;
          content.current.charts = content.current.charts.filter(
            (c) => !drawings.includes(c.id),
          );
          drawings.forEach((id) => charts.delete(id));
          persist.current();
        },
      );
      setReady(true);
      // Native snapshot retains worksheet protection across reopen.
      return () => {
        disposed = true;
        clearTimeout(timer);
        clearTimeout(chartHydrationTimer);
        listener.dispose();
        removed.dispose();
        activeSheetChanged.dispose();
        partialCleanup?.();
        partialCleanup = undefined;
      };
    };
    void resolveExcelColumnWidths(
      content.current.workbook as unknown as IWorkbookData,
    )
      .catch((cause) => {
        if (!disposed)
          error.current(cause instanceof Error ? cause.message : String(cause));
      })
      .then(() => {
        for (const c of content.current.charts) {
          if (!c.excel || c.excel.anchorResolved) continue;
          const sheet = (content.current.workbook as unknown as IWorkbookData)
            .sheets[c.sheetId];
          const a = c.excel.anchor;
          const x = (column: number, offset: number) =>
            Array.from(
              { length: column },
              (_, i) =>
                sheet.columnData?.[i]?.w ?? sheet.defaultColumnWidth ?? 100,
            ).reduce((sum, v) => sum + v, 0) + offset;
          const y = (row: number, offset: number) =>
            Array.from(
              { length: row },
              (_, i) => sheet.rowData?.[i]?.h ?? sheet.defaultRowHeight ?? 24,
            ).reduce((sum, v) => sum + v, 0) + offset;
          c.x = x(a.fromColumn, a.fromColumnOffset);
          c.y = y(a.fromRow, a.fromRowOffset);
          c.width = x(a.toColumn, a.toColumnOffset) - c.x;
          c.height = y(a.toRow, a.toRowOffset) - c.y;
          c.excel.anchorResolved = true;
        }
        if (!disposed) cleanup = initialize();
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        try {
          partialCleanup?.();
        } catch (cleanupCause) {
          if (!disposed)
            error.current(`${message} (cleanup: ${String(cleanupCause)})`);
          return;
        } finally {
          partialCleanup = undefined;
        }
        if (!disposed) error.current(message);
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
    // The workspace mounts a fresh editor per file. Changes must not recreate the engine.
  }, []);
  useEffect(() => {
    if (!api.current) return;
    try {
      api.current.toggleDarkMode?.(isDark);
      api.current.setTheme?.(isDark ? darkBlueTheme : defaultTheme);
    } catch {}
  }, [isDark]);
  const formatCurrency = () => {
    try {
      api.current?.executeCommand("sheet.command.numfmt.set.currency");
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
  const toggleBold = () => {
    const r = book.current?.getActiveRange();
    if (r) {
      const next = r.getFontWeight() !== "bold";
      r.setFontWeight(next ? "bold" : "normal");
      setIsBold(next);
      persist.current();
    }
  };
  const toggleItalic = () => {
    const r = book.current?.getActiveRange();
    if (r) {
      const next = r.getFontStyle() !== "italic";
      r.setFontStyle(next ? "italic" : "normal");
      setIsItalic(next);
      persist.current();
    }
  };
  const toggleStrike = () => {
    const r = book.current?.getActiveRange();
    if (r) {
      const next = r.getFontLine() !== "line-through";
      r.setFontLine(next ? "line-through" : "none");
      setIsStrike(next);
      persist.current();
    }
  };
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
  const cycleHorizontalAlign = () => {
    const next =
      hAlign === "left" ? "center" : hAlign === "center" ? "right" : "left";
    setHAlign(next);
    const r = book.current?.getActiveRange();
    if (r) {
      r.setHorizontalAlignment(next);
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
  const toggleFilter = () => {
    try {
      const sheet = book.current?.getActiveSheet();
      if (!sheet) return;
      const existing = sheet.getFilter();
      if (existing) existing.remove();
      else {
        const selected = book.current?.getActiveRange();
        const target =
          selected && selected.getRange().endRow > selected.getRange().startRow
            ? selected
            : sheet.getDataRange();
        if (!target.createFilter())
          throw new Error(
            "Select a range with a header row to create a filter.",
          );
      }
      persist.current();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (!ready) return;
    onActions({
      flush: async () => {
        await api.current?.getFormula().onCalculationResultApplied(10000);
        if (pending.current) persist.current();
      },
      async export(format) {
        await api.current.getFormula().onCalculationResultApplied(10000);
        const s = book.current.getActiveSheet();
        const values = s.getDataRange().getRawValues();
        await exportText(
          filename(file.title, format),
          Papa.unparse(values, {
            delimiter: format === "tsv" ? "\t" : ",",
            escapeFormulae: true,
          }),
          "text/csv",
        );
      },
      async print() {
        await api.current.getFormula().onCalculationResultApplied(10000);
        const s = book.current.getActiveSheet();
        const values = s.getDataRange().getValues() as CellValue[][];
        if (values.length * (values[0]?.length ?? 0) > 10000)
          throw new Error("Print a sheet with at most 10,000 cells.");
        const escape = (v: unknown) =>
          String(v ?? "").replace(
            /[&<>"']/g,
            (c) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[c]!,
          );
        const el = document.createElement("section");
        el.className = "sheet-print";
        el.innerHTML = `<h1>${escape(file.title)} — ${escape(s.getSheetName())}</h1><table>${values.map((r) => `<tr>${r.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</table>`;
        document
          .querySelectorAll(".suiteleaf-chart")
          .forEach((c) => el.append(c.cloneNode(true)));
        document.body.append(el);
        document.body.classList.add("printing-sheet");
        try {
          await printDocument();
        } finally {
          document.body.classList.remove("printing-sheet");
          el.remove();
        }
      },
      sheetActions: {
        undo: () => void api.current?.undo(),
        redo: () => void api.current?.redo(),
        insertChart: () => startPanel("chart"),
        insertPivot: () => startPanel("pivot"),
        toggleFilter,
        formatCurrency,
        formatPercent,
        toggleBold,
        toggleItalic,
        toggleStrike,
        clearFormatting: () => {
          const r = book.current?.getActiveRange();
          r?.clearFormat();
          persist.current();
        },
        align: (al) => {
          setHAlign(al);
          book.current?.getActiveRange()?.setHorizontalAlignment(al);
          persist.current();
        },
      },
    });
  }, [ready, file.title, onActions]);
  const startPanel = (type: "chart" | "pivot", id?: string) => {
    setPanel(type);
    setEditing(id);
    const c =
      type === "chart"
        ? content.current.charts.find((c) => c.id === id)
        : content.current.pivots.find((c) => c.id === id);
    const s = book.current.getActiveSheet();
    setSourceSheet(c?.source.sheetId ?? s.getSheetId());
    setRange(
      c
        ? rangeLabel(c.source)
        : (book.current.getActiveRange()?.getA1Notation() ?? "A1:B5"),
    );
    setTitle(c?.title ?? (type === "chart" ? "" : "Pivot table"));
    if (type === "chart") setChartType((c as ChartDefinition)?.type ?? "bar");
    else {
      const p = c as PivotDefinition | undefined;
      setRowFields(p?.rows.join(",") ?? "0");
      setColumnFields(p?.columns.join(",") ?? "");
      setValueField(p?.value ?? 1);
      setAggregate(p?.aggregate ?? "SUM");
      setFilterColumn(p?.filterColumn ?? -1);
      setFilterValue(p?.filterValue ?? "");
    }
  };
  const refreshPivot = async (p: PivotDefinition) => {
    await api.current.getFormula().onCalculationResultApplied(10000);
    const values = readRange(p.source);
    const result = pivotResult(values, p);
    const s = book.current.getSheetBySheetId(p.targetSheetId);
    if (!s) throw new Error("The pivot worksheet has been deleted.");
    const permission = s.getWorksheetPermission();
    if (permission.isProtected()) await permission.setEditable();
    try {
      s.clear({ contentsOnly: true });
      if (result.length > s.getMaxRows())
        s.insertRows(s.getMaxRows() - 1, result.length - s.getMaxRows() + 1);
      if (result[0].length > s.getMaxColumns())
        s.insertColumns(
          s.getMaxColumns() - 1,
          result[0].length - s.getMaxColumns() + 1,
        );
      s.getRange(0, 0, result.length, result[0].length).setValues(
        result.map((row) =>
          row.map((v) => (typeof v === "string" ? { v, t: 1 } : v)),
        ),
      );
      s.getRange(0, 0, 1, result[0].length).setFontWeight("bold");
      p.invalid = false;
    } finally {
      if (!permission.isProtected())
        await permission.protect({ name: "Generated pivot" });
      await permission.setReadOnly();
    }
    persist.current();
  };
  const submit = async () => {
    try {
      await api.current.getFormula().onCalculationResultApplied(10000);
      const source = parseRange(range, sourceSheet);
      const values = readRange(source);
      if (values.length < 2 || values[0].length < 2)
        throw new Error(
          "Select a header row and at least two columns with data.",
        );
      if (panel === "chart") {
        const old = content.current.charts.find((c) => c.id === editing);
        const c: ChartDefinition = {
          id: old?.id ?? crypto.randomUUID(),
          title: title.trim() || suggestedChartTitle(values[0]),
          type: chartType,
          source,
          sheetId: old?.sheetId ?? book.current.getActiveSheet().getSheetId(),
          x: old?.x ?? 320,
          y:
            old?.y ??
            Array.from(
              {
                length:
                  book.current.getActiveSheet().getDataRange().getLastRow() + 1,
              },
              (_, row) => book.current.getActiveSheet().getRowHeight(row),
            ).reduce((total: number, height: number) => total + height, 48),
          width: old?.width ?? 520,
          height: old?.height ?? 340,
        };
        content.current.charts = content.current.charts
          .filter((x) => x.id !== c.id)
          .concat(c);
        refreshCharts.current();
        persist.current();
      } else {
        const indices = (v: string) =>
          v.trim() ? v.split(",").map((n) => Number(n.trim())) : [];
        const rows = indices(rowFields),
          columns = indices(columnFields);
        if ([...rows, ...columns].some((n) => !Number.isInteger(n) || n < 0))
          throw new Error("Use field indexes such as 0 or 0,1.");
        const config = {
          rows,
          columns,
          value: valueField,
          aggregate,
          filterColumn,
          filterValue,
        };
        const result = pivotResult(values, config);
        let p = content.current.pivots.find((p) => p.id === editing);
        if (!p) {
          const target = book.current.create(
            `${title.slice(0, 20)} ${content.current.pivots.length + 1}`,
            Math.max(1000, result.length),
            Math.max(26, result[0].length),
          );
          p = {
            id: crypto.randomUUID(),
            title,
            source,
            targetSheetId: target.getSheetId(),
            ...config,
          };
          content.current.pivots.push(p);
        } else Object.assign(p, { title, source, ...config, invalid: false });
        await refreshPivot(p);
        book.current.setActiveSheet(p.targetSheetId);
      }
      setPanel(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  let fields: CellValue[] = [];
  try {
    fields = readRange(parseRange(range, sourceSheet))[0] ?? [];
  } catch {
    /* The inline editor allows temporarily incomplete ranges. */
  }
  const items = content.current;
  return (
    <div className="sheets-editor">
      <div
        className="sheets-toolbar"
        role="toolbar"
        aria-label="Spreadsheet formatting"
      >
        <button
          type="button"
          className="menu-search-pill"
          title="Search the menus (Option+/)"
          onClick={() => {}}
        >
          <Search size={14} className="menu-search-icon" />
          <span>Menus</span>
        </button>

        <Tool label="Undo (Cmd+Z)" onClick={() => void api.current?.undo()}>
          <Undo2 size={16} />
        </Tool>
        <Tool label="Redo (Cmd+Y)" onClick={() => void api.current?.redo()}>
          <Redo2 size={16} />
        </Tool>
        <Tool
          label="Print (Cmd+P)"
          onClick={() => {
            void printDocument(file.title);
          }}
        >
          <Printer size={16} />
        </Tool>
        <Tool label="Paint format" onClick={() => {}}>
          <PaintRoller size={16} />
        </Tool>

        <select
          className="toolbar-select zoom-select"
          aria-label="Zoom"
          value={zoom}
          onChange={(e) => handleZoom(e.target.value)}
        >
          <option value="50%">50%</option>
          <option value="75%">75%</option>
          <option value="90%">90%</option>
          <option value="100%">100%</option>
          <option value="125%">125%</option>
          <option value="150%">150%</option>
          <option value="200%">200%</option>
        </select>

        <span className="toolbar-divider" />

        <Tool label="Format as currency" onClick={formatCurrency}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>$</span>
        </Tool>
        <Tool label="Format as percent" onClick={formatPercent}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>%</span>
        </Tool>
        <Tool label="Decrease decimal places" onClick={subtractDecimal}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>.0←</span>
        </Tool>
        <Tool label="Increase decimal places" onClick={addDecimal}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>.00→</span>
        </Tool>
        <button
          type="button"
          className="tool more-formats-btn"
          title="More formats"
          aria-label="More formats"
          onClick={() => {}}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>123</span>
          <ChevronDown size={11} />
        </button>

        <span className="toolbar-divider" />

        <select
          className="toolbar-select font-family-select"
          aria-label="Font family"
          value={fontFamily}
          onChange={(e) => handleFontFamily(e.target.value)}
        >
          <option value="Arial">Arial</option>
          <option value="Roboto">Roboto</option>
          <option value="Calibri">Calibri</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Georgia">Georgia</option>
        </select>

        <span className="toolbar-divider" />

        <div className="font-size-stepper">
          <button
            type="button"
            className="stepper-btn"
            title="Decrease font size"
            aria-label="Decrease font size"
            onClick={() => handleFontSize(Math.max(6, fontSize - 1))}
          >
            <Minus size={12} />
          </button>
          <input
            className="font-size-input"
            aria-label="Font size"
            value={fontSize}
            onChange={(e) => handleFontSize(Number(e.target.value) || 10)}
          />
          <button
            type="button"
            className="stepper-btn"
            title="Increase font size"
            aria-label="Increase font size"
            onClick={() => handleFontSize(Math.min(72, fontSize + 1))}
          >
            <Plus size={12} />
          </button>
        </div>

        <span className="toolbar-divider" />

        <Tool label="Bold (Cmd+B)" active={isBold} onClick={toggleBold}>
          <Bold size={16} />
        </Tool>
        <Tool label="Italic (Cmd+I)" active={isItalic} onClick={toggleItalic}>
          <Italic size={16} />
        </Tool>
        <Tool
          label="Strikethrough (Alt+Shift+5)"
          active={isStrike}
          onClick={toggleStrike}
        >
          <Strikethrough size={16} />
        </Tool>
        <label className="color-tool" title="Text color">
          <span className="color-icon-wrapper">
            <span className="text-color-letter">A</span>
            <span
              className="color-bar"
              style={{ backgroundColor: textColor }}
            />
          </span>
          <input
            type="color"
            value={textColor}
            onChange={(e) => handleTextColor(e.target.value)}
          />
        </label>
        <label className="color-tool" title="Fill color">
          <span className="color-icon-wrapper">
            <PaintBucket size={16} />
            <span
              className="color-bar"
              style={{ backgroundColor: fillColor }}
            />
          </span>
          <input
            type="color"
            value={fillColor}
            onChange={(e) => handleFillColor(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="tool borders-btn"
          title="Borders"
          aria-label="Borders"
          onClick={applyBorders}
        >
          <Grid size={16} />
          <ChevronDown size={10} />
        </button>

        <button
          type="button"
          className="tool merge-btn"
          title="Merge cells"
          aria-label="Merge cells"
          onClick={mergeCells}
        >
          <Split size={16} />
          <ChevronDown size={10} />
        </button>

        <span className="toolbar-divider" />

        <button
          type="button"
          className="tool align-btn"
          title="Horizontal align"
          aria-label="Horizontal align"
          onClick={cycleHorizontalAlign}
        >
          <AlignLeft size={16} />
          <ChevronDown size={10} />
        </button>

        <button
          type="button"
          className="tool valign-btn"
          title="Vertical align"
          aria-label="Vertical align"
          onClick={cycleVerticalAlign}
        >
          <AlignVerticalSpaceAround size={16} />
          <ChevronDown size={10} />
        </button>

        <button
          type="button"
          className="tool wrap-btn"
          title="Text wrapping"
          aria-label="Text wrapping"
          onClick={toggleWrap}
        >
          <WrapText size={16} />
          <ChevronDown size={10} />
        </button>

        <span className="toolbar-divider" />

        <Tool label="Insert link (Cmd+K)" onClick={() => {}}>
          <Link size={16} />
        </Tool>
        <Tool label="Insert comment (Cmd+Option+M)" onClick={() => {}}>
          <MessageSquarePlus size={16} />
        </Tool>

        <button
          type="button"
          className="tool chart-btn"
          title="Insert chart"
          aria-label="Insert chart"
          disabled={!ready}
          onClick={() => startPanel("chart")}
        >
          <BarChart3 size={16} />
        </button>

        <button
          type="button"
          className={`tool filter-btn ${book.current?.getActiveSheet()?.getFilter() ? "active" : ""}`}
          title={
            book.current?.getActiveSheet()?.getFilter()
              ? "Remove filter"
              : "Create a filter"
          }
          aria-label={
            book.current?.getActiveSheet()?.getFilter()
              ? "Remove filter"
              : "Create a filter"
          }
          aria-pressed={!!book.current?.getActiveSheet()?.getFilter()}
          disabled={!ready}
          onClick={toggleFilter}
        >
          <Filter size={16} />
        </button>

        <button
          type="button"
          className="tool functions-btn"
          title="Functions"
          aria-label="Functions"
          onClick={() => {
            const r = book.current?.getActiveRange();
            if (r) {
              r.setValue("=SUM()");
              persist.current();
            }
          }}
        >
          <span
            style={{
              fontFamily: "serif",
              fontStyle: "italic",
              fontWeight: "bold",
              fontSize: 14,
            }}
          >
            ∑
          </span>
          <ChevronDown size={10} />
        </button>

        <button
          type="button"
          className="tool pivot-btn"
          title="Pivot table"
          aria-label="Pivot table"
          disabled={!ready}
          onClick={() => startPanel("pivot")}
        >
          <TableProperties size={16} />
        </button>

        <details className="sheet-analyses-dropdown">
          <summary>
            Charts & pivots ({items.charts.length + items.pivots.length})
          </summary>
          <div className="analysis-list">
            {!items.charts.length && !items.pivots.length ? (
              <p>Select a range, then insert a chart or pivot table.</p>
            ) : null}
            {items.charts.map((c) => (
              <div key={c.id}>
                <button onClick={() => startPanel("chart", c.id)}>
                  {c.title}
                  {c.invalid ? " · source missing" : ""}
                </button>
                <button
                  aria-label={`Delete ${c.title}`}
                  onClick={() => {
                    book.current
                      .getSheetBySheetId(c.sheetId)
                      ?.removeFloatDom(c.id);
                    content.current.charts = items.charts.filter(
                      (x) => x.id !== c.id,
                    );
                    charts.delete(c.id);
                    persist.current();
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {items.pivots.map((p) => (
              <div key={p.id}>
                <button onClick={() => startPanel("pivot", p.id)}>
                  {p.title}
                  {p.invalid ? " · source missing" : ""}
                </button>
                <button
                  title="Refresh pivot"
                  aria-label={`Refresh ${p.title}`}
                  onClick={() =>
                    void refreshPivot(p).catch((e) => onError(String(e)))
                  }
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  title="Make editable copy"
                  onClick={() => {
                    const s = book.current.getSheetBySheetId(p.targetSheetId);
                    if (!s) return;
                    const v = s.getDataRange().getValues();
                    const copy = book.current.create(
                      `Pivot copy ${Date.now().toString().slice(-5)}`,
                      Math.max(1000, v.length),
                      Math.max(26, v[0].length),
                    );
                    copy
                      .getRange(0, 0, v.length, v[0].length)
                      .setValues(
                        v.map((r: any[]) =>
                          r.map((v) =>
                            typeof v === "string" ? { v, t: 1 } : v,
                          ),
                        ),
                      );
                    book.current.setActiveSheet(copy.getSheetId());
                    persist.current();
                  }}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        </details>
      </div>
      <div className="sheet-host" ref={host} aria-label="Spreadsheet grid" />
      {panel ? (
        <aside className="analysis-panel">
          <header>
            <h2>
              {editing ? "Edit" : "Insert"}{" "}
              {panel === "chart" ? "chart" : "pivot table"}
            </h2>
            <button
              aria-label="Close analysis panel"
              onClick={() => setPanel(null)}
            >
              <X size={18} />
            </button>
          </header>
          <label>
            Title
            <input
              value={title}
              placeholder={
                panel === "chart" ? suggestedChartTitle(fields) : "Pivot table"
              }
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Source worksheet
            <select
              value={sourceSheet}
              onChange={(e) => setSourceSheet(e.target.value)}
            >
              {book.current?.getSheets().map((s: any) => (
                <option key={s.getSheetId()} value={s.getSheetId()}>
                  {s.getSheetName()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source range
            <input
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="A1:D20"
            />
          </label>
          <p className="hint">
            First row supplies field names. The full source range is used,
            including filtered rows.
          </p>
          {panel === "chart" ? (
            <label>
              Chart type
              <select
                value={chartType}
                onChange={(e) =>
                  setChartType(e.target.value as ChartDefinition["type"])
                }
              >
                <option value="bar">Column / bar</option>
                <option value="line">Line</option>
                <option value="pie">Pie</option>
                <option value="scatter">Scatter</option>
              </select>
            </label>
          ) : (
            <>
              <label>
                Rows
                <select
                  multiple
                  value={rowFields ? rowFields.split(",") : []}
                  onChange={(e) =>
                    setRowFields(
                      Array.from(e.target.selectedOptions)
                        .map((o) => o.value)
                        .join(","),
                    )
                  }
                >
                  {fields.map((v, i) => (
                    <option key={i} value={i}>
                      {String(v ?? "Blank field")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Columns (optional)
                <select
                  multiple
                  value={columnFields ? columnFields.split(",") : []}
                  onChange={(e) =>
                    setColumnFields(
                      Array.from(e.target.selectedOptions)
                        .map((o) => o.value)
                        .join(","),
                    )
                  }
                >
                  {fields.map((v, i) => (
                    <option key={i} value={i}>
                      {String(v ?? "Blank field")}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Use Command / Ctrl to select several fields, or to clear a
                selection.
              </p>
              <label>
                Value field
                <select
                  value={valueField}
                  onChange={(e) => setValueField(+e.target.value)}
                >
                  {fields.map((v, i) => (
                    <option key={i} value={i}>
                      {String(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Summarize by
                <select
                  value={aggregate}
                  onChange={(e) =>
                    setAggregate(e.target.value as PivotDefinition["aggregate"])
                  }
                >
                  {["SUM", "COUNT", "AVERAGE", "MIN", "MAX"].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label>
                Filter field
                <select
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(+e.target.value)}
                >
                  <option value={-1}>No filter</option>
                  {fields.map((v, i) => (
                    <option key={i} value={i}>
                      {String(v)}
                    </option>
                  ))}
                </select>
              </label>
              {filterColumn >= 0 ? (
                <label>
                  Equals
                  <input
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                  />
                </label>
              ) : null}
              <p className="hint">
                Pivot results appear in a protected worksheet. Refresh after
                source edits, or make an editable copy.
              </p>
            </>
          )}
          <button className="primary" onClick={() => void submit()}>
            {editing ? "Update" : "Create"} {panel}
          </button>
        </aside>
      ) : null}
    </div>
  );
}
