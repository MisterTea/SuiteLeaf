import { describe, expect, it } from "vitest";
import { axisLimit, seriesAxis } from "../apps/web/src/editors/chart-axis";

describe("secondary chart axis", () => {
  it("scales a small series separately from a large one", () => {
    expect(seriesAxis(undefined)).toBe("primary");
    expect(seriesAxis(1)).toBe("primary");
    expect(seriesAxis(2)).toBe("secondary");
    const dues = axisLimit([40, 15]);
    const rate = axisLimit([0.2, 0.4]);
    expect(dues).toBeGreaterThan(rate);
    expect(rate).toBeGreaterThanOrEqual(0.4);
    expect(rate).toBeLessThan(5);
  });
});
