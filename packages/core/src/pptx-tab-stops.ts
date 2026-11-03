/** A DrawingML tab stop. `pos` is in the unit `paragraphTabStops` mapped to. */
export type TabStop = { pos: number; align: "l" | "ctr" | "r" | "dec" };

/** Stops written on a paragraph. Positions are converted with `map` (EMU to points). */
export function paragraphTabStops(pPrXml: string, map: (emu: number) => number): TabStop[] {
  const list = /<a:tabLst\b[\s\S]*?<\/a:tabLst>/.exec(pPrXml)?.[0] ?? "";
  const stops: TabStop[] = [];
  for (const tag of list.matchAll(/<a:tab\b[^>]*>/g)) {
    const pos = Number(/\bpos="(\d+(?:\.\d+)?)"/.exec(tag[0])?.[1] ?? "");
    if (!(pos >= 0)) continue;
    const raw = /\balgn="([^"]+)"/.exec(tag[0])?.[1] ?? "l";
    const align: TabStop["align"] =
      raw === "ctr" || raw === "r" || raw === "dec" ? raw : "l";
    stops.push({ pos: map(pos), align });
  }
  return stops;
}

/**
 * How far a tab advances from `x`.
 * The next stop is the nearest default interval or explicit stop past `x`.
 * Left text starts on the stop. Center, right, and decimal use the following text.
 */
export function tabAdvance(
  x: number,
  following: string,
  stops: readonly TabStop[],
  interval: number,
  widthOf: (text: string) => number,
): number {
  let best = Number.POSITIVE_INFINITY;
  let align: TabStop["align"] = "l";
  if (interval > 0) {
    const step = Math.floor((x + 0.01) / interval) + 1;
    best = step * interval;
  }
  for (const stop of stops) {
    if (stop.pos > x + 0.01 && stop.pos < best) {
      best = stop.pos;
      align = stop.align;
    }
  }
  if (!Number.isFinite(best)) return 0;
  let start = best;
  if (align === "r") start = best - widthOf(following);
  else if (align === "ctr") start = best - widthOf(following) / 2;
  else if (align === "dec") {
    const dot = following.search(/[.]/);
    start = best - widthOf(dot >= 0 ? following.slice(0, dot) : following);
  }
  return Math.max(0, start - x);
}
