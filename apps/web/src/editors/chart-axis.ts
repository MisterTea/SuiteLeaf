/** Which value axis a series uses. Axis 2 is the right-hand axis. */
export function seriesAxis(axis: number | undefined): "primary" | "secondary" {
  return axis === 2 ? "secondary" : "primary";
}

/**
 * The top of a value axis. A small series gets its own top so it is not
 * drawn against a much larger series.
 */
export function axisLimit(values: readonly number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  const maximum = Math.max(0, ...finite, 0);
  const step =
    Math.pow(10, Math.floor(Math.log10(maximum || 1))) * (maximum <= 20 ? 0.2 : 0.5);
  return Math.max(step, Math.ceil(maximum / step) * step);
}
