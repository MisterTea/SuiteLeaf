import { describe, expect, it } from "vitest";
import { valueTicks } from "../apps/web/src/analysis";

describe("chart value axis", () => {
  it("uses round steps that cover the data from zero", () => {
    expect(valueTicks([6000, 5200, 12000, 10800, 3000, 2400])).toEqual([
      0, 2000, 4000, 6000, 8000, 10000, 12000,
    ]);
    expect(valueTicks([6000, 13500, 3000, 1850])).toEqual([
      0, 2500, 5000, 7500, 10000, 12500, 15000,
    ]);
    expect(valueTicks([0.12, 0.47, 0.05])).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5,
    ]);
  });

  it("spans negative values and ignores text and blanks", () => {
    expect(valueTicks([-1500, 800, "Total", null, 1200])).toEqual([
      -1500, -1000, -500, 0, 500, 1000, 1500,
    ]);
    expect(valueTicks([-7, 13])).toEqual([-10, -5, 0, 5, 10, 15]);
  });

  it("leaves the axis to the chart when there is nothing to scale", () => {
    expect(valueTicks([])).toBeUndefined();
    expect(valueTicks([0, "n/a"])).toBeUndefined();
  });
});
