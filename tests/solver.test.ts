import { expect, it } from "vitest";
import { solve, writeSolver } from "../packages/core/src/solver";

it("solves two bounded inputs and leaves the starts unchanged when the target cannot be reached", () => {
  const variables = [
    { start: 0, low: 0, high: 4 },
    { start: 0, low: 0, high: 6 },
  ];
  const solved = solve({
    evaluate: (values) => values[0] + values[1],
    target: 9,
    variables,
  });
  expect(solved.ok).toBe(true);
  expect(solved.values[0] + solved.values[1]).toBeCloseTo(9, 5);
  expect(solved.values[0]).toBeGreaterThanOrEqual(0);
  expect(solved.values[0]).toBeLessThanOrEqual(4);
  expect(solved.values[1]).toBeGreaterThanOrEqual(0);
  expect(solved.values[1]).toBeLessThanOrEqual(6);
  expect(variables[0].start).toBe(0);
  expect(variables[1].start).toBe(0);

  const missed = solve({
    evaluate: (values) => values[0] + values[1],
    target: 9,
    variables: [
      { start: 0, low: 0, high: 1 },
      { start: 1, low: 0, high: 1 },
    ],
  });
  expect(missed).toMatchObject({ ok: false, reason: "infeasible", values: [0, 1] });

  const cancelled = solve({
    evaluate: (values) => values[0] + values[1],
    target: 9,
    variables,
    shouldStop: () => true,
  });
  expect(cancelled).toMatchObject({ ok: false, reason: "cancelled", values: [0, 0] });

  const grid = { "0": { "0": { v: 0 }, "1": { v: 0, f: "=A1" } } };
  const refused = writeSolver(grid, [{ row: 0, column: 0 }, { row: 0, column: 1 }], solved);
  expect(refused.wrote).toBe(false);
  expect(grid["0"]["0"]).toEqual({ v: 0 });
  const open = { "0": { "0": { v: 0 }, "1": { v: 0 } } };
  const written = writeSolver(open, [{ row: 0, column: 0 }, { row: 0, column: 1 }], solved);
  expect(written.wrote).toBe(true);
  expect(written.grid["0"]["0"]?.v).toBe(solved.values[0]);
  expect(written.grid["0"]["1"]?.v).toBe(solved.values[1]);
  expect(open["0"]["0"]).toEqual({ v: 0 });
  const skipped = writeSolver(open, [{ row: 0, column: 0 }, { row: 0, column: 1 }], missed);
  expect(skipped.wrote).toBe(false);
  expect(skipped.grid).toBe(open);
});

it("keeps starts that already reach the target", () => {
  let calls = 0;
  const variables = [
    { start: 3, low: 0, high: 4 },
    { start: 6, low: 0, high: 6 },
  ];
  const solved = solve({
    evaluate: (values) => {
      calls += 1;
      return values[0] + values[1];
    },
    target: 9,
    variables,
  });
  expect(solved).toMatchObject({
    ok: true,
    reason: "solved",
    values: [3, 6],
    value: 9,
    tried: 1,
  });
  expect(solved.notice).toBe("The search reached the target.");
  expect(calls).toBe(1);
  expect(variables[0].start).toBe(3);
});

it("accepts only a whole number and leaves the start when none reaches the target", () => {
  const variables = [{ start: 1, low: 0, high: 5, integer: true }];
  const solved = solve({
    evaluate: (values) => values[0] * 2,
    target: 6,
    variables,
  });
  expect(solved).toMatchObject({ ok: true, reason: "solved", values: [3], value: 6 });
  expect(solved.notice).toBe("The search reached the target.");
  expect(solved.tried).toBe(4);
  expect(variables[0].start).toBe(1);

  const tries: number[] = [];
  const missed = solve({
    evaluate: (values) => {
      const hidden = "secret-value";
      expect(hidden).toBe("secret-value");
      return values[0] * 2;
    },
    target: 5,
    variables,
    onProgress: (progress) => tries.push(progress.tried),
  });
  expect(missed).toMatchObject({ ok: false, reason: "infeasible", values: [1], value: null });
  expect(missed.notice).toBe("No inputs inside the bounds reach the target. The search tried 6 times.");
  expect(missed.tried).toBe(6);
  expect(tries).toEqual([1, 2, 3, 4, 5, 6]);
  expect(JSON.stringify(missed)).not.toContain("secret");

  const wide = solve({
    evaluate: (values) => values[0],
    target: 1,
    variables: [{ start: 0, low: 0, high: 1000, integer: true }],
  });
  expect(wide).toMatchObject({ ok: false, reason: "infeasible", values: [0], value: null, tried: 0 });
  expect(wide.notice).toBe(
    "That whole-number span is too wide to search. The start was left as it was.",
  );

  const grid = { "0": { "0": { v: "secret-value" } } };
  const written = writeSolver(grid, [{ row: 0, column: 0 }], solved);
  expect(written.wrote).toBe(true);
  expect(written.grid["0"]["0"]?.v).toBe(3);
  expect(grid["0"]["0"]).toEqual({ v: "secret-value" });
  expect(JSON.stringify(solved)).not.toContain("secret");
});

it("rejects a guess that breaks a constraint and keeps one that meets it", () => {
  const variables = [
    { start: 0, low: 0, high: 10 },
    { start: 0, low: 0, high: 10 },
  ];
  const solved = solve({
    evaluate: (values) => values[0] + values[1],
    target: 9,
    variables,
    holds: (values) => values[0] <= 3,
  });
  expect(solved.ok).toBe(true);
  expect(solved.values[0]).toBeLessThanOrEqual(3);
  expect(solved.values[0] + solved.values[1]).toBeCloseTo(9, 5);
  expect(variables[0].start).toBe(0);

  const blocked = solve({
    evaluate: (values) => values[0],
    target: 4,
    variables: [{ start: 4, low: 0, high: 6, integer: true }],
    holds: (values) => values[0] <= 2,
  });
  expect(blocked).toMatchObject({ ok: false, reason: "infeasible", values: [4] });
  expect(blocked.notice).toBe(
    "No inputs inside the bounds meet the constraint and the target. The search tried 7 times.",
  );
  expect(blocked.notice).not.toContain("secret-value");

  const thrown = solve({
    evaluate: (values) => values[0] + values[1],
    target: 9,
    variables,
    holds: () => {
      throw new Error("secret-value");
    },
  });
  expect(thrown.ok).toBe(false);
  expect(thrown.notice).not.toContain("secret-value");
  expect(variables[0].start).toBe(0);
});
