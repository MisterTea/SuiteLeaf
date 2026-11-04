import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import {
  mirrorSheetCells,
  projectNamedRanges,
  projectSheetCells,
  projectValidationRules,
  sheetCellKey,
  sheetCellRecords,
  sheetNameChanges,
  shiftFormula,
  watchRemoteNamedRanges,
  watchRemoteSheetCells,
  watchRemoteSheetNames,
  watchRemoteValidation,
  workbookStyles,
  worksheetName,
} from "../apps/web/src/collab/sheet-cells";

function edit(sheetId: unknown, value: unknown, row = 0, column = 0) {
  return {
    kind: "sheet",
    mutations: [
      {
        id: "sheet.mutation.set-range-values",
        params: {
          subUnitId: sheetId,
          range: { startRow: row, startColumn: column, endRow: row, endColumn: column },
          value,
        },
      },
    ],
  };
}

describe("sheet collaboration cells", () => {
  it("keeps A1 on two worksheets apart", () => {
    const fees = sheetCellRecords(edit("fees", { v: "North" }));
    const beds = sheetCellRecords(edit("beds", { v: "West" }));
    expect(fees).toHaveLength(1);
    expect(beds).toHaveLength(1);
    expect(fees[0].key).not.toBe(beds[0].key);
    expect(fees[0].json).toBe(JSON.stringify({ v: "North" }));
    expect(beds[0].json).toBe(JSON.stringify({ v: "West" }));

    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const arrived: { sheetId: string; value: unknown }[] = [];
    const stop = watchRemoteSheetCells(local, (writes) => {
      for (const write of writes) arrived.push({ sheetId: write.sheetId, value: write.value });
    });
    mirrorSheetCells(local, edit("fees", { v: "North" }));
    expect(arrived).toEqual([]);
    mirrorSheetCells(remote, edit("beds", { v: "West" }));
    expect(arrived).toEqual([{ sheetId: "beds", value: { v: "West" } }]);
    expect(local.getMap("cells").size).toBe(2);
    stop();
    mirrorSheetCells(remote, edit("fees", { v: "Ripe" }));
    expect(arrived).toEqual([{ sheetId: "beds", value: { v: "West" } }]);
  });

  it("does not store a cell that has no worksheet or a remote apply", () => {
    expect(sheetCellRecords(edit(undefined, { v: "North" }))).toEqual([]);
    expect(sheetCellRecords(edit("fees\nsecret-value", { v: "North" }))).toEqual([]);
    expect(JSON.stringify(sheetCellRecords(edit("secret-value\nbeds", { v: "North" })))).not.toContain(
      "secret-value",
    );
    const remote = edit("fees", { v: "North" });
    (remote.mutations[0].params as { suiteleafRemote?: boolean }).suiteleafRemote = true;
    expect(sheetCellRecords(remote)).toEqual([]);
    const broken = new Y.Doc();
    const applied: unknown[] = [];
    const stop = watchRemoteSheetCells(broken, (writes) => applied.push(writes));
    broken.getMap<string>("cells").set("fees\u001f0\u001f0", "{");
    broken.getMap<string>("cells").set("0:0", JSON.stringify({ v: "North" }));
    const kept = sheetCellRecords(edit("fees", { v: "North" }))[0].key;
    broken.getMap<string>("cells").set(kept, JSON.stringify({ v: "North" }));
    broken.getMap<string>("cells").delete(kept);
    expect(applied).toEqual([
      [{ sheetId: "fees", row: 0, column: 0, value: { v: "North" } }],
      [{ sheetId: "fees", row: 0, column: 0, value: null }],
    ]);
    stop();
  });

  it("skips a cell that cannot be addressed", () => {
    const loop: { self?: unknown } = {};
    loop.self = loop;
    expect(sheetCellRecords(null)).toEqual([]);
    expect(sheetCellRecords("beds")).toEqual([]);
    expect(sheetCellRecords({})).toEqual([]);
    expect(sheetCellRecords({ mutations: "secret-value" })).toEqual([]);
    expect(JSON.stringify(sheetCellRecords({ mutations: "secret-value" }))).not.toContain("secret-value");
    expect(sheetCellRecords({ mutations: [null, { params: null }, { params: "North" }] })).toEqual([]);
    expect(sheetCellRecords({ mutations: [{ params: { subUnitId: "fees" } }] })).toEqual([]);
    expect(sheetCellRecords({ mutations: [{ params: { subUnitId: "fees", range: "A1" } }] })).toEqual([]);
    expect(sheetCellRecords(edit("fees", { v: "North" }, 1.5, 0))).toEqual([]);
    expect(sheetCellRecords(edit("fees", { v: "North" }, -1, 0))).toEqual([]);
    expect(sheetCellRecords(edit("fees", { v: "North" }, 0, 16_384))).toEqual([]);
    expect(sheetCellRecords(edit("", { v: "North" }))).toEqual([]);
    expect(sheetCellRecords(edit("f".repeat(81), { v: "North" }))).toEqual([]);
    expect(sheetCellRecords(edit(7, { v: "North" }))).toEqual([]);
    expect(
      sheetCellRecords({
        mutations: [{ params: { subUnitId: "fees", range: { startRow: "0", startColumn: 0 }, value: "North" } }],
      }),
    ).toEqual([]);
    expect(
      sheetCellRecords({
        mutations: [{ params: { subUnitId: "fees", range: { startRow: 0, startColumn: 0 }, cellValue: { v: "North" } } }],
      })[0].json,
    ).toBe(JSON.stringify({ v: "North" }));
    expect(
      sheetCellRecords({
        mutations: [{ params: { subUnitId: "fees", range: { startRow: 0, startColumn: 0 } } }],
      }),
    ).toEqual([]);
    expect(
      sheetCellRecords({
        mutations: [{ params: { subUnitId: "fees", range: { startRow: 0, startColumn: 0 }, value: undefined } }],
      }),
    ).toEqual([]);
    expect(sheetCellRecords(edit("fees", loop))).toEqual([]);
  });

  it("stores each cell of a paste on its own worksheet", () => {
    const records = sheetCellRecords({
      mutations: [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            subUnitId: "fees",
            range: { startRow: 1, startColumn: 0, endRow: 2, endColumn: 1 },
            value: [
              [{ v: "North" }, { v: 10 }],
              [{ v: "West" }, { f: "=A2" }],
            ],
          },
        },
      ],
    });
    const byKey = new Map(records.map((record) => [record.key, record.json]));
    expect(byKey.get(sheetCellKey("fees", 1, 0)!)).toBe(JSON.stringify({ v: "North" }));
    expect(byKey.get(sheetCellKey("fees", 1, 1)!)).toBe(JSON.stringify({ v: 10 }));
    expect(byKey.get(sheetCellKey("fees", 2, 1)!)).toBe(JSON.stringify({ f: "=A2" }));
    expect(byKey.has(sheetCellKey("beds", 1, 0)!)).toBe(false);
  });

  it("moves cells and formula refs when a row is inserted or deleted", () => {
    const feesA1 = sheetCellKey("fees", 0, 0)!;
    const feesA2 = sheetCellKey("fees", 1, 0)!;
    const feesA3 = sheetCellKey("fees", 2, 0)!;
    const bedsA2 = sheetCellKey("beds", 1, 0)!;
    const before = new Map<string, string>([
      [feesA1, JSON.stringify({ v: "North" })],
      [feesA2, JSON.stringify({ f: '=A1&" A2"' })],
      [bedsA2, JSON.stringify({ f: "=Fees!A2" })],
      [sheetCellKey("beds", 2, 0)!, JSON.stringify({ f: "=Other!A2" })],
    ]);
    const inserted = projectSheetCells(before, {
      mutations: [
        {
          id: "sheet.mutation.insert-row",
          params: { subUnitId: "fees", range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 } },
        },
      ],
    });
    expect(inserted.get(feesA1)).toBe(JSON.stringify({ v: "North" }));
    expect(inserted.get(feesA2)).toBeUndefined();
    expect(inserted.get(feesA3)).toBe(JSON.stringify({ f: '=A1&" A2"' }));
    expect(inserted.get(bedsA2)).toBe(JSON.stringify({ f: "=Fees!A3" }));
    const named = projectSheetCells(
      new Map([[bedsA2, JSON.stringify({ f: "=Plots!A2" })]]),
      {
        mutations: [
          {
            id: "sheet.mutation.insert-row",
            params: { subUnitId: "fees", range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 } },
          },
        ],
      },
      [["fees", "Plots"]],
    );
    expect(named.get(bedsA2)).toBe(JSON.stringify({ f: "=Plots!A3" }));
    expect(inserted.get(sheetCellKey("beds", 2, 0)!)).toBe(JSON.stringify({ f: "=Other!A2" }));
    expect(shiftFormula('=A1&" A2"', "row", 1, 1, false)).toBe('=A1&" A2"');
    expect(shiftFormula("=Fees!A1", "row", 0, 1, true, "fees")).toBe("=#REF!");
    expect(shiftFormula("='fees'!A2", "row", 0, 1, false, "fees")).toBe("='fees'!A3");
    expect(shiftFormula("=A2", "row", 0, 1, false, "fees", true)).toBe("=A2");
    expect(shiftFormula("=Fees!B2", "column", 0, 1, false, "fees")).toBe("=Fees!C2");
    expect(shiftFormula("=Fees!A2", "row", 0, 1, false, "secret-\nvalue")).toBe("=Fees!A2");

    const deleted = projectSheetCells(inserted, {
      mutations: [
        {
          id: "sheet.mutation.remove-row",
          params: { subUnitId: "fees", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } },
        },
      ],
    });
    expect(deleted.has(feesA1)).toBe(false);
    expect(deleted.get(feesA2)).toBe(JSON.stringify({ f: '=#REF!&" A2"' }));
    const shiftedColumn = projectSheetCells(
      new Map([[sheetCellKey("fees", 0, 1)!, JSON.stringify("=B2")]]),
      {
        mutations: [
          {
            id: "sheet.mutation.insert-col",
            params: { subUnitId: "fees", range: { startColumn: 1, endColumn: 1, startRow: 0, endRow: 0 } },
          },
        ],
      },
    );
    expect(shiftedColumn.get(sheetCellKey("fees", 0, 2)!)).toBe(JSON.stringify("=C2"));
    const matrix = sheetCellRecords({
      mutations: [
        {
          id: "sheet.mutation.set-range-values",
          params: {
            subUnitId: "fees",
            range: { startRow: 0, startColumn: 0 },
            value: { "2": { "1": { v: "West" } } },
          },
        },
        {
          id: "sheet.mutation.set-range-values",
          params: {
            subUnitId: "fees",
            range: { startRow: 0, startColumn: 0 },
            value: { "0": null },
          },
        },
      ],
    });
    expect(matrix.map((record) => record.key)).toContain(sheetCellKey("fees", 2, 1));
    const kept = projectSheetCells(new Map([[feesA1, "{"], [feesA3, JSON.stringify({ v: "South" })]]), {
      mutations: [
        {
          id: "sheet.mutation.remove-row",
          params: { subUnitId: "fees", range: { startRow: 2, endRow: 2 } },
        },
      ],
    });
    expect(kept.get(feesA1)).toBe("{");
    expect(kept.has(feesA3)).toBe(false);
    expect(JSON.stringify([...deleted.values()])).not.toContain("secret-value");

    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    mirrorSheetCells(local, edit("fees", { v: "North" }, 1, 0));
    const cleared: unknown[] = [];
    const stop = watchRemoteSheetCells(remote, (writes) => {
      for (const write of writes) cleared.push(write.value);
    });
    mirrorSheetCells(local, {
      mutations: [
        {
          id: "sheet.mutation.remove-row",
          params: { subUnitId: "fees", range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 } },
        },
      ],
    });
    expect(cleared).toEqual([null]);
    stop();
  });

  it("renames a worksheet and the formulas that name it", () => {
    expect(worksheetName("secret-value\nplots")).toBeNull();
    expect(JSON.stringify(sheetNameChanges({
      mutations: [{ id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "fees", name: "secret-value\nplots", oldName: "Fees" } }],
    }))).not.toContain("secret-value");
    const feesA1 = sheetCellKey("fees", 0, 0)!;
    const bedsA1 = sheetCellKey("beds", 0, 0)!;
    const renamed = projectSheetCells(
      new Map([
        [feesA1, JSON.stringify({ v: "North" })],
        [bedsA1, JSON.stringify({ f: '=Fees!A2&"Fees!A2"' })],
      ]),
      {
        mutations: [
          {
            id: "sheet.mutation.set-worksheet-name",
            params: { subUnitId: "fees", name: "Plots", oldName: "Fees" },
          },
        ],
      },
    );
    expect(renamed.get(feesA1)).toBe(JSON.stringify({ v: "North" }));
    expect(renamed.get(bedsA1)).toBe(JSON.stringify({ f: '=Plots!A2&"Fees!A2"' }));
    expect(sheetNameChanges({
      mutations: [{ id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "fees", name: "Plots", oldName: "Fees" } }],
    })).toEqual([{ sheetId: "fees", name: "Plots" }]);

    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const arrived: string[] = [];
    const stop = watchRemoteSheetNames(remote, (renames) => {
      for (const rename of renames) arrived.push(rename.name);
    });
    mirrorSheetCells(local, {
      mutations: [
        {
          id: "sheet.mutation.set-worksheet-name",
          params: { subUnitId: "fees", name: "Plots", oldName: "Fees" },
        },
      ],
    });
    expect(arrived).toEqual(["Plots"]);
    expect(local.getMap("sheetNames").get("fees")).toBe("Plots");
    stop();
    mirrorSheetCells(local, {
      mutations: [
        {
          id: "sheet.mutation.set-worksheet-name",
          params: { subUnitId: "fees", name: "Beds", oldName: "Plots" },
        },
      ],
    });
    expect(arrived).toEqual(["Plots"]);
    const ignored: string[] = [];
    const stopLocal = watchRemoteSheetNames(local, (renames) => {
      for (const rename of renames) ignored.push(rename.name);
    });
    mirrorSheetCells(local, {
      mutations: [{ id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "fees", name: "Beds", oldName: "Plots" } }],
    });
    mirrorSheetCells(new Y.Doc(), {});
    projectSheetCells(new Map(), { mutations: [null, { id: "sheet.mutation.insert-sheet", params: { sheet: { id: "plots", name: "Plots", cellData: { "2000000": { "0": { v: "x" } } } } } }] });
    remote.getMap<string>("sheetNames").set("fees\nsecret", "Plots");
    remote.getMap<string>("sheetNames").set("beds", "secret-value\nplots");
    expect(ignored).toEqual([]);
    expect(JSON.stringify(ignored)).not.toContain("secret");
    stopLocal();
    const spaced = projectSheetCells(
      new Map([
        [feesA1, "{"],
        [bedsA1, JSON.stringify("='North beds'!A2")],
        [sheetCellKey("fees", 1, 0)!, JSON.stringify(3)],
      ]),
      {
        mutations: [
          {
            id: "sheet.mutation.set-worksheet-name",
            params: { subUnitId: "fees", name: "North beds", oldName: "North beds" },
          },
          {
            id: "sheet.mutation.set-worksheet-name",
            params: { subUnitId: "fees\nsecret", name: "Plots", oldName: "North beds" },
          },
          {
            id: "sheet.mutation.set-worksheet-name",
            params: { subUnitId: "fees", name: "South path", oldName: "North beds" },
          },
        ],
      },
    );
    expect(spaced.get(feesA1)).toBe("{");
    expect(spaced.get(bedsA1)).toBe(JSON.stringify("='South path'!A2"));
    expect(worksheetName("")).toBeNull();
    expect(worksheetName("a".repeat(32))).toBeNull();
    expect(worksheetName("Fees:Plots")).toBeNull();
    expect(JSON.stringify([...spaced.values()])).not.toContain("secret");
  });

  it("adds a worksheet and drops a deleted one", () => {
    const feesA1 = sheetCellKey("fees", 0, 0)!;
    const bedsA1 = sheetCellKey("beds", 0, 0)!;
    const added = projectSheetCells(new Map([[bedsA1, JSON.stringify({ f: "=Fees!A2" })]]), {
      mutations: [
        {
          id: "sheet.mutation.insert-sheet",
          params: {
            sheet: { id: "plots", name: "Plots", cellData: { "0": { "0": { v: "North" } } } },
          },
        },
      ],
    }, [["fees", "Fees"]]);
    expect(added.get(sheetCellKey("plots", 0, 0)!)).toBe(JSON.stringify({ v: "North" }));
    expect(added.get(bedsA1)).toBe(JSON.stringify({ f: "=Fees!A2" }));
    const removed = projectSheetCells(new Map([
      [feesA1, JSON.stringify({ v: "North" })],
      [bedsA1, JSON.stringify({ f: '=Fees!A2:B3&"Fees!A2"' })],
      [sheetCellKey("beds", 1, 0)!, JSON.stringify({ v: 1 })],
    ]), {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    }, [["fees", "Fees"]]);
    expect(removed.has(feesA1)).toBe(false);
    expect(removed.get(bedsA1)).toBe(JSON.stringify({ f: '=#REF!&"Fees!A2"' }));
    expect(sheetNameChanges({
      mutations: [
        { id: "sheet.mutation.insert-sheet", params: { sheet: { id: "secret-value\nplots", name: "Plots" } } },
        { id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } },
      ],
    })).toEqual([{ sheetId: "fees", name: null }]);
    expect(JSON.stringify(removed)).not.toContain("secret-value");
    const keptText = projectSheetCells(new Map([[bedsA1, "{"]]), {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    }, [["fees", "Fees"]]);
    expect(keptText.get(bedsA1)).toBe("{");
    const plain = projectSheetCells(new Map(), {
      mutations: [{
        id: "sheet.mutation.insert-sheet",
        params: { sheet: { id: "plots", name: "Plots", cellData: { nope: 1 } } },
      }],
    });
    expect(plain.size).toBe(0);
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    mirrorSheetCells(local, {
      mutations: [{ id: "sheet.mutation.insert-sheet", params: { sheet: { id: "fees", name: "Fees" } } }],
    });
    const gone: (string | null)[] = [];
    const stop = watchRemoteSheetNames(remote, (renames) => {
      for (const rename of renames) gone.push(rename.name);
    });
    mirrorSheetCells(local, {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    });
    expect(gone).toEqual([null]);
    stop();
    const unnamed = projectSheetCells(new Map([[bedsA1, JSON.stringify({ f: "=Fees!A2" })]]), {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    });
    expect(unnamed.get(bedsA1)).toBe(JSON.stringify({ f: "=Fees!A2" }));
    const quoted = projectSheetCells(new Map([[bedsA1, JSON.stringify({ f: "='North beds'!A2" })]]), {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "plots" } }],
    }, [["plots", "North beds"]]);
    expect(quoted.get(bedsA1)).toBe(JSON.stringify({ f: "=#REF!" }));
    const loop: { self?: unknown } = {};
    loop.self = loop;
    const skipped = projectSheetCells(new Map(), {
      mutations: [{
        id: "sheet.mutation.insert-sheet",
        params: { sheet: { id: "plots", name: "Plots", cellData: { "0": { "0": loop } } } },
      }],
    });
    expect(skipped.size).toBe(0);
  });

  it("keeps a personal filter and a commenter from changing cells", () => {
    const key = sheetCellKey("fees", 0, 0)!;
    const north = JSON.stringify({ v: "North" });
    const filtered = projectSheetCells(new Map([[key, north]]), {
      mutations: [
        {
          id: "sheet.mutation.set-filter-criteria",
          params: { subUnitId: "fees", col: 0, criteria: { values: ["secret-value"] }, range: { startRow: 0, startColumn: 0 } },
        },
      ],
    });
    expect(filtered.get(key)).toBe(north);
    expect(JSON.stringify([...filtered.values()])).not.toContain("secret-value");
    const comment = projectSheetCells(new Map([[key, north]]), {
      role: "commenter",
      mutations: [{ id: "sheet.mutation.set-range-values", params: { subUnitId: "fees", range: { startRow: 0, startColumn: 0 }, value: { v: "West" } } }],
    });
    expect(comment.get(key)).toBe(north);
    expect(sheetCellRecords({ role: "viewer", mutations: [{ params: { subUnitId: "fees", range: { startRow: 0, startColumn: 0 }, value: { v: "West" } } }] })).toEqual([]);
    expect(sheetNameChanges({ role: "comment", mutations: [{ id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "fees", name: "Plots", oldName: "Fees" } }] })).toEqual([]);
    expect(sheetCellRecords({ role: 1, mutations: [{ params: { subUnitId: "fees", range: { startRow: 0, startColumn: 0 }, value: { v: "Kept" } } }] })).toHaveLength(1);
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    mirrorSheetCells(local, edit("fees", { v: "North" }));
    mirrorSheetCells(remote, edit("fees", { v: "West" }));
    expect(local.getMap("cells").get(key)).toBe(JSON.stringify({ v: "West" }));
    expect(remote.getMap("cells").get(key)).toBe(JSON.stringify({ v: "West" }));
    mirrorSheetCells(local, { role: "view", ...edit("fees", { v: "secret-value" }) });
    expect(local.getMap("cells").get(key)).toBe(JSON.stringify({ v: "West" }));
    expect(JSON.stringify(local.getMap("cells").get(key))).not.toContain("secret-value");
  });

  it("shares a named range and a validation rule, and drops them with the sheet", () => {
    const ranges = projectNamedRanges(new Map(), {
      mutations: [{
        id: "formula.mutation.set-defined-name",
        params: { id: "fees-total", name: "Total", formulaOrRefString: "=Fees!A2", localSheetId: "fees" },
      }],
    });
    expect(JSON.parse(ranges.get("fees-total")!)).toEqual({ name: "Total", formula: "=Fees!A2", sheetId: "fees" });
    const renamed = projectNamedRanges(ranges, {
      mutations: [{ id: "sheet.mutation.set-worksheet-name", params: { subUnitId: "fees", name: "Plots", oldName: "Fees" } }],
    });
    expect(JSON.parse(renamed.get("fees-total")!).formula).toBe("=Plots!A2");
    const shifted = projectNamedRanges(
      new Map([
        ...renamed,
        ["other", JSON.stringify({ name: "Other", formula: "=Other!A2", sheetId: null })],
        ["local", JSON.stringify({ name: "Local", formula: "=A2", sheetId: "fees" })],
      ]),
      {
        mutations: [{
          id: "sheet.mutation.insert-row",
          params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
        }],
      },
      [["fees", "Plots"]],
    );
    expect(JSON.parse(shifted.get("fees-total")!).formula).toBe("=Plots!A3");
    expect(JSON.parse(shifted.get("local")!).formula).toBe("=A3");
    expect(JSON.parse(shifted.get("other")!).formula).toBe("=Other!A2");
    expect(JSON.stringify([...shifted.values()])).not.toContain("secret-value");
    const removed = projectNamedRanges(renamed, {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    }, [["fees", "Plots"]]);
    expect(removed.has("fees-total")).toBe(false);
    expect(projectNamedRanges(new Map(), {
      role: "commenter",
      mutations: [{ id: "formula.mutation.set-defined-name", params: { id: "x", name: "Total", formulaOrRefString: "=A1" } }],
    }).size).toBe(0);
    expect(projectNamedRanges(new Map(), {
      mutations: [{ id: "formula.mutation.set-defined-name", params: { id: "secret-value\nname", name: "Total", formulaOrRefString: "=A1" } }],
    }).size).toBe(0);

    const rules = projectValidationRules(new Map(), {
      mutations: [{
        id: "data-validation.mutation.addRule",
        params: { subUnitId: "fees", rule: { id: "whole", type: "whole", formula1: "1" } },
      }],
    });
    expect(JSON.parse(rules.get("fees\u001fwhole")!).type).toBe("whole");
    const moved = projectValidationRules(
      new Map([
        ["fees\u001fwhole", JSON.stringify({
          id: "whole",
          type: "whole",
          formula1: "=Plots!A2",
          ranges: [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }],
        })],
        ["beds\u001flist", JSON.stringify({ id: "list", formula1: "=Other!A2", ranges: [{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 }] })],
      ]),
      {
        mutations: [{
          id: "sheet.mutation.insert-row",
          params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
        }],
      },
      [["fees", "Plots"]],
    );
    const whole = JSON.parse(moved.get("fees\u001fwhole")!) as { formula1: string; ranges: { startRow: number; endRow: number }[] };
    expect(whole.formula1).toBe("=Plots!A3");
    expect(whole.ranges[0]).toMatchObject({ startRow: 2, endRow: 3 });
    const list = JSON.parse(moved.get("beds\u001flist")!) as { formula1: string; ranges: { startRow: number }[] };
    expect(list.formula1).toBe("=Other!A2");
    expect(list.ranges[0].startRow).toBe(1);
    expect(JSON.stringify([...moved.values()])).not.toContain("secret-value");
    const after = projectValidationRules(rules, {
      mutations: [
        { id: "data-validation.mutation.removeRule", params: { subUnitId: "fees", ruleId: "whole" } },
        { id: "data-validation.mutation.addRule", params: { subUnitId: "fees", rule: { id: "secret-value\nrule", type: "list" } } },
      ],
    });
    expect(after.size).toBe(0);
    expect(JSON.stringify([...after.keys()])).not.toContain("secret-value");
    const updated = projectValidationRules(rules, {
      mutations: [{
        id: "data-validation.mutation.updateRule",
        params: { subUnitId: "fees", ruleId: "whole", payload: { id: "whole", type: "list" } },
      }],
    });
    expect(JSON.parse(updated.get("fees\u001fwhole")!).type).toBe("list");
    const gone = projectNamedRanges(ranges, {
      mutations: [{ id: "formula.mutation.remove-defined-name", params: { id: "fees-total" } }],
    });
    expect(gone.has("fees-total")).toBe(false);

    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const names: string[] = [];
    const types: unknown[] = [];
    const stopRanges = watchRemoteNamedRanges(remote, (changes) => {
      for (const change of changes) names.push(change.range?.name ?? "");
    });
    const stopRules = watchRemoteValidation(remote, (changes) => {
      for (const change of changes) types.push(change.rule && typeof change.rule === "object" ? (change.rule as { type?: unknown }).type : null);
    });
    mirrorSheetCells(local, {
      mutations: [
        { id: "formula.mutation.set-defined-name", params: { id: "fees-total", name: "Total", formulaOrRefString: "=A2", localSheetId: "fees" } },
        { id: "data-validation.mutation.addRule", params: { subUnitId: "fees", rule: { id: "whole", type: "whole" } } },
      ],
    });
    expect(names).toEqual(["Total"]);
    expect(types).toEqual(["whole"]);
    mirrorSheetCells(local, {
      mutations: [
        { id: "formula.mutation.remove-defined-name", params: { id: "fees-total" } },
        { id: "data-validation.mutation.removeRule", params: { subUnitId: "fees", ruleId: ["whole"] } },
      ],
    });
    expect(names).toEqual(["Total", ""]);
    expect(types).toEqual(["whole", null]);
    stopRanges();
    stopRules();
    expect(JSON.stringify(local.getMap("namedRanges").toJSON())).not.toContain("secret-value");
    const broken = projectNamedRanges(new Map([["bad", "{"]]), {
      mutations: [
        null,
        { id: "formula.mutation.set-defined-name", params: { id: "ok", name: "Total", formulaOrRefString: "=\nA1" } },
        { id: "formula.mutation.remove-defined-name", params: { id: "secret-value\nid" } },
        { id: "sheet.mutation.remove-sheet", params: { subUnitId: "other" } },
      ],
    }, [["fees", "Fees"]]);
    expect(broken.get("bad")).toBe("{");
    expect(JSON.stringify([...broken.keys()])).not.toContain("secret-value");
    const cleared = projectNamedRanges(new Map([["n", JSON.stringify({ name: "N", formula: "=Fees!A1", sheetId: "beds" })]]), {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    }, [["fees", "Fees"]]);
    expect(JSON.parse(cleared.get("n")!).formula).toBe("=#REF!");
    const keptRule = projectValidationRules(new Map([["fees\u001fwhole", "{}"]]), {
      role: "comment",
      mutations: [{ id: "data-validation.mutation.removeRule", params: { subUnitId: "fees", ruleId: "whole" } }],
    });
    expect(keptRule.size).toBe(1);
    const droppedRules = projectValidationRules(new Map([["fees\u001fwhole", "{}"]]), {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    });
    expect(droppedRules.size).toBe(0);
    const loopRule: { id: string; self?: unknown } = { id: "loop" };
    loopRule.self = loopRule;
    expect(projectValidationRules(new Map(), {
      mutations: [{ id: "data-validation.mutation.addRule", params: { subUnitId: "fees", rule: loopRule } }],
    }).size).toBe(0);
    const seen: (string | null)[] = [];
    const doc = new Y.Doc();
    const stopSeen = watchRemoteNamedRanges(doc, (changes) => {
      for (const change of changes) seen.push(change.range?.name ?? null);
    });
    doc.getMap<string>("namedRanges").set("fees-total", "{");
    doc.getMap<string>("namedRanges").set("ok", JSON.stringify({ name: "Total", formula: "=A1", sheetId: null }));
    expect(seen).toEqual(["Total"]);
    stopSeen();
    const got: unknown[] = [];
    const rulesDoc = new Y.Doc();
    const stopRulesDoc = watchRemoteValidation(rulesDoc, (changes) => {
      for (const change of changes) got.push(change.rule);
    });
    const ruleMap = rulesDoc.getMap<string>("validationRules");
    ruleMap.set("nope", "{}");
    ruleMap.set("fees\u001fwhole", "{");
    ruleMap.set("fees\u001fwhole", JSON.stringify({ type: "whole" }));
    ruleMap.delete("fees\u001fwhole");
    expect(got).toEqual([{ type: "whole" }, null]);
    const quiet: unknown[] = [];
    const stopQuietRules = watchRemoteValidation(rulesDoc, (changes) => quiet.push(changes));
    const stopQuietNames = watchRemoteNamedRanges(rulesDoc, (changes) => quiet.push(changes));
    mirrorSheetCells(rulesDoc, {
      mutations: [
        { id: "formula.mutation.set-defined-name", params: { id: "beds-total", name: "Total", formulaOrRefString: "=A1" } },
        { id: "data-validation.mutation.addRule", params: { subUnitId: "beds", rule: { id: "list", type: "list" } } },
      ],
    });
    expect(quiet).toEqual([]);
    stopQuietRules();
    stopQuietNames();
    stopRulesDoc();
  });

  it("stores a cell's formatting with the cell", () => {
    const records = sheetCellRecords({
      mutations: [{
        id: "sheet.mutation.set-range-values",
        params: {
          subUnitId: "fees",
          range: { startRow: 0, startColumn: 0 },
          value: { v: "North", s: "bold" },
        },
      }],
    }, { bold: { bl: 1 } });
    expect(JSON.parse(records[0].json)).toEqual({ v: "North", s: { bl: 1 } });
    const broken = sheetCellRecords({
      mutations: [{
        params: {
          subUnitId: "fees",
          range: { startRow: 0, startColumn: 0 },
          value: { v: "North", s: "secret-value\nbold" },
        },
      }],
    });
    expect(JSON.parse(broken[0].json)).toEqual({ v: "North" });
    expect(broken[0].json).not.toContain("secret-value");
    const kept = sheetCellRecords({
      styles: { bold: ["nope"] },
      mutations: [{
        params: {
          subUnitId: "fees",
          range: { startRow: 0, startColumn: 0 },
          value: { v: "North", s: "bold" },
        },
      }],
    });
    expect(JSON.parse(kept[0].json).s).toBe("bold");
    expect(workbookStyles({ workbook: { styles: { bold: { bl: 1 } } } })?.bold).toEqual({ bl: 1 });
    expect(workbookStyles({ workbook: { styles: ["nope"] } })).toBeNull();
    const added = projectSheetCells(new Map(), {
      mutations: [{
        id: "sheet.mutation.insert-sheet",
        params: {
          sheet: {
            id: "plots",
            name: "Plots",
            cellData: { 0: { 0: { v: "North", s: "bold" } } },
          },
        },
      }],
    }, [], { bold: { bl: 1 } });
    expect(JSON.parse(added.get(sheetCellKey("plots", 0, 0)!)!).s).toEqual({ bl: 1 });
  });

  it("moves a cell from one worksheet onto another", () => {
    const fees = sheetCellKey("fees", 0, 0)!;
    const beds = sheetCellKey("beds", 0, 0)!;
    const before = new Map([[fees, JSON.stringify({ v: "North" })]]);
    const moved = projectSheetCells(before, {
      mutations: [{
        id: "sheet.mutation.move-range",
        params: {
          from: { subUnitId: "fees", value: { 0: { 0: null } } },
          to: {
            subUnitId: "beds",
            value: { 0: { 0: { v: "North", f: "=A2", s: "bold" } } },
          },
        },
      }],
    }, [], { bold: { bl: 1 } });
    expect(moved.has(fees)).toBe(false);
    expect(JSON.parse(moved.get(beds)!)).toEqual({ f: "=A2", s: { bl: 1 } });
    const refused = projectSheetCells(before, {
      mutations: [{
        id: "sheet.mutation.move-range",
        params: {
          from: { subUnitId: "secret-value\nfees", value: { 0: { 0: null } } },
          to: { subUnitId: "beds", value: { 0: { 0: { v: "West" } } } },
        },
      }],
    });
    expect(refused.has(fees)).toBe(true);
    expect(JSON.stringify([...refused.values()])).not.toContain("secret-value");
    expect(refused.get(beds)).toContain("West");
  });
});
