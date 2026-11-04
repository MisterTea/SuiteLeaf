import { describe, expect, it } from "vitest";
import { styledChartConfig } from "../apps/web/src/editors/slide-marp-chart-theme";

/** A canvas inside a slide whose theme sets the chart variables given. */
function host(vars: Record<string, string>, inSection = true) {
  const style = {
    fontFamily: "Willow",
    color: "#141414",
    getPropertyValue: (name: string) => vars[name] ?? "",
  };
  return {
    ownerDocument: { defaultView: { getComputedStyle: () => style } },
    closest: () => (inSection ? {} : null),
  } as unknown as HTMLElement;
}

const THEME = {
  "--chart-font-family": " Aspen ",
  "--text-primary": "#222222",
  "--chart-color-1": "#ff0000",
  "--chart-color-2": "rgb(0, 0, 255)",
};

type Styled = {
  data: { datasets: Record<string, unknown>[] };
  options: {
    color: string;
    font: { family: string };
    plugins: { legend: { position?: string; labels: { padding: number } } };
    scales?: { x: { grid: { display?: boolean; color: string } }; y: { grid: { display?: boolean } } };
  };
};

describe("charts drawn in the slide's theme", () => {
  it("leaves an unthemed chart exactly as written", () => {
    const config = { type: "bar", data: { datasets: [{ data: [1] }] } };
    const styled = styledChartConfig({ target: "c", config, themed: false }, host(THEME));
    expect(styled).toEqual(config);
    expect(styled).not.toBe(config);
  });

  it("colours a bar chart's datasets from the palette and hides the x grid", () => {
    const styled = styledChartConfig(
      {
        target: "c",
        themed: true,
        config: {
          type: "bar",
          data: { labels: ["a"], datasets: [{ data: [1, 2] }, { data: [3], backgroundColor: "#00ff00" }] },
          options: { plugins: { title: { text: "Sales" } }, scales: { y: { beginAtZero: true } } },
        },
      },
      host(THEME),
    ) as unknown as Styled;
    expect(styled.data.datasets[0]).toMatchObject({ backgroundColor: "#ff0000", borderColor: "#ff0000", borderWidth: 2 });
    expect(styled.data.datasets[1]).toMatchObject({ backgroundColor: "#00ff00", borderColor: "rgb(0, 0, 255)" });
    expect(styled.options).toMatchObject({ color: "#222222", font: { family: "Aspen", size: 16 } });
    expect(styled.options.scales?.x.grid.display).toBe(false);
    expect(styled.options.scales?.y.grid.display).toBeUndefined();
    expect(styled.options.scales?.x.grid.color).toBe("rgba(0,105,62,.1)");
    expect(styled.options).toMatchObject({ plugins: { title: { text: "Sales", color: "#222222" } }, scales: { y: { beginAtZero: true } } });
    expect(styled.options.plugins.legend.labels.padding).toBe(20);
  });

  it("gives lines a translucent fill, round charts a legend at the side, and points large dots", () => {
    const line = styledChartConfig(
      { target: "c", themed: true, config: { type: "line", data: { datasets: [{ data: [1] }, { data: [2] }] } } },
      host(THEME),
    ) as unknown as Styled;
    expect(line.data.datasets[0]).toMatchObject({ backgroundColor: "rgba(255,0,0,0.1)", tension: 0.3, pointRadius: 6 });
    expect(line.data.datasets[1]).toMatchObject({ backgroundColor: "rgb(0, 0, 255)" });

    const pie = styledChartConfig(
      { target: "c", themed: true, config: { type: "pie", data: { datasets: [{ data: [1, 2, 3] }] } } },
      host(THEME),
    ) as unknown as Styled;
    expect(pie.data.datasets[0]).toMatchObject({ backgroundColor: ["#ff0000", "rgb(0, 0, 255)", "#222222"], borderColor: "#d8d8d8" });
    expect(pie.options.plugins.legend).toMatchObject({ position: "right", labels: { padding: 15 } });
    expect(pie.options.scales).toBeUndefined();

    const scatter = styledChartConfig(
      { target: "c", themed: true, config: { type: "scatter", data: { datasets: [{}] } } },
      host({}, false),
    ) as unknown as Styled;
    expect(scatter.data.datasets[0]).toMatchObject({ backgroundColor: "#141414", pointRadius: 15 });
    expect(scatter.options.font.family).toBe("Willow");

    const empty = styledChartConfig(
      { target: "c", themed: true, config: { type: "radar", data: "nonsense", options: [] } },
      host(THEME),
    ) as unknown as Styled;
    expect(empty.data.datasets).toEqual([]);
  });
});
