import { expect, it } from "vitest";
import { createFile } from "../packages/core/src";
import { openOfficeFile } from "../packages/core/src/open-office";
import {
  benchmarkRegression,
  importKeepingSaved,
  expensiveFormulas,
  formulaRefs,
  runCancellable,
  timeWorkbookPhases,
} from "../packages/core/src/sheet-benchmark";

it("returns the saved workbook when a pass is cancelled and records the run", () => {
  const saved = { cells: { A1: 1 } };
  const cancelled = runCancellable({
    saved,
    dataset: "beds",
    hardware: "test-machine",
    runtime: "node",
    version: "0.0.0-test",
    steps: 3,
    shouldStop: () => true,
    apply: (workbook) => ({ cells: { ...workbook.cells, A2: 2 } }),
  });
  expect(cancelled.workbook).toBe(saved);
  expect(saved.cells).toEqual({ A1: 1 });
  expect(cancelled.benchmark).toMatchObject({
    dataset: "beds",
    hardware: "test-machine",
    runtime: "node",
    version: "0.0.0-test",
    cancelled: true,
  });
  expect(cancelled.benchmark.elapsedMs).toBeGreaterThanOrEqual(0);

  const finished = runCancellable({
    saved,
    dataset: " beds ",
    hardware: "",
    runtime: "node",
    version: "0.0.0-test",
    steps: 1,
    apply: (workbook) => ({ cells: { ...workbook.cells, A2: 2 } }),
  });
  expect(finished.workbook.cells).toEqual({ A1: 1, A2: 2 });
  expect(saved.cells).toEqual({ A1: 1 });
  expect(finished.benchmark.dataset).toBe("beds");
  expect(finished.benchmark.hardware).toBe("not recorded");
  expect(finished.benchmark.cancelled).toBe(false);

  expect(
    benchmarkRegression(
      { ...finished.benchmark, elapsedMs: 10, cancelled: false },
      { ...finished.benchmark, elapsedMs: 30, cancelled: false },
    ).regressed,
  ).toBe(true);
  expect(
    benchmarkRegression(
      { ...finished.benchmark, elapsedMs: 30, cancelled: false },
      { ...finished.benchmark, elapsedMs: 10, cancelled: false },
    ),
  ).toMatchObject({ regressed: false });
  expect(
    benchmarkRegression(cancelled.benchmark, { ...finished.benchmark, elapsedMs: 100 }).regressed,
  ).toBe(false);
  expect(
    benchmarkRegression(finished.benchmark, { ...finished.benchmark, dataset: "other", elapsedMs: 100 })
      .regressed,
  ).toBe(false);
  const slower = benchmarkRegression(
    { ...finished.benchmark, dataset: "secret-value", elapsedMs: 10, cancelled: false },
    { ...finished.benchmark, dataset: "secret-value", elapsedMs: 30, cancelled: false },
  );
  expect(slower).toEqual({
    regressed: true,
    reason: "This pass took 30 ms after 10 ms.",
  });
  expect(slower.reason).not.toContain("secret-value");
  const otherComputer = benchmarkRegression(
    { ...finished.benchmark, hardware: "secret-value", elapsedMs: 10 },
    { ...finished.benchmark, hardware: "other", elapsedMs: 30 },
  );
  expect(otherComputer).toEqual({
    regressed: false,
    reason: "The passes are not the same measurement.",
  });
  expect(otherComputer.reason).not.toContain("secret-value");
});

it("keeps the saved workbook when an import is cancelled", async () => {
  const saved = { cells: { A1: "Tomato" } };
  let stop = false;
  const dropped = await importKeepingSaved({
    saved,
    shouldStop: () => stop,
    load: async () => {
      stop = true;
      return { cells: { A1: "secret-value" } };
    },
  });
  expect(dropped.cancelled).toBe(true);
  expect(dropped.workbook).toBe(saved);
  expect(JSON.stringify(dropped)).not.toContain("secret-value");

  const file = createFile("sheet", "Beds");
  const opened = await openOfficeFile(new Uint8Array([1, 2, 3]), "xlsx", "secret-value.xlsx", {
    saved: file,
    shouldStop: () => true,
  });
  expect(opened).toBe(file);
  if (opened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(opened.title).toBe("Beds");
});

it("times each supplied workbook phase and skips the rest when stopped", async () => {
  let step = 0;
  const timed = await timeWorkbookPhases({
    shouldStop: () => step >= 2,
    phases: {
      load: () => {
        step += 1;
        const cell = "secret-value";
        expect(cell).toBe("secret-value");
      },
      parse: () => {
        step += 1;
      },
      render: () => {
        throw new Error("secret-value");
      },
    },
  });
  expect(timed.stopped).toBe(true);
  expect(timed.phases.map((phase) => [phase.name, phase.skipped, phase.failed])).toEqual([
    ["load", false, false],
    ["parse", false, false],
    ["recalculate", true, false],
    ["render", true, false],
    ["serialize", true, false],
    ["save", true, false],
    ["refresh", true, false],
  ]);
  expect(JSON.stringify(timed)).not.toContain("secret-value");
  let recalculated = false;
  const failed = await timeWorkbookPhases({
    phases: {
      parse: () => {
        throw new Error("secret-value");
      },
      recalculate: () => {
        recalculated = true;
      },
    },
  });
  expect(failed.stopped).toBe(false);
  expect(recalculated).toBe(false);
  expect(failed.phases.find((phase) => phase.name === "parse")).toMatchObject({
    skipped: false,
    failed: true,
  });
  expect(failed.phases.find((phase) => phase.name === "recalculate")).toMatchObject({
    skipped: true,
    failed: false,
  });
  expect(JSON.stringify(failed)).not.toContain("secret-value");
});

it("names a wide formula by its cell and leaves the formula text out", () => {
  const costs = expensiveFormulas({
    0: {
      0: { f: '="secret-value"' },
      2: { f: "=SUM(A1:A80)" },
      1: { f: "=A1" },
    },
    1: { 0: { v: "secret-value" } as { f?: string } },
  });
  expect(costs).toEqual([{ address: "C1", refs: 80 }]);
  expect(JSON.stringify(costs)).not.toContain("secret-value");
  expect(formulaRefs("=SUM(A1:A80)")).toBe(80);
});

it("counts a whole column as a wide formula", () => {
  expect(formulaRefs("=SUM(A:A)")).toBe(10_000);
  expect(formulaRefs('=SUM("A:A")')).toBe(0);
  expect(formulaRefs("=SUM(A1:A80)")).toBe(80);
  const costs = expensiveFormulas({
    0: { 0: { f: "=SUM(A:A)" }, 1: { f: '="secret-value"' } },
  });
  expect(costs).toEqual([{ address: "A1", refs: 10_000 }]);
  expect(JSON.stringify(costs)).not.toContain("secret-value");
  expect(JSON.stringify(costs)).not.toContain("SUM");
});

it("counts a whole row as a wide formula", () => {
  expect(formulaRefs("=SUM(1:1)")).toBe(10_000);
  expect(formulaRefs('=SUM("1:1")')).toBe(0);
  expect(formulaRefs("=SUM(A1:B2)")).toBe(4);
  const costs = expensiveFormulas({
    0: { 0: { f: "=SUM(1:1)" }, 1: { f: '="secret-value"' } },
  });
  expect(costs).toEqual([{ address: "A1", refs: 10_000 }]);
  expect(JSON.stringify(costs)).not.toContain("secret-value");
  expect(JSON.stringify(costs)).not.toContain("SUM");
});
