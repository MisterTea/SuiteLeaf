/** Columns stay on the left. The last series, or any series marked axis 2, is the line. */
export function comboSplit<T extends { axis?: number }>(
  series: readonly T[],
): { columns: T[]; line: T[] } {
  if (series.length < 2) return { columns: [...series], line: [] };
  const line = series.filter((item) => item.axis === 2);
  if (line.length > 0) return { columns: series.filter((item) => item.axis !== 2), line };
  return { columns: series.slice(0, -1), line: series.slice(-1) };
}

/** A column chart plus a line chart, with the line on value axis 300. */
export function comboChartXml(columnSeries: string, lineSeries: string): string {
  const columns = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${columnSeries}<c:axId val="100"/><c:axId val="200"/></c:barChart>`;
  if (!lineSeries) return columns;
  return `${columns}<c:lineChart><c:grouping val="standard"/>${lineSeries}<c:axId val="100"/><c:axId val="300"/></c:lineChart><c:valAx><c:axId val="300"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="r"/><c:crossAx val="100"/><c:crosses val="max"/></c:valAx>`;
}
