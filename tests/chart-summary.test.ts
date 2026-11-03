import { describe, expect, it } from "vitest";
import { assignComboAxes, chartSummary, seriesFromHeaders } from "../packages/core/src/chart-summary";

describe("chart summary", () => {
  it("names the chart, the series, and the categories without the cell values", () => {
    const summary = chartSummary({
      title: "Plot fees",
      type: "combo",
      series: [
        { name: "Dues", axis: 1 },
        { name: "Rate", axis: 2 },
      ],
      categories: ["North", "South"],
      legend: "bottom",
    });
    expect(summary).toBe(
      "Combo chart Plot fees. Series Dues and Rate. Categories North and South. Right axis Rate. Legend bottom.",
    );
    expect(summary).not.toContain("40");
    expect(summary).not.toContain("#112233");

    const invalid = chartSummary({
      title: " ",
      type: "waterfall",
      invalid: true,
    });
    expect(invalid).toBe(
      "Waterfall chart Untitled chart. This chart is marked invalid. No series names.",
    );
  });

  it("puts the last combo series on the right axis when none is assigned", () => {
    const stored = [
      { name: "Dues", axis: undefined, color: "#112233" },
      { name: "Rate" },
    ];
    const assigned = assignComboAxes(stored);
    expect(assigned.map((item) => ({ name: item.name, axis: item.axis }))).toEqual([
      { name: "Dues", axis: 1 },
      { name: "Rate", axis: 2 },
    ]);
    expect(stored[0].axis).toBeUndefined();
    expect(chartSummary({ title: "Plot fees", type: "combo", series: assigned })).toBe(
      "Combo chart Plot fees. Series Dues and Rate. Right axis Rate.",
    );
    expect(chartSummary({ title: "Plot fees", type: "combo", series: assigned })).not.toContain(
      "#112233",
    );
    expect(seriesFromHeaders(["Plot", "Dues", "Rate"])).toEqual([
      { name: "Dues", axis: 1 },
      { name: "Rate", axis: 2 },
    ]);
    expect(seriesFromHeaders(["Plot", "Dues"])).toEqual([{ name: "Dues", axis: 1 }]);
  });
});