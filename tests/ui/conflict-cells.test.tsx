// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ConflictCells } from "../../apps/web/src/conflict-cells";

afterEach(cleanup);

it("takes named cells and does not repeat a bad address", async () => {
  const calls: string[][] = [];
  render(
    <ConflictCells
      onTake={async (addresses) => {
        calls.push(addresses);
        return addresses[0] === "B1" ? null : "Name a cell, such as B2.";
      }}
    />,
  );
  const field = screen.getByLabelText("Cells to take from SuiteDrive");
  fireEvent.change(field, { target: { value: "secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Take these cells" }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toBe("Name a cell, such as B2.");
  expect(status.textContent).not.toContain("secret-value");
  fireEvent.change(field, { target: { value: "B1, A1" } });
  fireEvent.click(screen.getByRole("button", { name: "Take these cells" }));
  expect((await screen.findByRole("status")).textContent).toBe(
    "Those cells were taken from the other copy.",
  );
  expect(calls).toEqual([["secret-value"], ["B1", "A1"]]);
});
