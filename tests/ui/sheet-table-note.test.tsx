// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { growTable, shrinkTable } from "@suiteleaf/core";
import { SheetTableNote } from "../../apps/web/src/editors/sheet-table-note";

afterEach(cleanup);

it("lists a table range and the range after one row is added", () => {
  const sales = {
    name: "Sales",
    sheetId: "s",
    headerRow: 0,
    startColumn: 0,
    endColumn: 2,
    endRow: 3,
  };
  const { rerender } = render(<SheetTableNote tables={[sales]} />);
  const region = screen.getByRole("region", { name: "Sheet tables" });
  expect(region.textContent).toContain("Sales A1:C4");
  rerender(<SheetTableNote tables={[growTable(sales, 1)]} />);
  expect(region.textContent).toContain("Sales A1:C5");
  expect(sales.endRow).toBe(3);
  const shorter = shrinkTable(sales, 1);
  if ("error" in shorter) throw new Error(shorter.error);
  rerender(<SheetTableNote tables={[shorter]} />);
  expect(region.textContent).toContain("Sales A1:C3");
  expect(sales.endRow).toBe(3);
});
