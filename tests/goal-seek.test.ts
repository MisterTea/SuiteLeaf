import { describe, expect, it } from "vitest";
import { goalSeek, seekProgressText, writeGoalSeek } from "../packages/core/src/goal-seek";

describe("goal seek", () => {
  it("finds the input that reaches the target and leaves the cell alone", () => {
    const cell = { v: 3 };
    const result = goalSeek({
      evaluate: (guess) => guess * 2,
      target: 10,
      start: cell.v,
      low: 0,
      high: 20,
    });
    expect(cell.v).toBe(3);
    expect(result.ok).toBe(true);
    expect(result.guess).toBeCloseTo(5, 5);
    expect(result.value).toBeCloseTo(10, 5);
  });

  it("keeps a start that already reaches the target", () => {
    let calls = 0;
    const result = goalSeek({
      evaluate: (guess) => {
        calls += 1;
        return guess * 2;
      },
      target: 10,
      start: 5,
      low: 0,
      high: 20,
    });
    expect(result).toMatchObject({ ok: true, reason: "solved", guess: 5, steps: 1 });
    expect(result.value).toBeCloseTo(10, 5);
    expect(calls).toBe(1);
  });

  it("reports an unreachable target and does not invent a guess", () => {
    const result = goalSeek({
      evaluate: (guess) => guess * guess,
      target: -1,
      start: 4,
      low: 0,
      high: 10,
    });
    expect(result).toMatchObject({ ok: false, reason: "infeasible", guess: 4 });
    const note = seekProgressText(result);
    expect(note).toBe(
      `No input reaches that target within 0.000001. The search tried ${result.steps} steps.`,
    );
    expect(note).not.toContain("secret-value");
  });

  it("reports each midpoint and leaves the formula text out", () => {
    const steps: number[] = [];
    const hidden = "secret-value";
    const result = goalSeek({
      evaluate: (guess) => {
        expect(hidden).toBe("secret-value");
        return guess * 2;
      },
      target: 10,
      start: 3,
      low: 0,
      high: 20,
      onProgress: (progress) => steps.push(progress.step),
    });
    expect(steps[0]).toBe(1);
    expect(steps.at(-1)).toBe(result.steps);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(JSON.stringify(steps)).not.toContain("secret");
    expect(seekProgressText(result)).toBe(`The search reached the target in ${result.steps} steps.`);
  });

  it("stops before trying a guess when cancelled", () => {
    let calls = 0;
    const result = goalSeek({
      evaluate: () => {
        calls += 1;
        return 0;
      },
      target: 1,
      start: 2,
      low: 0,
      high: 10,
      shouldStop: () => true,
    });
    expect(result).toEqual({
      ok: false,
      reason: "cancelled",
      guess: 2,
      value: null,
      steps: 0,
    });
    expect(calls).toBe(0);
  });

  it("writes a solved guess and leaves a formula or a failed search alone", () => {
    const solved = goalSeek({
      evaluate: (guess) => guess * 2,
      target: 10,
      start: 3,
      low: 0,
      high: 20,
    });
    const grid = {
      "0": { "0": { v: 3 }, "1": { v: 0, f: "=A1*2" } },
    };
    const placed = writeGoalSeek(grid, { row: 0, column: 0 }, solved);
    expect(placed.wrote).toBe(true);
    expect(placed.grid["0"]["0"].v).toBeCloseTo(5, 5);
    expect(grid["0"]["0"].v).toBe(3);
    const blocked = writeGoalSeek(grid, { row: 0, column: 1 }, solved);
    expect(blocked.wrote).toBe(false);
    expect(blocked.error).toContain("formula");
    expect(blocked.grid).toBe(grid);
    const missed = goalSeek({
      evaluate: (guess) => guess,
      target: -1,
      start: 4,
      low: 0,
      high: 10,
    });
    const kept = writeGoalSeek(grid, { row: 0, column: 0 }, missed);
    expect(kept.wrote).toBe(false);
    expect(kept.grid).toBe(grid);
  });
});
