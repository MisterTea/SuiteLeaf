import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { chartId, projectCharts, watchRemoteCharts } from "../apps/web/src/collab/sheet-charts";
import { mirrorSheetCells } from "../apps/web/src/collab/sheet-cells";

describe("shared sheet charts", () => {
  it("stores a chart by id and removes only a listed chart", () => {
    expect(chartId("secret-value\ndues")).toBeNull();
    const first = projectCharts(new Map(), [], { charts: [{ id: "dues", title: "Dues", sheetId: "fees" }] }, {});
    expect(JSON.parse(first.charts.get("dues")!).title).toBe("Dues");
    const second = projectCharts(
      first.charts,
      first.removed,
      { charts: [{ id: "paths", title: "Paths", sheetId: "fees" }] },
      { removedChartIds: ["dues", "secret-value\npaths"] },
    );
    expect(second.charts.has("dues")).toBe(false);
    expect(second.removed.has("dues")).toBe(true);
    expect(JSON.parse(second.charts.get("paths")!).title).toBe("Paths");
    expect(JSON.stringify([...second.removed])).not.toContain("secret-value");

    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    mirrorSheetCells(local, {}, { charts: [{ id: "dues", title: "Dues" }] });
    expect(JSON.parse(remote.getMap("charts").get("dues")!).title).toBe("Dues");
    mirrorSheetCells(local, { role: "commenter", removedChartIds: ["dues"] }, { charts: [] });
    expect(remote.getMap("charts").get("dues")).toBeTruthy();
    const loop: { id: string; self?: unknown } = { id: "loop" };
    loop.self = loop;
    const skipped = projectCharts(
      new Map(),
      [],
      { charts: [null, "dues", { title: "Dues" }, loop] },
      { removedChartIds: "dues" },
    );
    expect(skipped.charts.size).toBe(0);
    expect(projectCharts(first.charts, [], {}, {}).charts.get("dues")).toBeTruthy();
  });

  it("gives the other person a chart and skips a chart that is not a chart", () => {
    const dues = {
      id: "dues",
      title: "Dues",
      type: "bar",
      source: { sheetId: "fees", startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
      sheetId: "fees",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    };
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const seen: { id: string; title?: string }[] = [];
    const stop = watchRemoteCharts(remote, (changes) => {
      for (const change of changes) seen.push({ id: change.id, title: change.chart?.title });
    });
    mirrorSheetCells(local, {}, { charts: [dues, { id: "secret-value\nx", title: "Dues" }] });
    remote.getMap("charts").set("bad", "{");
    remote.getMap("charts").set("secret-value\nx", "{}");
    remote.getMap("removedCharts").set("secret-value\nx", "1");
    remote.getMap("charts").set("dues", JSON.stringify({ ...dues, id: "other" }));
    expect(seen).toEqual([{ id: "dues", title: "Dues" }]);
    remote.getMap("removedCharts").set("dues", "1");
    expect(seen.at(-1)).toEqual({ id: "dues", title: undefined });
    remote.getMap("charts").delete("dues");
    expect(seen.at(-1)).toEqual({ id: "dues", title: undefined });
    remote.getMap("charts").set("dues", "");
    remote.getMap("removedCharts").set("dues", "0");
    stop();
    remote.getMap("charts").set("dues", JSON.stringify(dues));
    expect(seen).toHaveLength(3);
  });

  it("moves a chart with a row insert and leaves another sheet", () => {
    const dues = {
      id: "dues",
      title: "Dues",
      type: "bar",
      source: { sheetId: "fees", startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 },
      sheetId: "fees",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      excel: {
        series: [{ name: "Fees", values: { sheetId: "fees", startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }, color: "#000" }],
        legend: "bottom",
        markers: false,
        anchor: { fromColumn: 0, fromRow: 1, fromColumnOffset: 0, fromRowOffset: 0 },
      },
    };
    const beds = { ...dues, id: "beds", sheetId: "beds", source: { ...dues.source, sheetId: "beds" } };
    const shifted = projectCharts(
      new Map([
        ["dues", JSON.stringify(dues)],
        ["beds", JSON.stringify(beds)],
        ["bad", "secret-value"],
      ]),
      [],
      {},
      {
        mutations: [{
          id: "sheet.mutation.insert-row",
          params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
        }],
      },
    );
    const next = JSON.parse(shifted.charts.get("dues")!) as {
      source: { startRow: number; endRow: number };
      excel: { series: { values: { startRow: number } }[]; anchor: { fromRow: number } };
    };
    expect(next.source).toMatchObject({ startRow: 2, endRow: 3 });
    expect(next.excel.series[0].values.startRow).toBe(2);
    expect(next.excel.anchor.fromRow).toBe(2);
    expect(JSON.parse(shifted.charts.get("beds")!).source.startRow).toBe(1);
    expect(shifted.charts.get("bad")).toBe("secret-value");
    const removed = projectCharts(
      new Map([["dues", JSON.stringify(dues)]]),
      [],
      {},
      {
        mutations: [{
          id: "sheet.mutation.remove-row",
          params: { subUnitId: "fees", range: { startRow: 1, endRow: 2 } },
        }],
      },
    );
    expect(JSON.parse(removed.charts.get("dues")!).invalid).toBe(true);
    const column = projectCharts(
      new Map([["dues", JSON.stringify(dues)]]),
      [],
      {},
      {
        mutations: [{
          id: "sheet.mutation.insert-col",
          params: { subUnitId: "fees", range: { startColumn: 0, endColumn: 0 } },
        }],
      },
    );
    const across = JSON.parse(column.charts.get("dues")!) as {
      source: { startColumn: number; endColumn: number };
      excel: { anchor: { fromColumn: number } };
    };
    expect(across.source).toMatchObject({ startColumn: 1, endColumn: 2 });
    expect(across.excel.anchor.fromColumn).toBe(1);
    const above = projectCharts(
      new Map([["dues", JSON.stringify(dues)]]),
      [],
      {},
      {
        mutations: [
          { id: "sheet.mutation.remove-row", params: { subUnitId: "fees\n", range: { startRow: 0 } } },
          { id: "sheet.mutation.remove-row", params: { subUnitId: "fees", range: { startRow: 4, endRow: 20_000 } } },
          { id: "sheet.mutation.remove-row", params: { subUnitId: "fees", range: { startRow: 8, endRow: 8 } } },
          { id: "note", params: { subUnitId: "fees" } },
          { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: -1 } } },
          { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 1.5 } } },
          { id: "sheet.mutation.insert-row", params: { subUnitId: "fees" } },
          { id: "sheet.mutation.insert-row", params: { subUnitId: "", range: { startRow: 0 } } },
        ],
      },
    );
    expect(JSON.parse(above.charts.get("dues")!).source.startRow).toBe(1);
    const cut = projectCharts(
      new Map([["dues", JSON.stringify({
        ...dues,
        excel: { ...dues.excel, series: ["skip", { name: "Fees", color: "#000" }], anchor: { fromRow: 1 } },
      })]]),
      [],
      {},
      {
        mutations: [{
          id: "sheet.mutation.remove-row",
          params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
        }],
      },
    );
    expect(JSON.parse(cut.charts.get("dues")!).excel.anchor.fromRow).toBe(1);
    expect(projectCharts(new Map([["dues", "[]"]]), [], {}, {
      mutations: [{ id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 0 } } }],
    }).charts.get("dues")).toBe("[]");
  });
});
