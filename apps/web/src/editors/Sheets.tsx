import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createUniver,
  defaultTheme,
  darkBlueTheme,
  LocaleType,
  LifecycleStages,
  mergeLocales,
  numfmt,
  UserManagerService,
  type IWorkbookData,
} from "@univerjs/presets";
import {
  IDescriptionService,
  IEditorService,
  IShortcutService,
  KeyCode,
  SheetsSelectionsService,
  UniverSheetsCorePreset,
} from "@univerjs/preset-sheets-core";
import CoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsDrawingPreset } from "@univerjs/preset-sheets-drawing";
import DrawingEnUS from "@univerjs/preset-sheets-drawing/locales/en-US";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import FilterEnUS from "@univerjs/preset-sheets-filter/locales/en-US";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import SortEnUS from "@univerjs/preset-sheets-sort/locales/en-US";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import FindEnUS from "@univerjs/preset-sheets-find-replace/locales/en-US";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import ValidationEnUS from "@univerjs/preset-sheets-data-validation/locales/en-US";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import ConditionalEnUS from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import { UniverSheetsThreadCommentPreset } from "@univerjs/preset-sheets-thread-comment";
import CommentEnUS from "@univerjs/preset-sheets-thread-comment/locales/en-US";
import "@univerjs/preset-sheets-thread-comment/lib/index.css";
import {
  SheetsNotePopupService,
  UniverSheetsNotePreset,
} from "@univerjs/preset-sheets-note";
import NoteEnUS from "@univerjs/preset-sheets-note/locales/en-US";
import "@univerjs/preset-sheets-note/lib/index.css";
import SheetCleanup from "./sheet-cleanup-ui";
import { SheetSpelling } from "./grid-spelling-ui";
import SheetRowGroups, { type SheetRowGroupsHandle } from "./sheet-row-groups-ui";
import SheetFeatures from "./sheet-features";
import SheetDropdowns, { type SheetDropdownHandle } from "./sheet-dropdown-panel";
import SheetLinks, { type SheetLinkHandle } from "./sheet-links";
import {
  guardFormulaSuggestions,
  rankFormulaSuggestions,
} from "./formula-suggestions";
import { useSheetFunctions } from "./function-help-ui";
import SortRangeDialog from "./SortRangeDialog";
import NamedRanges, { type NamedRangesHandle } from "./named-ranges-ui";
import { useToolbarOverflow } from "./toolbar-overflow";
import {
  attachSheetViewLock,
  blocksSheetEdit,
  filterViewChoices,
  valueFilterCriteria,
  watchFormulaBar,
  type SheetAccess,
} from "./view-lock";
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
  Cell,
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
  EllipsisVertical,
  Lock,
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
import {
  copySheetName,
  defaultValueField,
  pivotCells,
  pivotResult,
  shiftRange,
  uniqueSheetName,
  valueFormat,
  valueTicks,
  type CellValue,
} from "../analysis";
import { sortBody, type GridRange, type SortRule } from "../sort-range";
import {
  numberFormatsByGroup,
  applyNamedFormat,
  numberFormatById,
} from "../formats";
import { exportBinary, exportText, printDocument } from "../storage";
import { placeSheetImage, readImageFile } from "../templates/sheet-image";
import { Tool, type EditorActions, type SheetView } from "../ui";
import { MenuSearchPill } from "../command-palette";
import "../excel-overflow";
import "../excel-number-display";
import "../excel-wrap";
import "../excel-cell";
import { resolveExcelColumnWidths } from "../excel-layout";
import { useTheme } from "../theme";
import { currentAuthor, onAuthorChange } from "../identity";
import { useMode } from "../mode";
import { getSession } from "../node-client";

const FORMULA_BAR_KEY = "suiteleaf_sheets_formula_bar";
/** Formula bar visibility is a per-person preference, not part of the workbook. */
function formulaBarVisible() {
  try {
    return localStorage.getItem(FORMULA_BAR_KEY) !== "hidden";
  } catch {
    return true;
  }
}
function setFormulaBarVisible(visible: boolean) {
  try {
    if (visible) localStorage.removeItem(FORMULA_BAR_KEY);
    else localStorage.setItem(FORMULA_BAR_KEY, "hidden");
  } catch {
    // ignore localStorage failures
  }
}

const shortcut = (key: string) =>
  `${navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}${key}`;
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
  if (chart.excel?.biff)
    return <BinaryLineChart chart={chart} series={series} />;
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
function BinaryLineChart({
  chart,
  series,
}: {
  chart: ChartDefinition;
  series: CellValue[][];
}) {
  const meta = chart.excel!.biff!,
    definitions = chart.excel!.series,
    w = chart.width,
    h = chart.height;
  const count = Math.max(
    1,
    meta.categories.length,
    ...series.map((s) => s.length),
  );
  const left = 140,
    right = w - 90,
    top = 70,
    bottom = h - (meta.dataTable ? (definitions.length + 1) * 19 + 18 : 72);
  const scales = meta.axes.map((axis, index) => {
    const values = series.flatMap((s, i) =>
      (definitions[i].axis ?? 0) === index
        ? s.filter((v): v is number => typeof v === "number")
        : [],
    );
    const peak = Math.max(0, ...values),
      unit = 10 ** Math.floor(Math.log10(peak || 1));
    return {
      min: axis.min ?? 0,
      max: axis.max ?? Math.ceil(peak / unit) * unit,
      step: axis.step ?? unit,
    };
  });
  const px = (i: number) => left + ((right - left) * (i + 0.5)) / count;
  const py = (v: number, axis: number) => {
    const s = scales[axis] ?? scales[0];
    return bottom - ((bottom - top) * (v - s.min)) / (s.max - s.min || 1);
  };
  const fmt = (value: CellValue, format: string | undefined) =>
    typeof value === "number"
      ? numfmt.format(format ?? "#,##0", value)
      : String(value ?? "");
  const marker = (
    x: number,
    y: number,
    color: string,
    kind: number,
    key: number,
  ) =>
    kind === 3 ? (
      <path key={key} d={`M${x} ${y - 4}l4 8h-8Z`} fill={color} />
    ) : kind === 8 ? (
      <circle key={key} cx={x} cy={y} r={4} fill={color} />
    ) : kind === 4 ? (
      <rect key={key} x={x - 3} y={y - 3} width={6} height={6} fill={color} />
    ) : kind ? (
      <path key={key} d={`M${x} ${y - 4}l4 4-4 4-4-4Z`} fill={color} />
    ) : null;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      aria-label={chart.title}
      style={{ background: "white", fontSize: 11, fontFamily: "sans-serif" }}
    >
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        fill="white"
        stroke="#808080"
      />
      <text
        x={w / 2}
        y={30}
        textAnchor="middle"
        fontSize={19}
        fontWeight="bold"
      >
        {chart.title}
      </text>
      {scales.map((s, axis) => {
        const format = definitions.find(
          (d) => (d.axis ?? 0) === axis,
        )?.numberFormat;
        const ticks = Array.from(
          {
            length: Math.min(
              40,
              Math.floor((s.max - s.min) / s.step + 0.001) + 1,
            ),
          },
          (_, i) => s.min + i * s.step,
        );
        return (
          <g key={axis}>
            <text
              x={axis ? right : left}
              y={52}
              textAnchor={axis ? "end" : "start"}
            >
              {meta.axisTitles[axis]}
            </text>
            <line
              x1={axis ? right : left}
              x2={axis ? right : left}
              y1={top}
              y2={bottom}
              stroke="#777"
            />
            {ticks.map((v, i) => (
              <g key={i}>
                {!axis && (
                  <line
                    x1={left}
                    x2={right}
                    y1={py(v, axis)}
                    y2={py(v, axis)}
                    stroke="#888"
                  />
                )}
                <text
                  x={axis ? right + 12 : left - 12}
                  y={py(v, axis) + 4}
                  textAnchor={axis ? "start" : "end"}
                >
                  {fmt(v, format)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {series.map((s, i) => {
        const d = definitions[i],
          points = s.flatMap((v, j) =>
            typeof v === "number" ? [{ x: px(j), y: py(v, d.axis ?? 0) }] : [],
          );
        return (
          <g key={i}>
            <polyline
              fill="none"
              stroke={d.color}
              strokeWidth={2}
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {points.map((p, j) => marker(p.x, p.y, d.color, d.marker ?? 0, j))}
          </g>
        );
      })}
      {Array.from({ length: count }, (_, i) => (
        <text key={i} x={px(i)} y={bottom + 15} textAnchor="middle">
          {meta.categories[i] ?? String(i + 1)}
        </text>
      ))}
      {meta.dataTable &&
        definitions.map((d, i) => (
          <g key={i}>
            <line
              x1={5}
              x2={right}
              y1={bottom + (i + 1) * 19}
              y2={bottom + (i + 1) * 19}
              stroke="#888"
            />
            <line
              x1={12}
              x2={35}
              y1={bottom + (i + 1) * 19 + 10}
              y2={bottom + (i + 1) * 19 + 10}
              stroke={d.color}
              strokeWidth={2}
            />
            <text x={40} y={bottom + (i + 1) * 19 + 14} fontSize={10}>
              {d.name}
            </text>
            {Array.from({ length: count }, (_, j) => (
              <g key={j}>
                <line
                  x1={left + ((right - left) * j) / count}
                  x2={left + ((right - left) * j) / count}
                  y1={bottom}
                  y2={bottom + (definitions.length + 1) * 19}
                  stroke="#888"
                />
                <text
                  x={px(j)}
                  y={bottom + (i + 1) * 19 + 14}
                  textAnchor="middle"
                  fontSize={10}
                >
                  {fmt(series[i]?.[j] ?? null, d.numberFormat)}
                </text>
              </g>
            ))}
          </g>
        ))}
      {!meta.dataTable &&
        definitions.map((d, i) => (
          <g
            key={i}
            transform={`translate(${left + (i % 3) * 290},${h - 40 + Math.floor(i / 3) * 15})`}
          >
            <line x2={20} stroke={d.color} strokeWidth={2} />
            <text x={26} y={4}>
              {d.name}
            </text>
          </g>
        ))}
      {meta.annotations.map((text, i) => {
        const chars = [...text],
          lines = Array.from({ length: Math.ceil(chars.length / 24) }, (_, j) =>
            chars.slice(j * 24, (j + 1) * 24).join(""),
          );
        const x = right - 260,
          y = top + 25 + i * 160;
        return (
          <g key={i}>
            <rect
              x={x - 6}
              y={y - 15}
              width={270}
              height={lines.length * 15 + 15}
              fill="white"
              stroke="#333"
            />
            <text x={x} y={y}>
              {lines.map((line, j) => (
                <tspan key={j} x={x} dy={j ? 15 : 0}>
                  {line}
                </tspan>
              ))}
            </text>
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
const rowVisibilityMutation =
  /^sheet\.mutation\.(set-filter-criteria|set-filter-range|re-calc-filter|remove-filter|set-row-hidden|set-row-visible)$/;
/**
 * Univer's filter list toggles a value only from its small checkbox. As in Sheets and
 * Excel, clicking the value's label or count toggles it too. Rows with an expand arrow
 * (date groups) keep expanding on a label click.
 */
function toggleFilterValueFromLabel(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('[data-u-comp="sheets-filter-panel"]')) return;
  if (target.closest('label[data-u-comp="checkbox"], a')) return;
  const row = target.closest('div:has(> label[data-u-comp="checkbox"])');
  if (!row || row.firstElementChild?.tagName !== "LABEL") return;
  row.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
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
  if (c.type === "line" && c.excel && !c.invalid)
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
      <div className="suiteleaf-chart" data-chart-id={c.id}>
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
  const colors = [
    "#4F81BD",
    "#C0504D",
    "#9BBB59",
    "#8064A2",
    "#4BACC6",
    "#F79646",
    "#2C4D75",
    "#267C60",
  ];
  const ticks = valueTicks(values.slice(1).flatMap((r) => r.slice(1)));
  const valueAxis = {
    tickFormatter: formatAxis,
    ...(ticks && { ticks, domain: [ticks[0], ticks.at(-1)!] }),
    width: Math.max(
      36,
      12 + 7 * Math.max(0, ...(ticks ?? []).map((t) => formatAxis(t).length)),
    ),
  };
  return (
    <div
      className="suiteleaf-chart"
      aria-label={`Chart: ${c.title}`}
      data-chart-id={c.id}
    >
      <strong>{c.title}</strong>
      <ResponsiveContainer width="100%" height="100%">
        {c.type === "pie" ? (
          <PieChart>
            <Pie
              data={rows}
              dataKey="v0"
              nameKey="label"
              isAnimationActive={false}
              label={({ value }: { value?: any }) => formatValue(value, 1)}
            >
              {rows.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colors[index % colors.length]}
                />
              ))}
            </Pie>
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
                offset: 0,
              }}
              height={44}
            />
            <YAxis {...valueAxis} />
            <Tooltip formatter={formatTooltip} />
            <Legend
              itemSorter={null}
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 8 }}
            />
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
                offset: 0,
              }}
              height={44}
            />
            <YAxis {...valueAxis} />
            <Tooltip formatter={formatTooltip} />
            <Legend
              itemSorter={null}
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 8 }}
            />
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
  readOnly = false,
  canComment = false,
}: {
  file: SheetFile;
  onChange: (content: SheetFile["content"]) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
  /** Viewers and commenters can read the grid, but not change cells. */
  readOnly?: boolean;
  /** Commenters may reply. Replies stay on this screen; saves are already skipped. */
  canComment?: boolean;
}) {
  const { isDark } = useTheme();
  const cluster = useMode().mode.kind === "cluster";
  const host = useRef<HTMLDivElement>(null),
    api = useRef<any>(null),
    book = useRef<any>(null),
    injectorRef = useRef<any>(null),
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
    [isWrap, setIsWrap] = useState(false),
    [sorting, setSorting] = useState<{
      range: GridRange;
      values: CellValue[][];
    } | null>(null),
    [notice, setNotice] = useState(""),
    [filterView, setFilterView] = useState<{
      header: string;
      value: string;
      hidden: number;
    } | null>(null);
  const pending = useRef(false);
  const tabSettings = useRef<{ openTabs: () => void }>(null);
  const dropdowns = useRef<SheetDropdownHandle>(null);
  const links = useRef<SheetLinkHandle>(null);
  const dropdownEngine = useRef<{ api: any; injector: any } | null>(null);
  const cleanup = useRef<{ trim: () => void; duplicates: () => void; split: () => void }>(null);
  const spelling = useRef<{ open: () => void }>(null);
  const names = useRef<NamedRangesHandle>(null);
  const rowGroups = useRef<SheetRowGroupsHandle>(null);
  const engine = useRef<any>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const moreTools = useToolbarOverflow(
    toolbar,
    '[aria-label^="Insert comment"], .chart-btn, .filter-btn, .functions-btn, .pivot-btn, .sheet-analyses-dropdown',
  );
  const functionActions = useRef<{
    insertFunction: (name: string) => void;
    autoSum: () => void;
  }>({
    insertFunction: () => {},
    autoSum: () => {},
  });
  const persist = useRef<() => void>(() => {}),
    refreshCharts = useRef<() => void>(() => {}),
    syncTextStyle = useRef<() => void>(() => {}),
    editChart = useRef<(id: string) => void>(() => {}),
    refreshPivots = useRef<(sheetIds: Set<string>) => void>(() => {}),
    insertImage = useRef<(src: string) => Promise<void>>(async () => {});
  /** Last result written per pivot, so unchanged recalculations leave the sheet alone. */
  const pivotWrites = useRef(new Map<string, string>()),
    writingPivot = useRef(false),
    pivotErrors = useRef(new Map<string, string>()),
    valueChosen = useRef(false);
  const startingUp = useRef(true);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const canCommentRef = useRef(canComment);
  canCommentRef.current = canComment;
  const access = (): SheetAccess =>
    readOnlyRef.current ? (canCommentRef.current ? "comment" : "view") : "edit";
  // Univer focuses its hidden cell editor while it starts, which would send
  // keystrokes meant for the file title (or another field) into the grid.
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let touched = false;
    const touch = () => {
      touched = true;
    };
    const keep = (e: FocusEvent) => {
      const from = e.relatedTarget,
        to = e.target;
      if (
        startingUp.current &&
        !touched &&
        from instanceof HTMLElement &&
        from.isConnected &&
        !container.contains(from) &&
        from.matches("input, textarea, select, [contenteditable='true']") &&
        to instanceof HTMLElement &&
        !!to.closest('[data-u-comp="editor"]')
      )
        from.focus();
    };
    container.addEventListener("pointerdown", touch, true);
    document.addEventListener("focusin", keep, true);
    return () => {
      container.removeEventListener("pointerdown", touch, true);
      document.removeEventListener("focusin", keep, true);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const settled = setTimeout(() => (startingUp.current = false), 1000);
    return () => clearTimeout(settled);
  }, [ready]);
  const readRange = (r: SourceRange): CellValue[][] => {
    const s = book.current?.getSheetBySheetId(r.sheetId);
    if (!s || r.endRow >= s.getMaxRows() || r.endColumn >= s.getMaxColumns())
      throw new Error("Source range is unavailable.");
    return s.getRange(rangeLabel(r)).getRawValues();
  };
  useEffect(() => {
    // Capture phase: the filter list's label stops click propagation in React.
    document.addEventListener("click", toggleFilterValueFromLabel, true);
    return () =>
      document.removeEventListener("click", toggleFilterValueFromLabel, true);
  }, []);
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
    let detachView = () => {};
    const initialize = () => {
      // Register before Univer so a keystroke never opens the cell editor.
      const stopViewLock = attachSheetViewLock(
        () => readOnlyRef.current,
        access,
      );
      const stopFormulaLock = watchFormulaBar(container, () => readOnlyRef.current);
      const openFromHeader = () => {
        void univerAPI.executeCommand("sheet.operation.toggle-comment-panel");
      };
      window.addEventListener("suiteleaf:open-sheet-comments", openFromHeader);
      detachView = () => {
        stopViewLock();
        stopFormulaLock();
        window.removeEventListener("suiteleaf:open-sheet-comments", openFromHeader);
      };
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
            ValidationEnUS,
            ConditionalEnUS,
            CommentEnUS,
            NoteEnUS,
            // mergeLocales only merges top-level keys, so keep the rest of Univer's ui strings.
            {
              ui: {
                ...CoreEnUS.ui,
                clipboard: {
                  ...CoreEnUS.ui.clipboard,
                  authentication: {
                    title: "Clipboard access blocked",
                    content: `Use ${shortcut("C")}, ${shortcut("X")} and ${shortcut("V")} to copy, cut and paste.`,
                  },
                },
              },
            },
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
          UniverSheetsDataValidationPreset(),
          UniverSheetsConditionalFormattingPreset(),
          UniverSheetsThreadCommentPreset(),
          UniverSheetsNotePreset(),
        ],
      });
      const injector = univer.__getInjector();
      engine.current = injector;
      injectorRef.current = injector;
      const stopSuggestionGuard = guardFormulaSuggestions(
        injector.get(IShortcutService),
        injector.get(IEditorService),
        [KeyCode.ENTER, KeyCode.TAB],
      );
      partialCleanup = () => {
        stopSuggestionGuard();
        clearTimeout(timer);
        api.current = null;
        book.current = null;
        engine.current = null;
        injectorRef.current = null;
        persist.current = () => {};
        refreshCharts.current = () => {};
        refreshPivots.current = () => {};
        for (const c of sessionContent.charts) charts.delete(c.id);
        univer.dispose();
      };
      api.current = univerAPI;
      dropdownEngine.current = { api: univerAPI, injector };
      if (!formulaBarVisible())
        univerAPI.setUIVisible(univerAPI.Enum.BuiltInUIPart.HEADER, false);
      univerAPI.registerComponent("suiteleaf-chart", EmbeddedChart);
      const users = injector.get(UserManagerService);
      const author = () => {
        const a = currentAuthor(cluster ? getSession()?.user : null);
        // Univer's local permissions only let user IDs starting with "Owner" edit.
        return { ...a, userID: `Owner_${a.id}` };
      };
      let me = author();
      const signIn = () =>
        users.setCurrentUser({ userID: me.userID, name: me.name, avatar: "" });
      signIn();
      const stopAuthor = onAuthorChange(() => {
        me = author();
        signIn();
      });
      const releaseEngine = partialCleanup;
      partialCleanup = () => {
        stopViewLock();
        stopFormulaLock();
        releaseEngine?.();
      };
      const signComments = univerAPI.addEvent(
        univerAPI.Event.BeforeCommandExecute,
        (event) => {
          if (blocksSheetEdit(event.id, access())) event.cancel = true;
          const { id, params } = event;
          const comment = (params as any)?.comment;
          if (
            id === "thread-comment.command.add-comment" &&
            comment?.personId === me.userID &&
            me.signature &&
            !comment.authorName
          )
            comment.authorName = me.signature;
        },
      );
      const workbook = univerAPI.createWorkbook(
        content.current.workbook as unknown as IWorkbookData,
      );
      insertImage.current = async (src) => {
        await placeSheetImage(
          workbook.getActiveSheet(),
          univerAPI.Enum.ImageSourceType.BASE64,
          content.current,
          src,
        );
        pending.current = true;
        persist.current();
      };
      book.current = workbook;
      rankFormulaSuggestions(injector.get(IDescriptionService));
      // Authors from other devices are unknown here; without a profile Univer
      // hides their name and the reply-to button.
      for (const thread of workbook.getComments())
        for (const comment of [thread, ...(thread.getReplies() ?? [])]) {
          const { personId, authorName } = comment.getCommentData();
          if (personId && personId !== me.userID && !users.getUser(personId))
            users.addUser({
              userID: personId,
              name: authorName || "Anonymous",
              avatar: "",
            });
        }
      // Univer closes an open note only when a selection move ends, not when the
      // name box or a command sets the selection.
      const notePopups = injector.get(SheetsNotePopupService);
      const closeNoteOnMove = injector
        .get(SheetsSelectionsService)
        .selectionChanged$.subscribe((selections) => {
          const popup = notePopups.activePopup,
            range = selections?.[0]?.range;
          if (
            popup &&
            range &&
            !(
              popup.subUnitId === workbook.getActiveSheet().getSheetId() &&
              range.startRow === popup.row &&
              range.startColumn === popup.col
            )
          )
            notePopups.hidePopup(true);
        });
      // Excel stores a cached result for every formula cell but recalculates formulas on
      // open. An imported snapshot can carry a stale or missing cached value that would
      // display 0 while the formula resolves to a real number, so force one explicit full
      // recalculation on import: this is an external data change that produced no dirty
      // command, which is exactly when executeCalculation() applies.
      univerAPI.getFormula().executeCalculation();
      void univerAPI
        .getFormula()
        .onCalculationResultApplied(5000)
        .catch(() => {});
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
          let origin: { left: number; top: number } | undefined;
          try {
            origin = JSON.parse(sheet.getRange("A1").getCellRect().toJSON());
          } catch {
            // The canvas for an inactive sheet may not exist until activation.
            if (c.excel) continue;
          }
          const gridX = c.excel && origin ? origin.left : 0;
          const gridY = c.excel && origin ? origin.top : 0;
          if (c.excel && origin && !chartOrigins.has(c.id))
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
        // A viewer filter or a comment reply stays on this screen. The file is unchanged.
        if (readOnlyRef.current) return;
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
      syncTextStyle.current = () => {
        const style = workbook.getActiveRange()?.getCellStyleData();
        setIsBold(style?.bl === 1);
        setIsItalic(style?.it === 1);
        setIsStrike(style?.st?.s === 1);
      };
      const changedSheets = new Set<string>();
      const publishValue = () => {
        try {
          const value = workbook.getActiveRange()?.getValue();
          container.dataset.activeValue = value == null ? "" : String(value);
        } catch {
          container.dataset.activeValue = "";
        }
      };
      publishValue();
      const listener = workbook.onCommandExecuted((command: any) => {
        if (
          !disposed &&
          (command.id === "sheet.operation.set-selections" ||
            command.id === "sheet.mutation.set-range-values")
        ) {
          syncTextStyle.current();
          publishValue();
        }
        if (busy || disposed || !command.id.includes("mutation")) return;
        pending.current = true;
        const p = command.params ?? {};
        // A pivot's own output never triggers further pivot refreshes, so pivots of pivots cannot loop.
        if (!writingPivot.current) {
          if (typeof p.subUnitId === "string") changedSheets.add(p.subUnitId);
          for (const unit of Object.values(p.unitData ?? {}))
            for (const id of Object.keys(unit ?? {})) changedSheets.add(id);
        }
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
          if (changedSheets.size) {
            refreshPivots.current(new Set(changedSheets));
            changedSheets.clear();
          }
        }, 180);
      });
      // Univer's status bar only recalculates when the selection changes, so a filter
      // that hides or reveals rows under the selection would leave Sum and Average
      // counting rows that are no longer visible.
      const selections = univer.__getInjector().get(SheetsSelectionsService);
      const rowsShown = workbook.onCommandExecuted((command: any) => {
        if (!rowVisibilityMutation.test(command.id)) return;
        const current = selections.getCurrentSelections();
        if (current.length) selections.setSelections([...current]);
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
      let permissionsReady = false;
      const signalReady = () => {
        if (
          !disposed &&
          permissionsReady &&
          univerAPI.getCurrentLifecycleStage() >= LifecycleStages.Steady
        )
          setReady(true);
      };
      const lifecycleReady = univerAPI.addEvent(
        univerAPI.Event.LifeCycleChanged,
        signalReady,
      );
      // Local permissions need their view/manage points restored without a server.
      void (async () => {
        for (const sheet of workbook.getSheets()) {
          const permission = sheet.getWorksheetPermission();
          if (sheet.getCustomMetadata()?.suiteleafProtection?.sheet) {
            if (!permission.isProtected()) await permission.protect();
            await permission.setReadOnly();
          }
          const rules = await permission.listRangeProtectionRules({
            ignoreCollaborators: true,
          });
          for (const rule of rules) {
            await rule.setPoint(univerAPI.Enum.RangePermissionPoint.View, true);
            await rule.setPoint(
              univerAPI.Enum.RangePermissionPoint.Delete,
              true,
            );
            await rule.setPoint(
              univerAPI.Enum.RangePermissionPoint.ManageCollaborator,
              true,
            );
            await rule.setPoint(
              univerAPI.Enum.RangePermissionPoint.Edit,
              false,
            );
          }
        }
        permissionsReady = true;
        signalReady();
      })().catch((cause) => {
        if (!disposed)
          error.current(cause instanceof Error ? cause.message : String(cause));
      });
      return () => {
        disposed = true;
        clearTimeout(timer);
        clearTimeout(chartHydrationTimer);
        listener.dispose();
        rowsShown.dispose();
        lifecycleReady.dispose();
        removed.dispose();
        activeSheetChanged.dispose();
        stopAuthor();
        signComments.dispose();
        stopViewLock();
        stopFormulaLock();
        closeNoteOnMove.unsubscribe();
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
      detachView();
      cleanup?.();
    };
    // The workspace mounts a fresh editor per file. Changes must not recreate the engine.
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!api.current) return;
    try {
      api.current.toggleDarkMode?.(isDark);
      api.current.setTheme?.(isDark ? darkBlueTheme : defaultTheme);
    } catch {}
  }, [isDark]);
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
  const clipboard = async (action: "cut" | "copy" | "paste") => {
    let done = false;
    try {
      done = !!(await api.current?.executeCommand(`univer.command.${action}`));
    } catch {}
    if (done) return;
    const key = shortcut({ cut: "X", copy: "C", paste: "V" }[action]);
    setNotice(
      `Your browser doesn't let the Edit menu ${action} here. Use ${key} to ${action}.`,
    );
  };
  const deleteValues = () => {
    const ranges =
      book.current?.getActiveSheet()?.getSelection()?.getActiveRangeList() ??
      [];
    try {
      for (const r of ranges) r.clearContent();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    persist.current();
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
    if (readOnlyRef.current) return;
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
  const sheetRows = (): string[][] => {
    const sheet = book.current?.getActiveSheet();
    if (!sheet) return [];
    return (sheet.getDataRange().getDisplayValues() as unknown[][]).map((row) =>
      row.map((cell) => String(cell ?? "")),
    );
  };
  const createFilterView = () => {
    if (!readOnlyRef.current) return;
    try {
      const sheet = book.current?.getActiveSheet();
      if (!sheet) return;
      const range = sheet.getDataRange();
      if (!range.getFilter() && !range.createFilter())
        throw new Error("This sheet has no header row to filter.");
      setFilterView({ header: "", value: "", hidden: 0 });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const applyFilterView = (value: string) => {
    if (!readOnlyRef.current) return;
    try {
      const sheet = book.current?.getActiveSheet();
      if (!sheet) return;
      const choice = filterViewChoices(sheetRows()).find(
        (item) => item.value === value,
      );
      if (!choice) return;
      const range = sheet.getDataRange();
      const filter = range.getFilter() ?? range.createFilter();
      if (!filter) throw new Error("This sheet has no header row to filter.");
      const criteria = valueFilterCriteria(
        choice.column,
        range.getRange().startColumn,
        value,
      );
      filter.setColumnFilterCriteria(criteria.column, criteria.criteria);
      setFilterView({
        header: choice.header,
        value,
        hidden: filter.getFilteredOutRows().length,
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const clearFilterView = () => {
    try {
      book.current?.getActiveSheet()?.getFilter()?.remove();
    } catch {
      /* The filter is already gone. */
    }
    setFilterView(null);
  };
  const openSortRange = () => {
    const sheet = book.current?.getActiveSheet();
    if (!sheet) return;
    const selected = book.current?.getActiveRange();
    const target =
      selected && selected.getRange().endRow > selected.getRange().startRow
        ? selected
        : sheet.getDataRange();
    setSorting({ range: target.getRange(), values: target.getValues() });
  };
  const sortRange = (rules: SortRule[], hasHeader: boolean) => {
    try {
      const body = sortBody(sorting!.range, hasHeader);
      book.current
        .getActiveSheet()
        .getRange(
          body.startRow,
          body.startColumn,
          body.endRow - body.startRow + 1,
          body.endColumn - body.startColumn + 1,
        )
        .sort(rules);
      persist.current();
      setSorting(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const view = (): SheetView => {
    const sheet = book.current?.getActiveSheet();
    const freeze = sheet?.getFreeze();
    const cell = book.current?.getActiveCell();
    const frozenRows = freeze?.ySplit ? freeze.startRow : 0;
    const frozenColumns = freeze?.xSplit ? freeze.startColumn : 0;
    // The main viewport excludes frozen panes; keep at least two of its rows/columns scrollable.
    const visible = sheet?.getVisibleRange();
    return {
      frozenRows,
      frozenColumns,
      row: (cell?.getRow() ?? 0) + 1,
      column: (cell?.getColumn() ?? 0) + 1,
      maxFrozenRows: visible
        ? frozenRows + visible.endRow - visible.startRow - 1
        : 0,
      maxFrozenColumns: visible
        ? frozenColumns + visible.endColumn - visible.startColumn - 1
        : 0,
      gridlines: !sheet?.hasHiddenGridLines(),
      formulaBar: formulaBarVisible(),
    };
  };
  const setFrozen = (axis: "rows" | "columns", count: number) => {
    const sheet = book.current?.getActiveSheet();
    if (!sheet) return;
    if (axis === "rows") sheet.setFrozenRows(count);
    else sheet.setFrozenColumns(count);
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
        if (format === "xlsx") {
          persist.current();
          const { exportXlsx } = await import("@suiteleaf/core/xlsx-export");
          await exportBinary(
            filename(file.title, "xlsx"),
            await exportXlsx({ content: content.current }),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          return;
        }
        const s = book.current.getActiveSheet();
        const values = s.getDataRange().getRawValues();
        await exportText(
          filename(file.title, format),
          Papa.unparse(values, {
            delimiter: format === "tsv" ? "\t" : ",",
            escapeFormulae: true,
          }),
          format === "tsv" ? "text/tab-separated-values" : "text/csv",
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
        insertImage: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept =
            "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg";
          input.onchange = () => {
            const chosen = input.files?.[0];
            if (!chosen) return;
            void readImageFile(chosen)
              .then((src) => insertImage.current(src))
              .catch((e: unknown) =>
                error.current(e instanceof Error ? e.message : String(e)),
              );
          };
          input.click();
        },
        dataValidation: () => {
          if (dropdowns.current?.openExisting()) return;
          void api.current?.executeCommand(
            "data-validation.operation.open-validation-panel",
            {},
          );
        },
        conditionalFormatting: () =>
          void api.current?.executeCommand(
            "sheet.operation.open.conditional.formatting.panel",
            { value: 2 },
          ),
        openComments: () =>
          void api.current?.executeCommand(
            "sheet.operation.toggle-comment-panel",
            {},
          ),
        insertComment: () =>
          void api.current?.executeCommand(
            "sheet.operation.show-comment-modal",
            {},
          ),
        tabsProtection: () => tabSettings.current?.openTabs(),
        insertCheckbox: () => {
          const range = book.current?.getActiveRange();
          if (range) {
            range.setDataValidation(
              api.current
                .newDataValidation()
                .requireCheckbox("TRUE", "FALSE")
                .build(),
            );
            const { startRow, startColumn } = range.getRange();
            const unticked: Record<number, Record<number, { v: boolean }>> =
              {};
            range.getCellDatas().forEach((row: any[], r: number) =>
              row.forEach((cell, c) => {
                if (!cell?.f && !cell?.p && (cell?.v ?? "") === "")
                  (unticked[startRow + r] ??= {})[startColumn + c] = {
                    v: false,
                  };
              }),
            );
            void (
              Object.keys(unticked).length
                ? api.current.executeCommand("sheet.command.set-range-values", {
                    value: unticked,
                  })
                : Promise.resolve()
            ).then(() => persist.current());
          }
        },
        insertDropdown: () => dropdowns.current?.openNew(),
        insertLink: () => links.current?.open(),
        undo: () => void api.current?.undo(),
        redo: () => void api.current?.redo(),
        cut: () => void clipboard("cut"),
        copy: () => void clipboard("copy"),
        paste: () => void clipboard("paste"),
        deleteValues,
        insertChart: () => startPanel("chart"),
        insertPivot: () => startPanel("pivot"),
        insertFunction: (name: string) => functionActions.current.insertFunction(name),
        toggleFilter,
        createFilterView,
        applyFilterView,
        clearFilterView,
        filterViewChoices: () => {
          if (!readOnlyRef.current) return [];
          try {
            return filterViewChoices(sheetRows());
          } catch {
            return [];
          }
        },
        sortRange: openSortRange,
        namedRanges: () => names.current?.open(),
        groupRows: () => rowGroups.current?.groupRows(),
        trimWhitespace: () => cleanup.current?.trim(),
        removeDuplicates: () => cleanup.current?.duplicates(),
        splitTextToColumns: () => cleanup.current?.split(),
        hasFilter: () => !!book.current?.getActiveSheet()?.getFilter(),
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
        view,
        freezeRows: (count) => setFrozen("rows", count),
        freezeColumns: (count) => setFrozen("columns", count),
        showGridlines: (visible) =>
          void book.current?.getActiveSheet()?.setHiddenGridlines(!visible),
        showFormulaBar: (visible) => {
          setFormulaBarVisible(visible);
          api.current?.setUIVisible(
            api.current.Enum.BuiltInUIPart.HEADER,
            visible,
          );
        },
        openSpelling: () => spelling.current?.open(),
      },
    });
  }, [ready, file.title, onActions]);
  const startPanel = (type: "chart" | "pivot", id?: string) => {
    moreTools.setOpen(false);
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
      valueChosen.current = !!p;
      setRowFields(p?.rows.join(",") ?? "0");
      setColumnFields(p?.columns.join(",") ?? "");
      setValueField(p?.value ?? 1);
      setAggregate(p?.aggregate ?? "SUM");
      setFilterColumn(p?.filterColumn ?? -1);
      setFilterValue(p?.filterValue ?? "");
    }
  };
  editChart.current = (id) => startPanel("chart", id);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    // Like Sheets, double-clicking a chart opens its editor. Univer hands a
    // selected chart's pointer events to the canvas (re-dispatching each
    // press), so no native dblclick reaches the chart element.
    let last = { id: "", time: 0, x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isTrusted) return;
      const id =
        [...container.querySelectorAll<HTMLElement>("[data-chart-id]")].find(
          (el) => {
            const r = el.getBoundingClientRect();
            return (
              e.clientX >= r.left &&
              e.clientX <= r.right &&
              e.clientY >= r.top &&
              e.clientY <= r.bottom
            );
          },
        )?.dataset.chartId ?? "";
      if (
        id &&
        id === last.id &&
        e.timeStamp - last.time < 500 &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8
      ) {
        last = { id: "", time: 0, x: 0, y: 0 };
        editChart.current(id);
      } else last = { id, time: e.timeStamp, x: e.clientX, y: e.clientY };
    };
    container.addEventListener("pointerdown", pointerDown, true);
    return () =>
      container.removeEventListener("pointerdown", pointerDown, true);
  }, []);
  const takeSelection = () => {
    const r = book.current?.getActiveRange();
    if (!r) return;
    setSourceSheet(book.current.getActiveSheet().getSheetId());
    setRange(r.getA1Notation());
  };
  const refreshPivot = async (p: PivotDefinition, onlyIfChanged = false) => {
    await api.current.getFormula().onCalculationResultApplied(10000);
    const s = book.current.getSheetBySheetId(p.targetSheetId);
    if (!s) throw new Error("The pivot worksheet has been deleted.");
    const values = readRange(p.source);
    const result = pivotResult(values, p);
    const numberFormat =
      p.aggregate === "COUNT"
        ? undefined
        : valueFormat(
            values,
            book.current
              .getSheetBySheetId(p.source.sheetId)
              .getRange(rangeLabel(p.source))
              .getNumberFormats(),
            p.value,
          );
    const signature = JSON.stringify([result, numberFormat]);
    pivotErrors.current.delete(p.id);
    if (onlyIfChanged && pivotWrites.current.get(p.id) === signature) return;
    const permission = s.getWorksheetPermission();
    const grow =
      result.length > s.getMaxRows() || result[0].length > s.getMaxColumns();
    try {
      if (grow) {
        if (permission.isProtected()) await permission.setEditable();
        if (result.length > s.getMaxRows())
          s.insertRows(s.getMaxRows() - 1, result.length - s.getMaxRows() + 1);
        if (result[0].length > s.getMaxColumns())
          s.insertColumns(
            s.getMaxColumns() - 1,
            result[0].length - s.getMaxColumns() + 1,
          );
      }
      // A direct mutation keeps recalculation out of the undo stack, so Cmd+Z after a
      // source edit undoes the edit itself; the pivot then follows it back.
      writingPivot.current = true;
      try {
        api.current.syncExecuteCommand("sheet.mutation.set-range-values", {
          unitId: book.current.getId(),
          subUnitId: p.targetSheetId,
          cellValue: pivotCells(result, {
            rowFields: p.rows.length,
            numberFormat,
            previous: {
              rows: s.getLastRow() + 1,
              columns: s.getLastColumn() + 1,
            },
          }),
          isOverrideStyle: true,
        });
      } finally {
        writingPivot.current = false;
      }
      pivotWrites.current.set(p.id, signature);
      p.invalid = false;
    } finally {
      if (grow || !permission.isProtected()) {
        if (!permission.isProtected())
          await permission.protect({ name: "Generated pivot" });
        await permission.setReadOnly();
      }
    }
    persist.current();
  };
  refreshPivots.current = (sheetIds) => {
    for (const p of content.current.pivots)
      if (
        !p.invalid &&
        p.source.sheetId !== p.targetSheetId &&
        sheetIds.has(p.source.sheetId)
      )
        void refreshPivot(p, true).catch((e) => {
          pivotErrors.current.set(
            p.id,
            e instanceof Error ? e.message : String(e),
          );
          setRevision((v) => v + 1);
        });
  };
  const copyPivot = (p: PivotDefinition) => {
    const s = book.current.getSheetBySheetId(p.targetSheetId);
    if (!s) return;
    const rows = s.getLastRow() + 1,
      columns = s.getLastColumn() + 1;
    if (rows < 1 || columns < 1) return;
    const cells = s.getRange(0, 0, rows, columns).getCellDatas();
    const copy = book.current.create(
      copySheetName(
        p.title,
        book.current.getSheets().map((x: any) => x.getSheetName()),
      ),
      Math.max(1000, rows),
      Math.max(26, columns),
    );
    copy
      .getRange(0, 0, rows, columns)
      .setValues(cells.map((r: any[]) => r.map((c) => c ?? {})));
    book.current.setActiveSheet(copy.getSheetId());
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
          value: valueChosen.current
            ? valueField
            : defaultValueField(values, rows),
          aggregate,
          filterColumn,
          filterValue,
        };
        const result = pivotResult(values, config);
        const name = title.trim() || "Pivot table";
        let p = content.current.pivots.find((p) => p.id === editing);
        if (!p) {
          const target = book.current.create(
            uniqueSheetName(
              name.slice(0, 31),
              book.current.getSheets().map((s: any) => s.getSheetName()),
            ),
            Math.max(1000, result.length),
            Math.max(26, result[0].length),
          );
          p = {
            id: crypto.randomUUID(),
            title: name,
            source,
            targetSheetId: target.getSheetId(),
            ...config,
          };
          content.current.pivots.push(p);
        } else
          Object.assign(p, { title: name, source, ...config, invalid: false });
        await refreshPivot(p);
        book.current.setActiveSheet(p.targetSheetId);
      }
      setPanel(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  let fields: CellValue[] = [],
    shownValueField = valueField;
  try {
    const values = readRange(parseRange(range, sourceSheet));
    fields = values[0] ?? [];
    // Until a value field is chosen, follow the range and rows to the first numeric field.
    if (panel === "pivot" && !valueChosen.current)
      shownValueField = defaultValueField(
        values,
        rowFields ? rowFields.split(",").map(Number) : [],
      );
  } catch {
    /* The inline editor allows temporarily incomplete ranges. */
  }
  const items = content.current;
  const activePivot = ready
    ? items.pivots.find(
        (p) =>
          p.targetSheetId === book.current?.getActiveSheet()?.getSheetId(),
      )
    : undefined;
  const activePivotError = activePivot
    ? pivotErrors.current.get(activePivot.id)
    : undefined;
  const functions = useSheetFunctions({
    ready,
    hostRef: host,
    bookRef: book,
    apiRef: api,
    injectorRef,
    persist: () => persist.current(),
    notify: setNotice,
  });
  functionActions.current = {
    insertFunction: functions.insertFunction,
    autoSum: functions.autoSum,
  };
  return (
    <div className={`sheets-editor${readOnly ? " view-locked" : ""}`}>
      {functions.panel}
      {functions.stats}
      {notice ? (
        <div className="sheet-notice" role="status">
          {notice}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {ready && api.current && engine.current ? (
        <NamedRanges
          ref={names}
          api={api.current}
          engine={engine.current}
          persist={() => persist.current()}
        />
      ) : null}
      {ready && api.current && engine.current ? (
        <SheetCleanup
          ref={cleanup}
          api={api.current}
          engine={engine.current}
          persist={() => persist.current()}
          onError={onError}
        />
      ) : null}
      {ready ? (
        <SheetSpelling
          ref={spelling}
          bookRef={book}
          hostRef={host}
          fileId={file.id}
          ready={ready}
          persist={() => persist.current()}
        />
      ) : null}
      {ready && api.current && engine.current ? (
        <SheetRowGroups
          ref={rowGroups}
          api={api.current}
          engine={engine.current}
          persist={() => persist.current()}
        />
      ) : null}
      {ready && api.current ? (
        <SheetFeatures
          ref={tabSettings}
          api={api.current}
          persist={() => persist.current()}
          onError={onError}
        />
      ) : (
        <div className="sheet-features" aria-hidden="true" />
      )}
      <div
        ref={toolbar}
        className={`sheets-toolbar${moreTools.overflowing ? " has-overflow" : ""}${moreTools.open ? " show-more" : ""}`}
        role="toolbar"
        aria-label="Spreadsheet formatting"
      >
        <MenuSearchPill />

        <Tool
          label="Undo (Cmd+Z)"
          disabled={readOnly}
          onClick={() => void api.current?.undo()}
        >
          <Undo2 size={16} />
        </Tool>
        <Tool
          label="Redo (Cmd+Y)"
          disabled={readOnly}
          onClick={() => void api.current?.redo()}
        >
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
        <Tool label="Paint format" disabled={readOnly} onClick={() => {}}>
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

        <Tool label="Format as currency" disabled={readOnly} onClick={formatCurrency}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>$</span>
        </Tool>
        <Tool label="Format as percent" disabled={readOnly} onClick={formatPercent}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>%</span>
        </Tool>
        <Tool label="Decrease decimal places" disabled={readOnly} onClick={subtractDecimal}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>.0←</span>
        </Tool>
        <Tool label="Increase decimal places" disabled={readOnly} onClick={addDecimal}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>.00→</span>
        </Tool>
        <details className="more-formats">
          <summary
            className="tool more-formats-btn"
            title="More formats"
            aria-label="More formats"
            aria-disabled={readOnly}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>123</span>
            <ChevronDown size={11} />
          </summary>
          <div className="more-formats-menu analysis-list">
            {Object.entries(numberFormatsByGroup()).map(
              ([group, items]: [string, any[]]) => (
                <div key={group}>
                  <div className={`more-formats-group ${group}`}>{group}</div>
                  {items.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="more-formats-item"
                      title={f.code}
                      onClick={() => applyNamedFormatNow(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              ),
            )}
          </div>
        </details>

        <span className="toolbar-divider" />

        <select
          className="toolbar-select font-family-select"
          aria-label="Font family"
          disabled={readOnly}
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
            disabled={readOnly}
            onClick={() => handleFontSize(Math.max(6, fontSize - 1))}
          >
            <Minus size={12} />
          </button>
          <input
            className="font-size-input"
            aria-label="Font size"
            disabled={readOnly}
            value={fontSize}
            onChange={(e) => handleFontSize(Number(e.target.value) || 10)}
          />
          <button
            type="button"
            className="stepper-btn"
            title="Increase font size"
            aria-label="Increase font size"
            disabled={readOnly}
            onClick={() => handleFontSize(Math.min(72, fontSize + 1))}
          >
            <Plus size={12} />
          </button>
        </div>

        <span className="toolbar-divider" />

        <Tool label="Bold (Cmd+B)" disabled={readOnly} active={isBold} onClick={toggleBold}>
          <Bold size={16} />
        </Tool>
        <Tool label="Italic (Cmd+I)" disabled={readOnly} active={isItalic} onClick={toggleItalic}>
          <Italic size={16} />
        </Tool>
        <Tool
          label="Strikethrough (Alt+Shift+5)"
          disabled={readOnly}
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
            disabled={readOnly}
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
            disabled={readOnly}
            onChange={(e) => handleFillColor(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="tool borders-btn"
          title="Borders"
          aria-label="Borders"
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
          onClick={toggleWrap}
        >
          <WrapText size={16} />
          <ChevronDown size={10} />
        </button>

        <span className="toolbar-divider" />

        <Tool label="Insert link (Cmd+K)" disabled={readOnly} onClick={() => links.current?.open()}>
          <Link size={16} />
        </Tool>
        <Tool
          label="Insert comment (Cmd+Option+M)"
          disabled={readOnly}
          onClick={() =>
            void api.current?.executeCommand(
              "sheet.operation.show-comment-modal",
            )
          }
        >
          <MessageSquarePlus size={16} />
        </Tool>

        <button
          type="button"
          className="tool chart-btn"
          title="Insert chart"
          aria-label="Insert chart"
          disabled={!ready || readOnly}
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
          disabled={!ready || readOnly}
          onClick={toggleFilter}
        >
          <Filter size={16} />
        </button>

        <button
          type="button"
          className="tool functions-btn"
          title="Functions"
          aria-label="Functions"
          disabled={readOnly}
          onClick={() => functions.autoSum()}
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
          disabled={!ready || readOnly}
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
                  {p.invalid
                    ? " · source missing"
                    : pivotErrors.current.has(p.id)
                      ? " · not updated"
                      : ""}
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
                  onClick={() => copyPivot(p)}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        </details>
        {moreTools.open ? (
          <span className="toolbar-break" aria-hidden="true" />
        ) : null}
        <button
          type="button"
          className="tool more-tools"
          title="More tools"
          aria-label="More tools"
          aria-expanded={moreTools.open}
          onClick={() => moreTools.setOpen(!moreTools.open)}
        >
          <EllipsisVertical size={16} />
        </button>
      </div>
      {filterView ? (
        <div
          className="filter-view-bar"
          role="status"
          data-filtered={filterView.hidden}
        >
          <span>
            {filterView.value
              ? `Showing ${filterView.header} is ${filterView.value}`
              : "Filter view"}
            {" · only on this screen"}
          </span>
          <button type="button" onClick={clearFilterView}>
            Show all rows
          </button>
        </div>
      ) : null}
      {activePivot ? (
        <div
          className="pivot-bar"
          role="region"
          aria-label="Pivot table details"
        >
          <Lock size={14} aria-hidden="true" />
          <span className="pivot-bar-text">
            <strong>Pivot table</strong> from{" "}
            {book.current
              ?.getSheetBySheetId(activePivot.source.sheetId)
              ?.getSheetName() ?? "a deleted sheet"}{" "}
            {rangeLabel(activePivot.source)} ·{" "}
            {activePivot.invalid ? (
              <span className="pivot-bar-warning">
                Source missing. Edit the pivot to choose a new range.
              </span>
            ) : activePivotError ? (
              <span className="pivot-bar-warning">
                Not updated: {activePivotError}
              </span>
            ) : (
              "Updates when the source changes"
            )}
          </span>
          <button onClick={() => startPanel("pivot", activePivot.id)}>
            Edit
          </button>
          <button
            title="Refresh pivot"
            aria-label="Refresh pivot"
            onClick={() =>
              void refreshPivot(activePivot).catch((e) => onError(String(e)))
            }
          >
            <RefreshCw size={14} />
          </button>
          <button onClick={() => copyPivot(activePivot)}>
            Make editable copy
          </button>
        </div>
      ) : null}
      <div
        className="sheet-host"
        ref={host}
        aria-label="Spreadsheet grid"
        aria-busy={!ready}
        style={{ pointerEvents: ready ? undefined : "none" }}
      />
      {sorting ? (
        <SortRangeDialog
          {...sorting}
          onSort={sortRange}
          onClose={() => setSorting(null)}
        />
      ) : null}
      {panel ? (
        <aside
          className="analysis-panel"
          style={{ top: host.current?.offsetTop }}
        >
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
          <div className="range-field">
            <label>
              Source range
              <input
                value={range}
                onChange={(e) => setRange(e.target.value)}
                placeholder="A1:D20"
              />
            </label>
            <button
              type="button"
              title="Use the cells selected in the grid"
              onClick={takeSelection}
            >
              Use selection
            </button>
          </div>
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
                  value={shownValueField}
                  onChange={(e) => {
                    valueChosen.current = true;
                    setValueField(+e.target.value);
                  }}
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
                Pivot results appear in a protected worksheet with grand totals
                and update when the source changes. Make an editable copy to
                annotate them.
              </p>
            </>
          )}
          <button className="primary" onClick={() => void submit()}>
            {editing ? "Update" : "Create"} {panel}
          </button>
        </aside>
      ) : null}
      {ready && dropdownEngine.current ? (
        <SheetDropdowns
          ref={dropdowns}
          api={dropdownEngine.current.api}
          injector={dropdownEngine.current.injector}
          persist={() => persist.current()}
          host={host}
        />
      ) : null}
      {ready && api.current ? (
        <SheetLinks
          ref={links}
          api={api.current}
          persist={() => persist.current()}
          host={host}
        />
      ) : null}
    </div>
  );
}
