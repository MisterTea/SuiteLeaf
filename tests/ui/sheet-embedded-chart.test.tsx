// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChartDefinition } from "@suiteleaf/core";

vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 480, height: 320 }),
}));

const { EmbeddedChart, charts } = await import("../../apps/web/src/editors/sheet-embedded-chart");
const { ExcelLineChart } = await import("../../apps/web/src/editors/sheet-excel-line-chart");

afterEach(() => {
  cleanup();
  charts.clear();
});

const sales = [
  ["Month", "Sales", "Cost"],
  ["Jan", 1200, 400],
  ["Feb", 1500, null],
  ["Mar", 900, 300],
];

function chart(type: ChartDefinition["type"], extra: Partial<ChartDefinition> = {}): ChartDefinition {
  return {
    id: `chart-${type}`,
    title: `${type} chart`,
    type,
    source: { sheetId: "s1", startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 },
    sheetId: "s1",
    x: 0,
    y: 0,
    width: 480,
    height: 320,
    ...extra,
  } as ChartDefinition;
}

function show(definition: ChartDefinition, values: unknown[][] = sales, numberFormats = ["", "$#,##0", ""]) {
  charts.set(definition.id, { definition, values: values as never, numberFormats });
  return render(<EmbeddedChart data={{ chartId: definition.id }} />);
}

it("waits for its data, then follows the chart's updates", () => {
  const view = render(<EmbeddedChart data={{ chartId: "late" }} />);
  expect(view.container.textContent).toBe("Loading chart…");
  act(() => {
    charts.set("late", { definition: chart("bar", { id: "late", title: "Late" }), values: sales as never, numberFormats: [] });
    window.dispatchEvent(new Event("chart:late"));
  });
  expect(screen.getByText("Late")).toBeTruthy();
  render(<EmbeddedChart />);
  expect(screen.getAllByText("Loading chart…")).toHaveLength(1);
});

it("explains a chart whose source is gone", () => {
  show(chart("bar", { invalid: true, title: "Lost" }));
  const box = document.querySelector(".suiteleaf-chart")!;
  expect(box.getAttribute("data-chart-id")).toBe("chart-bar");
  expect(box.textContent).toBe("LostSource range unavailable. Edit this chart to select a new range.");
});

it.each(["bar", "line", "area"] as const)("draws a %s chart with formatted value ticks and a legend", (type) => {
  show(chart(type));
  const box = document.querySelector(".suiteleaf-chart")!;
  expect(box.getAttribute("aria-label")).toBe(`Chart: ${type} chart`);
  expect(box.textContent).toContain("$1,500");
  expect(box.textContent).toContain("Sales");
  expect(box.textContent).toContain("Cost");
  expect(box.textContent).toContain("Feb");
});

it("draws pie, scatter, combo, stacked, histogram, and waterfall charts", () => {
  for (const type of ["pie", "scatter", "combo", "stacked", "histogram", "waterfall"] as const) {
    const view = show(chart(type), type === "scatter" ? [["x", "y"], [1, 2], [3, 4], ["a", 1]] : sales);
    expect(view.container.querySelector(".suiteleaf-chart")!.textContent).toContain(`${type} chart`);
    expect(view.container.querySelector(".recharts-wrapper")).toBeTruthy();
    view.unmount();
  }
  const pie = show(chart("pie"));
  expect(pie.container.textContent).toContain("$1,200");
});

it("says when a waterfall's stated total does not match its steps", () => {
  show(chart("waterfall"), [["Step", "Change"], ["Start", 10], ["Drop", -4], ["Total", 9]]);
  const box = document.querySelector(".suiteleaf-chart")!;
  expect(box.getAttribute("aria-label")).toMatch(/^Chart: waterfall chart\. .+/);
  expect(box.querySelector("p")!.textContent).not.toBe("");
});

const line = (extra: Record<string, unknown> = {}) =>
  chart("line", {
    title: "Imported",
    excel: {
      series: [
        { name: "North", values: { sheetId: "s1", startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }, color: "#ff0000" },
        { name: "South", values: { sheetId: "s1", startRow: 0, endRow: 2, startColumn: 1, endColumn: 1 }, color: "#0000ff", axis: 2 },
      ],
      legend: "r",
      markers: true,
      anchor: { fromColumn: 0, fromRow: 0, fromColumnOffset: 0, fromRowOffset: 0, toColumn: 1, toRow: 1, toColumnOffset: 0, toRowOffset: 0 },
      ...extra,
    },
  } as never);

it("routes an imported Excel line chart to its own drawing", () => {
  charts.set("chart-line", {
    definition: line(),
    values: [],
    numberFormats: [],
    excelValues: [
      [10, 20, 15],
      [1, 2, 3],
    ],
  });
  render(<EmbeddedChart data={{ chartId: "chart-line" }} />);
  expect(screen.getByLabelText("Imported Excel line chart")).toBeTruthy();
});

it("draws an Excel line chart with markers, a right legend, and a secondary axis", () => {
  render(<ExcelLineChart chart={line()} series={[[10, 20, "x", 15], [1, 2, 3]]} />);
  const svg = screen.getByLabelText("Imported Excel line chart");
  expect(svg.getAttribute("data-secondary-axis")).toBe("true");
  const lines = [...svg.querySelectorAll("polyline")];
  expect(lines.map((item) => item.getAttribute("stroke"))).toEqual(["#ff0000", "#0000ff"]);
  expect(lines[0].getAttribute("points")!.split(" ")).toHaveLength(3);
  expect(svg.querySelectorAll("rect[width='10']")).toHaveLength(3);
  expect(svg.querySelectorAll("path")).toHaveLength(3 + 1);
  expect(svg.textContent).toContain("North");
  expect(svg.textContent).toContain("South");
  expect([...svg.querySelectorAll("text")].map((text) => text.textContent)).toEqual(expect.arrayContaining(["1", "2", "3", "4"]));
});

it("draws a primary-only Excel line chart without markers or a legend", () => {
  render(
    <ExcelLineChart
      chart={line({ markers: false, legend: "b", series: [{ name: "Only", values: {}, color: "#00aa00" }] })}
      series={[[100, 250]]}
    />,
  );
  const svg = screen.getByLabelText("Imported Excel line chart");
  expect(svg.getAttribute("data-secondary-axis")).toBe("false");
  expect(svg.querySelectorAll("rect")).toHaveLength(1);
  expect(svg.textContent).not.toContain("Only");
  expect(svg.textContent).toContain("250");
});

it("draws a BIFF line chart with titled axes, a data table, every marker, and notes", () => {
  const definition = line({
    biff: {
      axes: [{}, { min: 0, max: 10, step: 5 }],
      categories: ["Q1", "Q2"],
      axisTitles: ["Units", "Rate"],
      annotations: ["A note long enough to wrap onto a second line of text"],
      dataTable: true,
    },
    series: [3, 8, 4, 1, 0].map((marker, index) => ({
      name: `S${index}`,
      values: {},
      color: `#00000${index}`,
      axis: index === 1 ? 1 : 0,
      marker,
      numberFormat: index === 0 ? "0.0" : undefined,
    })),
  });
  render(<ExcelLineChart chart={definition} series={[[1200, 2400], [5, 7], [1, "x"], [2, 3000], [4, 5]]} />);
  const svg = screen.getByLabelText("Imported");
  expect(svg.textContent).toContain("Imported");
  expect(svg.textContent).toContain("Units");
  expect(svg.textContent).toContain("Rate");
  expect(svg.textContent).toContain("Q2");
  expect(svg.textContent).toContain("1200.0");
  expect(svg.textContent).toContain("2400.0");
  expect(svg.textContent).toContain("3,000");
  expect(svg.querySelectorAll("circle")).toHaveLength(2);
  expect(svg.querySelectorAll("tspan")).toHaveLength(3);
  expect(svg.querySelectorAll("polyline")).toHaveLength(5);
});

it("draws a BIFF line chart's legend under the plot when there is no data table", () => {
  const definition = line({
    biff: { axes: [{}], categories: [], axisTitles: [""], annotations: [], dataTable: false },
    series: ["A", "B", "C", "D"].map((name) => ({ name, values: {}, color: "#123456" })),
  });
  render(<ExcelLineChart chart={definition} series={[[1, 2, 3], [], [], []]} />);
  const svg = screen.getByLabelText("Imported");
  const legend = [...svg.querySelectorAll("g[transform]")].map((group) => group.getAttribute("transform"));
  expect(legend).toHaveLength(4);
  expect(legend[3]).toMatch(/,\d+(\.\d+)?\)$/);
  expect(svg.textContent).toContain("3");
});
