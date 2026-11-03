// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SheetQueryPanel } from "../../apps/web/src/editors/sheet-query-panel";

afterEach(cleanup);

it("checks columns without refreshing", () => {
  let applied = false;
  render(
    <SheetQueryPanel
      disabled={false}
      initial={{ column: "plot", equals: "secret-value" }}
      onApply={() => {
        applied = true;
        return { placement: null, message: "wrote", changed: true };
      }}
      onCheck={() => "Step 1 uses plot, and that column is not in the source."}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check columns" }));
  expect(applied).toBe(false);
  expect(screen.getByRole("status").textContent).toBe(
    "Step 1 uses plot, and that column is not in the source.",
  );
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
});

it("excludes the named value when that box is checked", () => {
  const calls: { match?: string; equals: string }[] = [];
  render(
    <SheetQueryPanel
      disabled={false}
      initial={{ op: "filter", column: "crop", equals: "Tomato", match: "ne" }}
      onApply={(step) => {
        if (step.op === "filter") calls.push({ match: step.match, equals: step.equals });
        return {
          placement: null,
          message: "The other rows were written beside the selection. The source cells stayed.",
          changed: true,
        };
      }}
    />,
  );
  expect((screen.getByRole("checkbox", { name: "Exclude this value" }) as HTMLInputElement).checked).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual([{ match: "ne", equals: "Tomato" }]);
  expect(screen.getByRole("status").textContent).toContain("other rows");
  fireEvent.click(screen.getByRole("checkbox", { name: "Exclude this value" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls[1]).toEqual({ match: undefined, equals: "Tomato" });
});

it("stores a contains filter from the panel", () => {
  const calls: { match?: string; equals: string }[] = [];
  render(
    <SheetQueryPanel
      disabled={false}
      initial={{ op: "filter", column: "crop", equals: "beds", match: "contains" }}
      onApply={(step) => {
        if (step.op === "filter") calls.push({ match: step.match, equals: step.equals });
        return { placement: null, message: "Rows were written beside the selection.", changed: true };
      }}
    />,
  );
  expect((screen.getByRole("checkbox", { name: "Cell contains this text" }) as HTMLInputElement).checked).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual([{ match: "contains", equals: "beds" }]);
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
});

it("opens with the saved filter and refreshes those values", () => {
  const calls: string[] = [];
  render(
    <SheetQueryPanel
      disabled={false}
      initial={{ column: "crop", equals: "Tomato" }}
      onApply={(step) => {
        calls.push(
          step.op === "filter"
            ? `${step.column}=${step.equals}`
            : step.op === "convert"
              ? `${step.column}:${step.to}`
              : step.op === "sort"
                ? `${step.column}:${step.direction}`
                : step.op === "dedupe"
                  ? `${step.column}:dedupe`
                  : step.op === "group"
                    ? `${step.by}+${step.value}:${step.aggregate}`
                      : step.op === "split"
                      ? `${step.column}|${step.into.join("+")}`
                      : step.op === "merge"
                        ? `${step.columns.join("+")}>${step.into}`
                        : step.op === "join"
                          ? `${step.on}+${step.take.join("+")}@${step.range}`
                          : `append@${step.range}`,
        );
        return {
          placement: null,
          message: "The matching rows were written beside the selection. The source cells stayed.",
          changed: true,
        };
      }}
    />,
  );
  expect((screen.getByLabelText("Query column") as HTMLInputElement).value).toBe("crop");
  expect((screen.getByLabelText("Query value") as HTMLInputElement).value).toBe("Tomato");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual(["crop=Tomato"]);
  expect(screen.getByRole("status").textContent).toContain("source cells stayed");
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "convert" } });
  fireEvent.change(screen.getByLabelText("Query column"), { target: { value: "amount" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual(["crop=Tomato", "amount:number"]);
  expect(screen.getByText(/Converts one column/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "sort" } });
  fireEvent.change(screen.getByLabelText("Sort order"), { target: { value: "desc" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual(["crop=Tomato", "amount:number", "amount:desc"]);
  expect(screen.getByText(/Sorts the selection/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "dedupe" } });
  fireEvent.change(screen.getByLabelText("Query column"), { target: { value: "crop" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual(["crop=Tomato", "amount:number", "amount:desc", "crop:dedupe"]);
  expect(screen.getByText("The first row for each value is kept.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "group" } });
  fireEvent.change(screen.getByLabelText("Query column"), { target: { value: "bed" } });
  fireEvent.change(screen.getByLabelText("Value column"), { target: { value: "amount" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual(["crop=Tomato", "amount:number", "amount:desc", "crop:dedupe", "bed+amount:sum"]);
  expect(screen.getByText(/Groups the selection/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "split" } });
  fireEvent.change(screen.getByLabelText("Query column"), { target: { value: "plot" } });
  fireEvent.change(screen.getByLabelText("Split columns"), { target: { value: "bed, note" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls.at(-1)).toBe("plot|bed+note");
  expect(screen.getByText(/Splits one column/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "merge" } });
  fireEvent.change(screen.getByLabelText("Merge columns"), { target: { value: "bed, note" } });
  fireEvent.change(screen.getByLabelText("Merge into"), { target: { value: "plot" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls.at(-1)).toBe("bed+note>plot");
  expect(screen.getByText(/Merges columns/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "join" } });
  fireEvent.change(screen.getByLabelText("Query column"), { target: { value: "bed" } });
  fireEvent.change(screen.getByLabelText("Join columns"), { target: { value: "note" } });
  fireEvent.change(screen.getByLabelText("Lookup range"), { target: { value: "E1:F4" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls.at(-1)).toBe("bed+note@E1:F4");
  expect(screen.getByText(/Copies columns from a lookup range/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Query step"), { target: { value: "append" } });
  fireEvent.change(screen.getByLabelText("Lookup range"), { target: { value: "E1:F3" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls.at(-1)).toBe("append@E1:F3");
  expect(screen.getByText(/Stacks a lookup range/)).toBeTruthy();
});

it("uses a replacement column and refuses a credential-like name", () => {
  const columns: string[] = [];
  render(
    <SheetQueryPanel
      disabled={false}
      initial={{ op: "filter", column: "crop", equals: "Tomato" }}
      onApply={(step) => {
        if (step.op === "filter") columns.push(step.column);
        return { placement: null, message: "kept", changed: true };
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Old column"), { target: { value: "crop" } });
  fireEvent.change(screen.getByLabelText("New column"), { target: { value: "plant" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this column instead" }));
  expect(screen.getByText("The step now uses plant.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(columns).toEqual(["plant"]);
  fireEvent.change(screen.getByLabelText("Old column"), { target: { value: "plant" } });
  fireEvent.change(screen.getByLabelText("New column"), { target: { value: "secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Use this column instead" }));
  expect(screen.getByText("That column cannot be remapped.")).toBeTruthy();
  expect(screen.getByText("That column cannot be remapped.").textContent).not.toContain("secret-value");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(columns).toEqual(["plant", "plant"]);
});

it("stores a minimum group from the panel", () => {
  const calls: string[] = [];
  render(
    <SheetQueryPanel
      disabled={false}
      initial={{ op: "group", by: "bed", value: "amount", aggregate: "min" }}
      onApply={(step) => {
        if (step.op === "group") calls.push(step.aggregate);
        return { placement: null, message: "The groups were written beside the selection.", changed: true };
      }}
    />,
  );
  expect((screen.getByRole("combobox", { name: "Group total" }) as HTMLSelectElement).value).toBe("min");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(calls).toEqual(["min"]);
});
