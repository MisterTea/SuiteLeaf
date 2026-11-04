// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  SheetCellFields,
  sheetCellFields,
  sheetCellsLeftOut,
  workbookCellFields,
} from "../../apps/web/src/editors/sheet-cell-fields";

afterEach(cleanup);

const grid = {
  "0": { "0": { v: "Crop" } },
  "1": { "0": { v: "Tomato" } },
};

it("writes Arabic cell fields from right to left", () => {
  const arabic = render(<SheetCellFields grid={grid} language="ar" onEdit={() => {}} />);
  expect(arabic.container.querySelector(".sheet-cell-fields")?.getAttribute("dir")).toBe("rtl");
  arabic.unmount();
  const english = render(<SheetCellFields grid={grid} language="en" onEdit={() => {}} />);
  expect(english.container.querySelector(".sheet-cell-fields")?.getAttribute("dir")).toBe("ltr");
});

it("edits a sheet cell from its text field and leaves the grid unchanged", () => {
  const edits: string[] = [];
  render(
    <SheetCellFields
      grid={grid}
      onEdit={(row, column, value) => edits.push(`${row},${column},${value}`)}
    />,
  );
  const crop = screen.getByRole("textbox", { name: "A1" });
  const tomato = screen.getByRole("textbox", { name: "Crop row 2" });
  expect((crop as HTMLInputElement).value).toBe("Crop");
  expect((tomato as HTMLInputElement).value).toBe("Tomato");
  fireEvent.change(tomato, { target: { value: "Bean" } });
  expect(edits).toEqual(["1,0,Bean"]);
  expect((tomato as HTMLInputElement).value).toBe("Bean");
  expect((crop as HTMLInputElement).value).toBe("Crop");
  expect(sheetCellFields(grid)[1]?.value).toBe("Tomato");
});

it("lists a formula error outside the first rows and columns", () => {
  const far = {
    "20": { "6": { v: "#DIV/0!", f: "secret-value" } },
    "1": { "0": { v: "Tomato" } },
  };
  const fields = sheetCellFields(far);
  expect(fields.map((field) => field.label)).toEqual(["A2", "G21"]);
  expect(fields[1]?.value).toBe("#DIV/0!");
  expect(JSON.stringify(fields)).not.toContain("secret-value");
  const edits: string[] = [];
  render(
    <SheetCellFields
      grid={far}
      onEdit={(row, column, value) => edits.push(`${row},${column},${value}`)}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "G21" }), { target: { value: "0" } });
  expect(edits).toEqual(["20,6,0"]);
  expect(far["20"]["6"].v).toBe("#DIV/0!");
});

it("edits a formula error on a later sheet and leaves the sheet id out of the label", () => {
  const fees = { "0": { "0": { v: "#DIV/0!", f: "secret-value" } } };
  const sheets = [
    { id: "beds", name: "Beds", grid: { "0": { "0": { v: "Tomato" } } } },
    { id: "secret-value", name: "Fees", grid: fees },
  ];
  const fields = workbookCellFields(sheets);
  expect(fields.map((field) => field.label)).toEqual(["Beds A1", "Fees A1"]);
  const edits: string[] = [];
  render(
    <SheetCellFields
      sheets={sheets}
      onEdit={(row, column, value, sheetId) => edits.push(`${sheetId}:${row},${column},${value}`)}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Fees A1" }), { target: { value: "0" } });
  expect(edits).toEqual(["secret-value:0,0,0"]);
  expect(document.body.textContent).not.toContain("secret-value");
  expect(fees["0"]["0"].v).toBe("#DIV/0!");
});

it("edits a stored cell outside the first rows and leaves the rest unlisted", () => {
  const far: Record<string, Record<string, { v?: unknown }>> = {
    "20": { "6": { v: "Beds" } },
  };
  for (let row = 12; row < 53; row += 1) {
    far[String(row)] = { ...(far[String(row)] ?? {}), "7": { v: row === 52 ? "secret-value" : "North" } };
  }
  const fields = sheetCellFields(far);
  expect(fields.map((field) => field.label)).toContain("G21");
  expect(fields.find((field) => field.label === "G21")?.value).toBe("Beds");
  expect(sheetCellsLeftOut(far)).toBe(2);
  expect(JSON.stringify(fields)).not.toContain("secret-value");
  const edits: string[] = [];
  render(
    <SheetCellFields
      grid={far}
      onEdit={(row, column, value) => edits.push(`${row},${column},${value}`)}
    />,
  );
  expect(screen.getByText("2 more cells are outside this list.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret-value");
  fireEvent.change(screen.getByRole("textbox", { name: "G21" }), { target: { value: "Paths" } });
  expect(edits).toEqual(["20,6,Paths"]);
  expect(far["20"]["6"].v).toBe("Beds");
});
