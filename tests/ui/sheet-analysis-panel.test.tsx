// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { PivotDefinition } from "@suiteleaf/core";
import { SheetAnalysisPanel, SheetPivotBar } from "../../apps/web/src/editors/sheet-analysis-panel";
import { useAnalysisForm, type AnalysisForm } from "../../apps/web/src/editors/sheet-analysis";

afterEach(cleanup);

const book = {
  current: {
    getSheets: () => [
      { getSheetId: () => "s1", getSheetName: () => "Data" },
      { getSheetId: () => "s2", getSheetName: () => "Notes" },
    ],
    getSheetBySheetId: (id: string) => (id === "s1" ? { getSheetName: () => "Data" } : null),
  },
};

function Harness({
  panel,
  seen,
  calls,
}: {
  panel: "chart" | "pivot";
  seen: { form?: AnalysisForm };
  calls: string[];
}) {
  const form = useAnalysisForm();
  seen.form = form;
  return (
    <SheetAnalysisPanel
      panel={panel}
      setPanel={(next) => calls.push(`panel:${next}`)}
      form={form}
      fields={["Region", null, "Amount"]}
      shownValueField={2}
      pivotSource={[
        ["Region", "Kind", "Amount"],
        ["East", "a", 1],
      ]}
      valueChosen={seen as { current: boolean }}
      book={book}
      host={{ current: null }}
      takeSelection={() => calls.push("selection")}
      submit={async () => void calls.push("submit")}
    />
  );
}

it("edits the chart fields and sends Create", () => {
  const seen: { form?: AnalysisForm } = {};
  const calls: string[] = [];
  render(<Harness panel="chart" seen={seen} calls={calls} />);
  expect(screen.getByRole("heading").textContent).toBe("Insert chart");
  const title = screen.getByPlaceholderText("Amount") as HTMLInputElement;
  fireEvent.change(title, { target: { value: "Revenue" } });
  fireEvent.change(screen.getByDisplayValue("Data"), { target: { value: "s2" } });
  fireEvent.change(screen.getByPlaceholderText("A1:D20"), { target: { value: "B2:C9" } });
  fireEvent.change(screen.getByDisplayValue("Column / bar"), { target: { value: "pie" } });
  fireEvent.click(screen.getByRole("button", { name: "Use selection" }));
  fireEvent.click(screen.getByRole("button", { name: "Create chart" }));
  fireEvent.click(screen.getByRole("button", { name: "Close analysis panel" }));
  const form = seen.form!;
  expect([form.title, form.sourceSheet, form.range, form.chartType]).toEqual(["Revenue", "s2", "B2:C9", "pie"]);
  expect(calls).toEqual(["selection", "submit", "panel:null"]);
});

it("edits every pivot field and marks the value field as chosen", () => {
  const seen: { form?: AnalysisForm; current?: boolean } = {};
  const calls: string[] = [];
  render(<Harness panel="pivot" seen={seen} calls={calls} />);
  const [rows, columns] = screen.getAllByRole("listbox") as HTMLSelectElement[];
  rows.options[0].selected = false;
  rows.options[2].selected = true;
  fireEvent.change(rows);
  columns.options[1].selected = true;
  fireEvent.change(columns);
  expect(columns.options[1].textContent).toBe("Blank field");
  fireEvent.change(screen.getByLabelText("Value field"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Summarize by"), { target: { value: "MAX" } });
  fireEvent.change(screen.getByLabelText("Second summary"), { target: { value: "COUNT" } });
  fireEvent.change(screen.getByLabelText("Calculated field name"), { target: { value: "Fee" } });
  fireEvent.change(screen.getByLabelText("Calculated field operation"), { target: { value: "divide" } });
  fireEvent.change(screen.getByLabelText("Calculated field amount"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Filter field"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Equals"), { target: { value: "East" } });
  const form = seen.form!;
  expect([form.rowFields, form.columnFields, form.valueField, seen.current]).toEqual(["2", "1", 0, true]);
  expect([form.aggregate, form.secondAggregate, form.calculatedName, form.calculatedOp, form.calculatedAmount]).toEqual([
    "MAX",
    "COUNT",
    "Fee",
    "divide",
    "4",
  ]);
  expect([form.filterColumn, form.filterValue]).toEqual([0, "East"]);
  fireEvent.change(screen.getByLabelText("Calculated field operation"), { target: { value: "other" } });
  expect(seen.form!.calculatedOp).toBe("multiply");
  fireEvent.change(screen.getByLabelText("Date field"), { target: { value: "0" } });
  expect([seen.form!.dateColumn, seen.form!.dateGroup]).toEqual([0, "year"]);
  fireEvent.change(screen.getByLabelText("Group dates"), { target: { value: "month" } });
  fireEvent.change(screen.getByLabelText("Date field"), { target: { value: "0" } });
  expect(seen.form!.dateGroup).toBe("month");
  fireEvent.change(screen.getByLabelText("Date field"), { target: { value: "-1" } });
  expect(seen.form!.dateGroup).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Create pivot" }));
  expect(calls).toEqual(["submit"]);
});

const pivot = {
  id: "p1",
  title: "Totals",
  source: { sheetId: "s1", startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 },
  targetSheetId: "t",
  rows: [0],
  columns: [],
  value: 2,
  aggregate: "SUM",
} as unknown as PivotDefinition;

it("describes the pivot's source and its state", async () => {
  const calls: string[] = [];
  const props = {
    book,
    startPanel: (type: string, id?: string) => calls.push(`${type}:${id}`),
    refreshPivot: async () => {
      throw new Error("busy");
    },
    copyPivot: () => calls.push("copy"),
    onError: (message: string) => calls.push(message),
  };
  const view = render(<SheetPivotBar activePivot={pivot} activePivotError={undefined} {...props} />);
  const bar = screen.getByRole("region", { name: "Pivot table details" });
  expect(bar.textContent).toContain("from Data A1:C5");
  expect(bar.textContent).toContain("Updates when the source changes");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Make editable copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh pivot" }));
  await new Promise((done) => setTimeout(done, 0));
  expect(calls).toEqual(["pivot:p1", "copy", "Error: busy"]);
  view.rerender(<SheetPivotBar activePivot={pivot} activePivotError="Source moved" {...props} />);
  expect(bar.textContent).toContain("Not updated: Source moved");
  view.rerender(
    <SheetPivotBar
      activePivot={{ ...pivot, invalid: true, source: { ...pivot.source, sheetId: "gone" } }}
      activePivotError={undefined}
      {...props}
    />,
  );
  expect(bar.textContent).toContain("a deleted sheet");
  expect(bar.textContent).toContain("Source missing");
});
