import { useState } from "react";
import {
  parseRange,
  pivotSliceFromForm,
  pivotSortChoice,
  pivotSortFromForm,
  rangeLabel,
  slicePivot,
  type ChartDefinition,
  type PivotDefinition,
  type SheetFile,
  type SourceRange,
} from "@suiteleaf/core";
import {
  copySheetName,
  defaultValueField,
  pivotCells,
  pivotMeasures,
  pivotResult,
  uniqueSheetName,
  valueFormat,
  type CellValue,
} from "../analysis";
import { pivotDifferenceFromForm } from "./pivot-difference-fields";

type Ref<T> = { current: T };

/** The chart and pivot panel's fields. */
export function useAnalysisForm() {
  const [editing, setEditing] = useState<string>(),
    [range, setRange] = useState("A1:B5"),
    [sourceSheet, setSourceSheet] = useState(""),
    [title, setTitle] = useState("Chart"),
    [chartType, setChartType] = useState<ChartDefinition["type"]>("bar"),
    [rowFields, setRowFields] = useState("0"),
    [columnFields, setColumnFields] = useState(""),
    [valueField, setValueField] = useState(1),
    [aggregate, setAggregate] = useState<PivotDefinition["aggregate"]>("SUM"),
    [secondAggregate, setSecondAggregate] = useState<"" | PivotDefinition["aggregate"]>(""),
    [filterColumn, setFilterColumn] = useState(-1),
    [filterValue, setFilterValue] = useState(""),
    [dateColumn, setDateColumn] = useState(-1),
    [dateGroup, setDateGroup] = useState(""),
    [slicerColumn, setSlicerColumn] = useState(-1),
    [slicerText, setSlicerText] = useState(""),
    [sortChoice, setSortChoice] = useState(""),
    [drillGroup, setDrillGroup] = useState(""),
    [calculatedName, setCalculatedName] = useState(""),
    [calculatedOp, setCalculatedOp] = useState<"multiply" | "add" | "divide">("multiply"),
    [calculatedAmount, setCalculatedAmount] = useState("1"),
    [differenceName, setDifferenceName] = useState(""),
    [differenceLeft, setDifferenceLeft] = useState(-1),
    [differenceRight, setDifferenceRight] = useState(-1);
  return {
    editing,
    setEditing,
    range,
    setRange,
    sourceSheet,
    setSourceSheet,
    title,
    setTitle,
    chartType,
    setChartType,
    rowFields,
    setRowFields,
    columnFields,
    setColumnFields,
    valueField,
    setValueField,
    aggregate,
    setAggregate,
    secondAggregate,
    setSecondAggregate,
    filterColumn,
    setFilterColumn,
    filterValue,
    setFilterValue,
    dateColumn,
    setDateColumn,
    dateGroup,
    setDateGroup,
    slicerColumn,
    setSlicerColumn,
    slicerText,
    setSlicerText,
    sortChoice,
    setSortChoice,
    drillGroup,
    setDrillGroup,
    calculatedName,
    setCalculatedName,
    calculatedOp,
    setCalculatedOp,
    calculatedAmount,
    setCalculatedAmount,
    differenceName,
    setDifferenceName,
    differenceLeft,
    setDifferenceLeft,
    differenceRight,
    setDifferenceRight,
  };
}

export type AnalysisForm = ReturnType<typeof useAnalysisForm>;

export function suggestedChartTitle(headers: CellValue[]) {
  const names = headers
    .slice(1)
    .map((value) => String(value ?? ""))
    .filter(Boolean);
  if (!names.length) return "Chart";
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export type AnalysisContext = {
  api: Ref<any>;
  book: Ref<any>;
  content: Ref<SheetFile["content"]>;
  readRange: (r: SourceRange) => CellValue[][];
  persist: Ref<() => void>;
  refreshCharts: Ref<() => void>;
  /** Last result written per pivot, so unchanged recalculations leave the sheet alone. */
  pivotWrites: Ref<Map<string, string>>;
  writingPivot: Ref<boolean>;
  pivotErrors: Ref<Map<string, string>>;
  valueChosen: Ref<boolean>;
  panel: "chart" | "pivot" | null;
  setPanel: (panel: "chart" | "pivot" | null) => void;
  form: AnalysisForm;
  onError: (s: string) => void;
};

export function openAnalysisPanel(
  { content, book, valueChosen, setPanel, form }: AnalysisContext,
  type: "chart" | "pivot",
  id?: string,
) {
  const {
    setEditing,
    setSourceSheet,
    setRange,
    setTitle,
    setChartType,
    setRowFields,
    setColumnFields,
    setValueField,
    setAggregate,
    setSecondAggregate,
    setFilterColumn,
    setFilterValue,
    setDateColumn,
    setDateGroup,
    setSlicerColumn,
    setSlicerText,
    setSortChoice,
    setDrillGroup,
    setCalculatedName,
    setCalculatedOp,
    setCalculatedAmount,
    setDifferenceName,
    setDifferenceLeft,
    setDifferenceRight,
  } = form;
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
    setSecondAggregate(p?.measures?.[1]?.aggregate ?? "");
    setFilterColumn(p?.filterColumn ?? -1);
    setFilterValue(p?.filterValue ?? "");
    setDateColumn(p?.dateColumn ?? -1);
    setDateGroup(p?.dateGroup ?? "");
    setSlicerColumn(p?.slicerColumn ?? -1);
    setSlicerText(p?.slicerValues?.join(", ") ?? "");
    setSortChoice(pivotSortChoice(p?.sort));
    setDrillGroup("");
    setCalculatedName(p?.calculated?.name ?? "");
    setCalculatedOp(p?.calculated?.op ?? "multiply");
    setCalculatedAmount(
      p?.calculated ? String(p.calculated.amount) : "1",
    );
    setDifferenceName(p?.difference?.name ?? "");
    setDifferenceLeft(p?.difference?.left ?? -1);
    setDifferenceRight(p?.difference?.right ?? -1);
  }
}

export function takeAnalysisSelection({ book, form }: AnalysisContext) {
  const { setSourceSheet, setRange } = form;
  const r = book.current?.getActiveRange();
  if (!r) return;
  setSourceSheet(book.current.getActiveSheet().getSheetId());
  setRange(r.getA1Notation());
}

export async function refreshPivotOn(
  { api, book, readRange, pivotErrors, pivotWrites, writingPivot, persist }: AnalysisContext,
  p: PivotDefinition,
  onlyIfChanged = false,
) {
  await api.current.getFormula().onCalculationResultApplied(10000);
  const s = book.current.getSheetBySheetId(p.targetSheetId);
  if (!s) throw new Error("The pivot worksheet has been deleted.");
  const values = slicePivot(readRange(p.source), {
    dateColumn: p.dateColumn,
    dateGroup: p.dateGroup,
    slicerColumn: p.slicerColumn,
    slicerValues: p.slicerValues,
  });
  const result =
    p.measures && p.measures.length > 1
      ? pivotMeasures(values, p, p.measures)
      : pivotResult(values, p);
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
}

export function copyPivotOn({ book, persist }: AnalysisContext, p: PivotDefinition) {
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
}

export async function submitAnalysis(ctx: AnalysisContext) {
  const { api, book, content, readRange, persist, refreshCharts, valueChosen, panel, setPanel, form, onError } =
    ctx;
  const {
    editing,
    range,
    sourceSheet,
    title,
    chartType,
    rowFields,
    columnFields,
    valueField,
    aggregate,
    secondAggregate,
    filterColumn,
    filterValue,
    dateColumn,
    dateGroup,
    slicerColumn,
    slicerText,
    sortChoice,
    calculatedName,
    calculatedOp,
    calculatedAmount,
    differenceName,
    differenceLeft,
    differenceRight,
  } = form;
  const refreshPivot = (p: PivotDefinition) => refreshPivotOn(ctx, p);
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
      const slice = pivotSliceFromForm({
        dateColumn,
        dateGroup,
        slicerColumn,
        slicerText,
      });
      const grouped = slicePivot(values, slice);
      if ([...rows, ...columns].some((n) => !Number.isInteger(n) || n < 0))
        throw new Error("Use field indexes such as 0 or 0,1.");
      const amount = Number(calculatedAmount);
      const calculated =
        calculatedName.trim() && Number.isFinite(amount)
          ? { name: calculatedName.trim(), op: calculatedOp, amount }
          : undefined;
      const difference = pivotDifferenceFromForm({
        name: differenceName,
        left: differenceLeft,
        right: differenceRight,
        columnCount: values[0]?.length ?? 0,
      });
      const value = valueChosen.current ? valueField : defaultValueField(values, rows);
      const measures = secondAggregate
        ? [
            { value, aggregate },
            { value, aggregate: secondAggregate },
          ]
        : undefined;
      const config = {
        rows,
        columns,
        value,
        aggregate,
        filterColumn,
        filterValue,
        calculated,
        difference,
        measures,
        sort: pivotSortFromForm(sortChoice),
        ...slice,
      };
      const result = pivotResult(grouped, config);
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
}

/** Field names from the panel's source range, and the rows a pivot drill-down lists. */
export function analysisFields({ readRange, panel, form, valueChosen }: AnalysisContext) {
  const { range, sourceSheet, valueField, rowFields } = form;
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
  let pivotSource: (string | number | boolean | null)[][] = [];
  if (panel === "pivot") {
    try {
      pivotSource = readRange(parseRange(range, sourceSheet));
    } catch {
      pivotSource = [];
    }
  }
  return { fields, shownValueField, pivotSource };
}
