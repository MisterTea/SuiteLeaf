// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocalQueryFile } from "../../apps/web/src/editors/local-query-file";

afterEach(cleanup);

it("loads a local table and does not repeat the file or a cell", async () => {
  const seen: string[] = [];
  render(
    <LocalQueryFile
      onRows={(rows) => {
        seen.push(rows.map((row) => row.crop).join(","));
      }}
    />,
  );
  const input = screen.getByLabelText("Local table file");
  fireEvent.change(input, {
    target: {
      files: [new File(['{"secret-value":1}'], "secret-value.json", { type: "application/json" })],
    },
  });
  const refused = await screen.findByRole("status");
  expect(refused.textContent).toBe("That file is not a table of text.");
  expect(refused.textContent).not.toContain("secret-value");
  fireEvent.change(input, {
    target: {
      files: [
        new File(
          ["bed,crop\nNorth,Tomato\nSouth,secret-value\n"],
          "secret-value.csv",
          { type: "text/csv" },
        ),
      ],
    },
  });
  const loaded = await screen.findByRole("status");
  expect(loaded.textContent).toBe("The table has 2 rows.");
  expect(loaded.textContent).not.toContain("secret-value");
  expect(loaded.textContent).not.toContain("Tomato");
  expect(seen).toEqual(["Tomato,secret-value"]);
});

it("shows the sheet refusal instead of a cell", async () => {
  render(
    <LocalQueryFile
      onRows={() => "A cell already has a value."}
    />,
  );
  fireEvent.change(screen.getByLabelText("Local table file"), {
    target: {
      files: [new File(["bed,crop\nNorth,secret-value\n"], "beds.csv", { type: "text/csv" })],
    },
  });
  const status = await screen.findByRole("status");
  expect(status.textContent).toBe("A cell already has a value.");
  expect(status.textContent).not.toContain("secret-value");
});
