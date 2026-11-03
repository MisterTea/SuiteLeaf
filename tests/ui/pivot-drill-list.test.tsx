// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { PivotDrillList } from "../../apps/web/src/editors/pivot-drill-list";

const sales = [
  ["Date", "Team", "Revenue"],
  ["2026-01-15", "North", 10],
  ["2026-03-02", "North", 5],
  ["2026-06-01", "South", "secret-value"],
];

afterEach(cleanup);

function Harness() {
  const [group, setGroup] = useState("");
  return (
    <PivotDrillList
      values={sales}
      slice={{ dateColumn: 0, dateGroup: "year", slicerColumn: 1, slicerValues: ["North"] }}
      group={group}
      onGroup={setGroup}
    />
  );
}

it("shows the source rows for the typed year", () => {
  render(<Harness />);
  expect(screen.getByText("Name the group to show.")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Show source rows" }), {
    target: { value: "2026" },
  });
  expect(screen.getByText("2 source rows.")).toBeTruthy();
  expect(screen.getByText("2026-01-15, North, 10")).toBeTruthy();
  expect(screen.getByText("2026-03-02, North, 5")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret-value");
});
