// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { PivotDifferenceFields, pivotDifferenceFromForm } from "../../apps/web/src/editors/pivot-difference-fields";

afterEach(cleanup);

it("stores two different columns and refuses the same column", () => {
  expect(pivotDifferenceFromForm({ name: "  ", left: 1, right: 2, columnCount: 3 })).toBeUndefined();
  expect(pivotDifferenceFromForm({ name: " Margin\n", left: 1, right: 2, columnCount: 3 })).toEqual({
    name: "Margin",
    left: 1,
    right: 2,
  });
  expect(() =>
    pivotDifferenceFromForm({ name: "secret-value", left: 1, right: 1, columnCount: 3 }),
  ).toThrow("Choose two columns for the calculated field.");
  try {
    pivotDifferenceFromForm({ name: "secret-value", left: 1, right: 1, columnCount: 3 });
  } catch (caught) {
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("secret-value");
  }
});

it("lets the pivot dialog name the two columns", async () => {
  function Harness() {
    const [name, setName] = useState("");
    const [left, setLeft] = useState(-1);
    const [right, setRight] = useState(-1);
    return (
      <PivotDifferenceFields
        name={name}
        left={left}
        right={right}
        fields={["Team", "Revenue", "Cost"]}
        onName={setName}
        onLeft={setLeft}
        onRight={setRight}
      />
    );
  }
  render(<Harness />);
  await userEvent.type(screen.getByLabelText("Subtract columns"), "Margin");
  await userEvent.selectOptions(screen.getByLabelText("Left column"), "1");
  await userEvent.selectOptions(screen.getByLabelText("Right column"), "2");
  expect((screen.getByLabelText("Subtract columns") as HTMLInputElement).value).toBe("Margin");
  expect((screen.getByLabelText("Left column") as HTMLSelectElement).value).toBe("1");
  expect((screen.getByLabelText("Right column") as HTMLSelectElement).value).toBe("2");
  expect(
    pivotDifferenceFromForm({
      name: (screen.getByLabelText("Subtract columns") as HTMLInputElement).value,
      left: 1,
      right: 2,
      columnCount: 3,
    }),
  ).toEqual({ name: "Margin", left: 1, right: 2 });
  expect(document.body.textContent).not.toContain("secret-value");
});
