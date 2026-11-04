import type { RefObject } from "react";
import { Lock, RefreshCw, X } from "lucide-react";
import {
  pivotSliceFromForm,
  rangeLabel,
  type ChartDefinition,
  type PivotDefinition,
} from "@suiteleaf/core";
import type { CellValue } from "../analysis";
import { PivotSliceFields } from "./pivot-slice-fields";
import { PivotSortFields } from "./pivot-sort-fields";
import { PivotDifferenceFields } from "./pivot-difference-fields";
import { PivotDrillList } from "./pivot-drill-list";
import { suggestedChartTitle, type AnalysisForm } from "./sheet-analysis";

export function SheetAnalysisPanel({
  panel,
  setPanel,
  form,
  fields,
  shownValueField,
  pivotSource,
  valueChosen,
  book,
  host,
  takeSelection,
  submit,
}: {
  panel: "chart" | "pivot";
  setPanel: (panel: "chart" | "pivot" | null) => void;
  form: AnalysisForm;
  fields: CellValue[];
  shownValueField: number;
  pivotSource: (string | number | boolean | null)[][];
  valueChosen: { current: boolean };
  book: RefObject<any>;
  host: RefObject<HTMLDivElement | null>;
  takeSelection: () => void;
  submit: () => Promise<void>;
}) {
  const {
    editing,
    title,
    setTitle,
    sourceSheet,
    setSourceSheet,
    range,
    setRange,
    chartType,
    setChartType,
    rowFields,
    setRowFields,
    columnFields,
    setColumnFields,
    setValueField,
    aggregate,
    setAggregate,
    secondAggregate,
    setSecondAggregate,
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
  } = form;
  return (
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
            <option value="area">Area</option>
            <option value="combo">Combo</option>
            <option value="stacked">Stacked</option>
            <option value="pie">Pie</option>
            <option value="scatter">Scatter</option>
            <option value="waterfall">Waterfall</option>
            <option value="histogram">Histogram</option>
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
              {["SUM", "COUNT", "AVERAGE", "MIN", "MAX", "PERCENT"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            Also summarize
            <select
              aria-label="Second summary"
              value={secondAggregate}
              onChange={(e) =>
                setSecondAggregate(e.target.value as "" | PivotDefinition["aggregate"])
              }
            >
              <option value="">No second summary</option>
              {["SUM", "COUNT", "AVERAGE", "MIN", "MAX", "PERCENT"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            Calculated field
            <input
              aria-label="Calculated field name"
              value={calculatedName}
              onChange={(e) => setCalculatedName(e.target.value)}
              placeholder="Fee"
            />
          </label>
          <label>
            Calculation
            <select
              aria-label="Calculated field operation"
              value={calculatedOp}
              onChange={(e) =>
                setCalculatedOp(
                  e.target.value === "add" || e.target.value === "divide" ? e.target.value : "multiply",
                )
              }
            >
              <option value="multiply">Multiply each value</option>
              <option value="divide">Divide each value</option>
              <option value="add">Add to each value</option>
            </select>
          </label>
          <label>
            Amount
            <input
              aria-label="Calculated field amount"
              value={calculatedAmount}
              onChange={(e) => setCalculatedAmount(e.target.value)}
            />
          </label>
          <PivotDifferenceFields
            name={differenceName}
            left={differenceLeft}
            right={differenceRight}
            fields={fields}
            onName={setDifferenceName}
            onLeft={setDifferenceLeft}
            onRight={setDifferenceRight}
          />
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
          <PivotSliceFields
            dateColumn={dateColumn}
            dateGroup={dateGroup}
            slicerColumn={slicerColumn}
            slicerText={slicerText}
            fields={fields}
            onDateColumn={(column) => {
              setDateColumn(column);
              if (column >= 0 && !dateGroup) setDateGroup("year");
              if (column < 0) setDateGroup("");
            }}
            onDateGroup={setDateGroup}
            onSlicerColumn={setSlicerColumn}
            onSlicerText={setSlicerText}
          />
          <PivotSortFields value={sortChoice} onChange={setSortChoice} />
          <PivotDrillList
            values={pivotSource}
            slice={pivotSliceFromForm({ dateColumn, dateGroup, slicerColumn, slicerText })}
            group={drillGroup}
            onGroup={setDrillGroup}
          />
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
  );
}

export function SheetPivotBar({
  activePivot,
  activePivotError,
  book,
  startPanel,
  refreshPivot,
  copyPivot,
  onError,
}: {
  activePivot: PivotDefinition;
  activePivotError: string | undefined;
  book: RefObject<any>;
  startPanel: (type: "chart" | "pivot", id?: string) => void;
  refreshPivot: (p: PivotDefinition) => Promise<void>;
  copyPivot: (p: PivotDefinition) => void;
  onError: (s: string) => void;
}) {
  return (
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
  );
}
