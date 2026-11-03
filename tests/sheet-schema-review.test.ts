import { expect, it } from "vitest";
import { reviewQuerySchema, schemaNoteText } from "../packages/core/src/sheet-query";
import { checkSheetQuery } from "../apps/web/src/editors/sheet-query-panel";

it("names a column the source no longer has and does not repeat a cell value", () => {
  const notes = reviewQuerySchema(
    {
      version: 1,
      steps: [
        { op: "rename", from: "bed", to: "plot" },
        { op: "filter", column: "plot", equals: "secret-value" },
        { op: "sort", column: "gone", direction: "asc" },
      ],
    },
    ["bed", "crop"],
  );
  expect(notes).toEqual([{ step: 3, column: "gone" }]);
  expect(schemaNoteText(notes[0])).toBe("Step 3 uses gone, and that column is not in the source.");
  expect(JSON.stringify(notes)).not.toContain("secret-value");
});

it("checks the header row and does not write the sheet", () => {
  let wrote = false;
  const sheet = {
    getSelection: () => ({
      getActiveRange: () => ({
        getRange: () => ({ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }),
        getRawValues: () => [
          ["bed", "crop"],
          ["North", "secret-value"],
        ],
      }),
    }),
    getRange: () => {
      wrote = true;
      throw new Error("wrote");
    },
  };
  const message = checkSheetQuery(sheet, { op: "filter", column: "plot", equals: "secret-value" });
  expect(message).toBe("Step 1 uses plot, and that column is not in the source.");
  expect(message).not.toContain("secret-value");
  expect(wrote).toBe(false);
  expect(
    checkSheetQuery(sheet, { op: "filter", column: "bed", equals: "North" }),
  ).toBe("The columns in this step are in the source.");
});
