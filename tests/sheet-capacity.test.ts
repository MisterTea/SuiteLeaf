import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_CELL_LIMIT,
  LARGE_CELL_LIMIT,
  capacityDecision,
  countStoredCells,
  phasesBlockedByCapacity,
  startWorkbookWork,
} from "../packages/core/src/sheet-capacity";
import { timeWorkbookPhases } from "../packages/core/src/sheet-benchmark";

describe("spreadsheet capacity", () => {
  it("keeps a small workbook interactive and does not repeat a cell value", () => {
    const sheets = [{ cellData: { "0": { "0": { v: "secret-value" } } } }];
    const before = JSON.stringify(sheets);
    expect(countStoredCells(sheets)).toBe(1);
    expect(JSON.stringify(sheets)).toBe(before);
    const decision = capacityDecision(countStoredCells(sheets));
    expect(decision.tier).toBe("interactive");
    expect(decision.allowed).toBe(true);
    expect(decision.notice).toContain("Interactive spreadsheet.");
    expect(decision.notice).toContain("not a measured latency or memory budget");
    expect(decision.notice).not.toContain("secret-value");
    expect(phasesBlockedByCapacity(INTERACTIVE_CELL_LIMIT)).toEqual([]);
  });

  it("names the large tier and still allows the work", () => {
    const decision = capacityDecision(INTERACTIVE_CELL_LIMIT + 1);
    expect(decision.tier).toBe("large");
    expect(decision.allowed).toBe(true);
    expect(decision.notice).toContain("large tier");
    expect(decision.notice).toContain("query");
    expect(phasesBlockedByCapacity(LARGE_CELL_LIMIT)).toEqual([]);
  });

  it("does not start recalculation past the limit and does not keep the refused result", async () => {
    let called = false;
    const refused = startWorkbookWork(LARGE_CELL_LIMIT + 1, () => {
      called = true;
      return "secret-value";
    });
    expect(called).toBe(false);
    expect(refused.started).toBe(false);
    expect(refused.value).toBeUndefined();
    expect(refused.notice).toContain("past the spreadsheet limit");
    expect(JSON.stringify(refused)).not.toContain("secret-value");
    expect(phasesBlockedByCapacity(LARGE_CELL_LIMIT + 1)).toEqual([
      "recalculate",
      "render",
      "refresh",
    ]);

    let painted = false;
    const timed = await timeWorkbookPhases({
      cells: LARGE_CELL_LIMIT + 1,
      phases: {
        load: () => undefined,
        render: () => {
          painted = true;
          throw new Error("secret-value");
        },
        recalculate: () => {
          painted = true;
        },
        refresh: () => {
          painted = true;
        },
      },
    });
    expect(painted).toBe(false);
    expect(timed.stopped).toBe(false);
    expect(timed.phases.find((phase) => phase.name === "load")).toMatchObject({ skipped: false });
    expect(timed.phases.find((phase) => phase.name === "render")).toMatchObject({
      skipped: true,
      failed: false,
    });
    expect(JSON.stringify(timed)).not.toContain("secret-value");
  });

  it("refuses a count that is not a whole number and does not repeat it", () => {
    const decision = capacityDecision(Number.NaN);
    expect(decision.tier).toBe("unusable");
    expect(decision.allowed).toBe(false);
    expect(decision.notice).toBe(
      "That cell count cannot be used. Recalculation, painting, and refresh do not start.",
    );
    expect(decision.notice).not.toContain("NaN");
    expect(phasesBlockedByCapacity(-1)).toEqual(["recalculate", "render", "refresh"]);
  });
});
