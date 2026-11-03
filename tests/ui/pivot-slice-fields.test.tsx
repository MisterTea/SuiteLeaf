// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PivotSliceFields } from "../../apps/web/src/editors/pivot-slice-fields";
import { pivotSliceFromForm } from "../../packages/core/src/pivot-slicer";

afterEach(cleanup);

function Harness() {
  const [dateColumn, setDateColumn] = useState(-1);
  const [dateGroup, setDateGroup] = useState("");
  const [slicerColumn, setSlicerColumn] = useState(-1);
  const [slicerText, setSlicerText] = useState("");
  const slice = pivotSliceFromForm({ dateColumn, dateGroup, slicerColumn, slicerText });
  return (
    <>
      <PivotSliceFields
        dateColumn={dateColumn}
        dateGroup={dateGroup}
        slicerColumn={slicerColumn}
        slicerText={slicerText}
        fields={["Date", "Team"]}
        onDateColumn={(column) => {
          setDateColumn(column);
          if (column >= 0 && !dateGroup) setDateGroup("year");
        }}
        onDateGroup={setDateGroup}
        onSlicerColumn={setSlicerColumn}
        onSlicerText={setSlicerText}
      />
      <p>{JSON.stringify(slice)}</p>
    </>
  );
}

describe("pivot slice fields", () => {
  it("sets a year group and a North slicer", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "Date field" }), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Slicer field" }), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Slicer values" }), {
      target: { value: "North" },
    });
    expect(screen.getByText(/"dateGroup":"year"/)).toBeTruthy();
    expect(screen.getByText(/"slicerValues":\["North"\]/)).toBeTruthy();
  });
});