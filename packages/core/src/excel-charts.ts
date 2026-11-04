import JSZip from "jszip";
import { parseRange, type ChartDefinition, type SheetFile } from "./index";
import { array, readXml, relationships } from "./office";

export async function readCharts(
  zip: JSZip,
  file: SheetFile,
  parts: Map<string, string>,
  ids: Map<string, string>,
  warnings: string[],
) {
  for (const [sheetId, part] of parts) {
    const sheetRels = await relationships(zip, part);
    for (const drawing of sheetRels.values()) {
      if (drawing.external || !drawing.type.endsWith("/drawing")) continue;
      try {
        const d = await readXml(zip, drawing.path),
          rels = await relationships(zip, drawing.path);
        const root = d.wsDr;
        const anchors = [
          ...array<any>(root?.twoCellAnchor),
          ...array<any>(root?.oneCellAnchor),
          ...array<any>(root?.absoluteAnchor),
        ];
        for (const anchor of anchors) {
          const chartRel =
            anchor.graphicFrame?.graphic?.graphicData?.chart?.["@_id"];
          const path = rels.get(chartRel)?.path;
          if (!path) continue;
          const x = await readXml(zip, path);
          const plot = x.chartSpace?.chart?.plotArea;
          const type = plot?.barChart
            ? "bar"
            : plot?.lineChart
              ? "line"
              : plot?.pieChart
                ? "pie"
                : plot?.scatterChart
                  ? "scatter"
                  : undefined;
          if (!type) {
            warnings.push("An Excel chart type could not be recreated.");
            continue;
          }
          const model =
            plot[
              type === "bar"
                ? "barChart"
                : type === "line"
                  ? "lineChart"
                  : type === "pie"
                    ? "pieChart"
                    : "scatterChart"
            ];
          const series = array<any>(model.ser);
          const refs = series
            .flatMap((s) => [
              s.cat?.strRef?.f ?? s.cat?.numRef?.f ?? s.xVal?.numRef?.f,
              s.val?.numRef?.f ?? s.yVal?.numRef?.f,
            ])
            .filter((v) => typeof v === "string") as string[];
          const parsed = refs
            .map((ref) => {
              const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(ref);
              if (!m) return;
              const sourceId = ids.get((m[1] ?? m[2]).replaceAll("''", "'"));
              if (!sourceId) return;
              try {
                return parseRange(m[3], sourceId);
              } catch {
                return;
              }
            })
            .filter(Boolean) as ReturnType<typeof parseRange>[];
          if (
            !parsed.length ||
            parsed.some((r) => r.sheetId !== parsed[0].sheetId)
          ) {
            warnings.push(
              "A chart with external or nonrectangular source data was not recreated.",
            );
            continue;
          }
          const hasCat = series.some(
            (s) => s.cat?.strRef?.f || s.cat?.numRef?.f || s.xVal?.numRef?.f,
          );
          const minCol = Math.min(...parsed.map((r) => r.startColumn));
          const startColumn = !hasCat && minCol > 0 ? minCol - 1 : minCol;
          const source = {
            sheetId: parsed[0].sheetId,
            startRow: Math.max(
              0,
              Math.min(...parsed.map((r) => r.startRow)) - 1,
            ),
            endRow: Math.max(...parsed.map((r) => r.endRow)),
            startColumn,
            endColumn: Math.max(...parsed.map((r) => r.endColumn)),
          };
          const isAbsolute = !anchor.from && !!anchor.pos;
          const posX = isAbsolute
            ? Math.round(Number(anchor.pos?.["@_x"] ?? 0) / 9525)
            : Number(anchor.from?.col ?? 3) * 100;
          const posY = isAbsolute
            ? Math.round(Number(anchor.pos?.["@_y"] ?? 0) / 9525)
            : Number(anchor.from?.row ?? 3) * 24;
          const width = isAbsolute
            ? Math.min(
                1000,
                Math.round(Number(anchor.ext?.["@_cx"] ?? 0) / 9525) || 880,
              )
            : 520;
          const height = isAbsolute
            ? Math.min(
                650,
                Math.round(Number(anchor.ext?.["@_cy"] ?? 0) / 9525) || 580,
              )
            : 340;
          const title = String(
            x.chartSpace?.chart?.title?.tx?.rich?.p?.r?.t ??
              x.chartSpace?.chart?.title?.tx?.strRef?.strCache?.pt?.v ??
              "",
          );
          const c: ChartDefinition = {
            id: crypto.randomUUID(),
            title,
            type,
            source,
            sheetId,
            x: isAbsolute ? Math.max(20, posX) : posX,
            y: isAbsolute ? Math.max(10, posY) : posY,
            width,
            height,
          };
          if (anchor.to && type === "line") {
            const importedSeries = series
              .map((s, index) => {
                const formula = s.val?.numRef?.f;
                const m =
                  typeof formula === "string"
                    ? /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(formula)
                    : null;
                const sourceId =
                  m && ids.get((m[1] ?? m[2]).replaceAll("''", "'"));
                return sourceId && m
                  ? {
                      name: String(s.tx?.v ?? `Series${index + 1}`),
                      values: parseRange(m[3], sourceId),
                      color: ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2"][
                        index % 4
                      ],
                    }
                  : null;
              })
              .filter(Boolean) as NonNullable<
              ChartDefinition["excel"]
            >["series"];
            if (importedSeries.length === series.length) {
              const point = (p: any, key: string) => Number(p?.[key] ?? 0);
              c.title = String(
                x.chartSpace?.chart?.title?.tx?.rich?.p?.r?.t ?? "",
              );
              c.excel = {
                series: importedSeries,
                legend: String(
                  x.chartSpace?.chart?.legend?.legendPos?.["@_val"] ?? "r",
                ),
                markers: model.marker?.["@_val"] !== "0",
                anchor: {
                  fromColumn: point(anchor.from, "col"),
                  fromRow: point(anchor.from, "row"),
                  fromColumnOffset: point(anchor.from, "colOff") / 9525,
                  fromRowOffset: point(anchor.from, "rowOff") / 9525,
                  toColumn: point(anchor.to, "col"),
                  toRow: point(anchor.to, "row"),
                  toColumnOffset: point(anchor.to, "colOff") / 9525,
                  toRowOffset: point(anchor.to, "rowOff") / 9525,
                },
              };
            }
          }
          file.content.charts.push(c);
        }
      } catch (e) {
        warnings.push(
          `A chart could not be recreated: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  if (file.content.charts.length)
    warnings.push(
      "Basic Excel charts are recreated from cell ranges; advanced chart styling and nonadjacent series may differ.",
    );
}
