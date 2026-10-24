import { expect, it } from "vitest";
import { extractMarpCharts } from "../apps/web/src/editors/slide-marp-charts";
it("reads literal Chart.js data without evaluating the surrounding script", () => {
  const result = extractMarpCharts([
    `window.sideEffect(); new Chart(document.getElementById('plot'), {
    type: 'scatter', data: { datasets: [{ data: [{x: -2, y: 3}, {x: 4, y: 5}] }] },
    options: { animation: false }
  });`,
  ]);
  expect(result).toEqual([
    {
      target: "plot",
      themed: false,
      config: {
        type: "scatter",
        data: {
          datasets: [
            {
              data: [
                { x: -2, y: 3 },
                { x: 4, y: 5 },
              ],
            },
          ],
        },
        options: { animation: false },
      },
    },
  ]);
});
it("understands data-only chart helper calls", () => {
  expect(
    extractMarpCharts(["CDLChart.bar('counts', ['A','B'], [12,18]);"]),
  ).toEqual([
    {
      target: "counts",
      themed: true,
      config: {
        type: "bar",
        data: { labels: ["A", "B"], datasets: [{ data: [12, 18] }] },
        options: { plugins: { legend: { display: false } } },
      },
    },
  ]);
});
it("rejects executable chart configuration values and prototype keys", () => {
  expect(() =>
    extractMarpCharts([
      "new Chart(document.getElementById('plot'), { type:'bar', data: stealData() });",
    ]),
  ).toThrow("literal data");
  expect(() =>
    extractMarpCharts([
      "new Chart(document.getElementById('plot'), { __proto__: { polluted: true } });",
    ]),
  ).toThrow("Invalid chart property");
  expect({}).not.toHaveProperty("polluted");
});
it("does not treat unrelated authored code as a chart", () => {
  expect(extractMarpCharts(["window.location='https://example.com';"])).toEqual(
    [],
  );
});
