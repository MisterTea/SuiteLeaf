import { expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { projectConditionalRules, watchRemoteConditional } from "../apps/web/src/collab/sheet-conditional";
import { mirrorSheetCells } from "../apps/web/src/collab/sheet-cells";

const rule = {
  cfId: "high",
  stopIfTrue: false,
  ranges: [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 }],
  rule: { type: "highlightCell", subType: "formula", value: "=A2" },
};

it("shares a conditional rule and moves it with a row insert", () => {
  const added = projectConditionalRules(new Map(), {
    mutations: [{
      id: "sheet.mutation.add-conditional-rule",
      params: { subUnitId: "fees", rule },
    }],
  });
  expect(JSON.parse(added.get("fees\u001fhigh")!).rule.value).toBe("=A2");
  const shifted = projectConditionalRules(
    new Map([
      ...added,
      ["beds\u001fother", JSON.stringify({
        ...rule,
        cfId: "other",
        ranges: [{ startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 }],
        rule: { type: "highlightCell", value: "=Fees!A2" },
      })],
    ]),
    {
      mutations: [{
        id: "sheet.mutation.insert-row",
        params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
      }],
    },
    [["fees", "Plots"]],
  );
  const fees = JSON.parse(shifted.get("fees\u001fhigh")!) as {
    ranges: { startRow: number; endRow: number }[];
    rule: { value: string };
  };
  expect(fees.rule.value).toBe("=A3");
  expect(fees.ranges[0]).toMatchObject({ startRow: 2, endRow: 3 });
  expect(JSON.parse(shifted.get("beds\u001fother")!).rule.value).toBe("=Fees!A3");
  expect(JSON.parse(shifted.get("beds\u001fother")!).ranges[0].startRow).toBe(1);
  const refused = projectConditionalRules(shifted, {
    role: "commenter",
    mutations: [{
      id: "sheet.mutation.add-conditional-rule",
      params: { subUnitId: "fees", rule: { ...rule, cfId: "secret-value\nrule" } },
    }],
  });
  expect(refused.has("fees\u001fhigh")).toBe(true);
  expect([...refused.keys()].join(" ")).not.toContain("secret-value");
  const gone = projectConditionalRules(added, {
    mutations: [{ id: "sheet.mutation.delete-conditional-rule", params: { subUnitId: "fees", cfId: "high" } }],
  });
  expect(gone.has("fees\u001fhigh")).toBe(false);

  const local = new Y.Doc();
  const remote = new Y.Doc();
  connectDocs(local, remote);
  mirrorSheetCells(local, {
    mutations: [{ id: "sheet.mutation.add-conditional-rule", params: { subUnitId: "fees", rule } }],
  });
  expect(JSON.parse(remote.getMap("conditionalRules").get("fees\u001fhigh")!).rule.value).toBe("=A2");
  const replaced = projectConditionalRules(added, {
    mutations: [{
      id: "sheet.mutation.set-conditional-rule",
      params: { subUnitId: "fees", cfId: "high", rule: { ...rule, rule: { type: "highlightCell", value: "=B2" } } },
    }],
  });
  expect(JSON.parse(replaced.get("fees\u001fhigh")!).rule.value).toBe("=B2");
  const cleared = projectConditionalRules(
    new Map([...added, ["beds\u001fstay", JSON.stringify(rule)]]),
    { mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }] },
  );
  expect(cleared.has("fees\u001fhigh")).toBe(false);
  expect(cleared.has("beds\u001fstay")).toBe(true);
  const column = projectConditionalRules(added, {
    mutations: [{
      id: "sheet.mutation.insert-col",
      params: { subUnitId: "fees", range: { startColumn: 0, endColumn: 0 } },
    }],
  });
  expect(JSON.parse(column.get("fees\u001fhigh")!).ranges[0].startColumn).toBe(1);
  const odd = projectConditionalRules(
    new Map([
      ["fees\u001fhigh", JSON.stringify({
        ...rule,
        ranges: ["skip", { startRow: "x", endRow: 1, startColumn: 0, endColumn: 0 }, rule.ranges[0]],
        rule: { type: "highlightCell", value: 1 },
      })],
      ["fees\u001fbad", "secret-value"],
      ["fees\u001flist", "[]"],
    ]),
    {
      mutations: [{
        id: "sheet.mutation.remove-row",
        params: { subUnitId: "fees", range: { startRow: 1, endRow: 2 } },
      }],
    },
  );
  expect(JSON.parse(odd.get("fees\u001fhigh")!).ranges).toHaveLength(1);
  expect(odd.get("fees\u001fbad")).toBe("secret-value");
  expect(odd.get("fees\u001flist")).toBe("[]");
  const ignored = projectConditionalRules(added, {
    mutations: [
      { id: "sheet.mutation.add-conditional-rule" },
      { id: "sheet.mutation.add-conditional-rule", params: { subUnitId: "fees\n", rule } },
      { id: "sheet.mutation.add-conditional-rule", params: { subUnitId: "fees", rule: ["nope"] } },
      { id: "sheet.mutation.add-conditional-rule", params: { subUnitId: "fees", rule: { stopIfTrue: false } } },
      { id: "sheet.mutation.delete-conditional-rule", params: { subUnitId: "fees" } },
      { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: -1 } } },
      { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 0, endRow: 20_000 } } },
      { id: "sheet.mutation.insert-row", params: { subUnitId: "fees" } },
    ],
  });
  expect(JSON.parse(ignored.get("fees\u001fhigh")!).rule.value).toBe("=A2");
  const loop: { cfId: string; self?: unknown } = { cfId: "loop", stopIfTrue: false, ranges: [], rule: { type: "highlightCell" } };
  loop.self = loop;
  expect(projectConditionalRules(new Map(), {
    mutations: [{ id: "sheet.mutation.add-conditional-rule", params: { subUnitId: "fees", rule: loop } }],
  }).size).toBe(0);
  const shrunk = projectConditionalRules(
    new Map([["fees\u001fhigh", JSON.stringify({ ...rule, ranges: [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }] })]]),
    {
      mutations: [{ id: "sheet.mutation.remove-row", params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } } }],
    },
  );
  expect(JSON.parse(shrunk.get("fees\u001fhigh")!).ranges[0]).toMatchObject({ startRow: 0, endRow: 1 });
  const seen: { cfId: string; value?: string }[] = [];
  const stop = watchRemoteConditional(remote, (changes) => {
    for (const change of changes) {
      const body = change.rule as { rule?: { value?: string } } | null;
      seen.push({ cfId: change.cfId, value: body?.rule?.value });
    }
  });
  remote.getMap("conditionalRules").set("fees\u001fhigh", "{");
  remote.getMap("conditionalRules").delete("fees\u001fhigh");
  expect(seen.at(-1)).toEqual({ cfId: "high", value: undefined });
  remote.getMap("conditionalRules").set("plain", "{}");
  remote.transact(() => {
    remote.getMap("conditionalRules").set("fees\u001fhigh", JSON.stringify(rule));
  }, "sheet-local");
  expect(seen.some((item) => item.cfId === "plain")).toBe(false);
  stop();
});
