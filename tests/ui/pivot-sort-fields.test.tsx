// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PivotSortFields } from "../../apps/web/src/editors/pivot-sort-fields";
import { pivotSortFromForm } from "../../packages/core/src/pivot-sort";

afterEach(cleanup);

function Harness() {
  const [choice, setChoice] = useState("");
  const sort = pivotSortFromForm(choice);
  return (
    <>
      <PivotSortFields value={choice} onChange={setChoice} />
      <p>{JSON.stringify(sort ?? null)}</p>
    </>
  );
}

describe("pivot sort fields", () => {
  it("stores values high to low", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort rows" }), {
      target: { value: "value-desc" },
    });
    expect(screen.getByText('{"by":"value","direction":"desc"}')).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort rows" }).textContent).toContain(
      "Values high to low",
    );
  });
});
