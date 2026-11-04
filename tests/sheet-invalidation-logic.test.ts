import { describe, expect, it } from "vitest";
import { recalculateDirty } from "../packages/core/src/sheet-invalidation";

describe("incremental formula invalidation", () => {
  it("chooses one cell when the condition is a number", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 0 },
          "1": { v: "secret-value" },
          "2": { v: "Beds" },
          "3": { f: "=IF(A1, B1, C1)", v: 4 },
          "4": { f: "=D1" },
        },
        "1": {
          "0": { v: "secret-value" },
          "1": { f: "=IF(A2, B1, C1)", v: 4 },
        },
      },
    };
    const zero = recalculateDirty(sheet, "A1");
    expect(zero.cellData["0"]["3"].v).toBe("Beds");
    expect(zero.cellData["0"]["4"].v).toBe("Beds");
    expect(zero.cellData["0"]["1"].v).toBe("secret-value");
    expect(JSON.stringify({ calculated: zero.calculated, left: zero.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["3"].v).toBe(4);
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe(4);
    expect(text.left).toContain("B2");
    sheet.cellData["0"]["0"] = { v: 2 };
    const other = recalculateDirty(sheet, "A1");
    expect(other.cellData["0"]["3"].v).toBe("secret-value");
    expect(other.cellData["0"]["2"].v).toBe("Beds");
    expect(JSON.stringify({ calculated: other.calculated, left: other.left })).not.toContain("secret-value");
  });

  it("turns a number into its opposite", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: -4 }, "1": { f: "=NOT(A1)", v: 1 }, "2": { f: "=B1" } },
        "1": { "0": { v: 0 }, "1": { f: "= NOT(A2)", v: 0 } },
        "2": { "0": { v: "secret-value" }, "1": { f: "=NOT(A3)", v: 1 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(0);
    expect(result.cellData["0"]["2"].v).toBe(0);
    expect(result.calculated).toContain("B1");
    const zero = recalculateDirty(sheet, "A2");
    expect(zero.cellData["1"]["1"].v).toBe(1);
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["1"].v).toBe(1);
    expect(text.left).toContain("B3");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("NOT");
    expect(sheet.cellData["0"]["1"].v).toBe(1);
  });

  it("uses the other cell when the first is an error", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "#DIV/0!" }, "1": { f: "=IFERROR(A1, C1)", v: "" }, "2": { v: 4 } },
        "1": { "0": { v: 9 }, "1": { f: "= IFERROR(A2, C2)", v: "" }, "2": { v: 1 } },
        "2": { "0": { v: "secret-value" }, "1": { f: "=IFERROR(A3, C3)", v: "" }, "2": { v: 2 } },
        "3": { "0": { v: "#REF!" }, "1": { f: "=IFERROR(A4, C4)", v: "kept" }, "2": { v: "#N/A" } },
      },
    };
    const error = recalculateDirty(sheet, "A1");
    expect(error.cellData["0"]["1"].v).toBe(4);
    const kept = recalculateDirty(sheet, "A2");
    expect(kept.cellData["1"]["1"].v).toBe(9);
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["1"].v).toBe("secret-value");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    const both = recalculateDirty(sheet, "A4");
    expect(both.cellData["3"]["1"].v).toBe("#N/A");
    expect(sheet.cellData["2"]["0"].v).toBe("secret-value");
  });

  it("requires both cells before the result is true", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 2 }, "1": { v: 0 }, "2": { f: "=AND(A1,B1)", v: 1 }, "3": { f: "=C1" } },
        "1": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: "= AND(A2, B2)", v: 0 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["2"].v).toBe(0);
    expect(result.cellData["0"]["3"].v).toBe(0);
    expect(result.calculated).toContain("C1");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["2"].v).toBe(0);
    expect(text.left).toContain("C2");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("AND");
    expect(sheet.cellData["0"]["2"].v).toBe(1);
    const yes = recalculateDirty(
      { cellData: { "0": { "0": { v: -4 }, "1": { v: 3 }, "2": { f: "=AND(A1,B1)", v: 0 } } } },
      "A1",
    );
    expect(yes.cellData["0"]["2"].v).toBe(1);
  });

  it("accepts either cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 0 }, "1": { v: 3 }, "2": { f: "=OR(A1,B1)", v: 0 }, "3": { f: "=C1" } },
        "1": { "0": { v: 0 }, "1": { v: 0 }, "2": { f: "= OR(A2, B2)", v: 1 } },
        "2": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: "=OR(A3,B3)", v: 1 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["2"].v).toBe(1);
    expect(result.cellData["0"]["3"].v).toBe(1);
    const neither = recalculateDirty(sheet, "A2");
    expect(neither.cellData["1"]["2"].v).toBe(0);
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["2"].v).toBe(1);
    expect(text.left).toContain("C3");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["2"].v).toBe(0);
  });

  it("uses the value from the first true cell", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 0 },
          "1": { v: "secret-value" },
          "2": { v: 1 },
          "3": { v: 4 },
          "4": { f: "=IFS(A1, B1, C1, D1)", v: "" },
        },
        "1": { "0": { v: 0 }, "1": { v: 2 }, "2": { v: 0 }, "3": { v: 9 }, "4": { f: "=IFS(A2, B2, C2, D2)", v: "" } },
        "2": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: "=IFS(A3, B3, A3, B3)", v: 1 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["4"].v).toBe(4);
    const none = recalculateDirty(sheet, "A2");
    expect(none.cellData["1"]["4"].v).toBe("#N/A");
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["2"].v).toBe(1);
    expect(text.left).toContain("C3");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["1"].v).toBe("secret-value");
  });

  it("uses the cell that the comparison picks", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 12 }, "1": { v: 4 }, "2": { v: 9 }, "3": { f: "=IF(A1>10, B1, C1)", v: "" } },
        "1": { "0": { v: 10 }, "1": { v: 4 }, "2": { v: 9 }, "3": { f: "=IF(A2>=10, B2, C2)", v: "" } },
        "2": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: '=IF(A3>"Beds", B3, B3)', v: 1 } },
        "3": { "0": { v: "Beds" }, "1": { f: '=IF(A4="beds", "Yes", "No")', v: "" } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["3"].v).toBe(4);
    const same = recalculateDirty(sheet, "A2");
    expect(same.cellData["1"]["3"].v).toBe(4);
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["2"].v).toBe(1);
    expect(text.left).toContain("C3");
    const word = recalculateDirty(sheet, "A4");
    expect(word.cellData["3"]["1"].v).toBe("Yes");
    expect(JSON.stringify({ calculated: result.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["2"]["0"].v).toBe("secret-value");
  });

  it("uses a comparison inside AND, OR, NOT, and IFS", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 12 }, "1": { v: 3 }, "2": { f: "=AND(A1>10, B1<5)", v: "" } },
        "1": { "0": { v: 4 }, "1": { v: 9 }, "2": { f: "=OR(A2>10, B2<5)", v: "" } },
        "2": { "0": { v: 12 }, "1": { f: "=NOT(A3>10)", v: "" } },
        "3": {
          "0": { v: 4 },
          "1": { v: 3 },
          "2": { v: 3 },
          "3": { v: 8 },
          "4": { f: "=IFS(A4>10, B4, C4<5, D4)", v: "" },
        },
        "4": { "0": { v: "secret-value" }, "1": { v: 3 }, "2": { f: "=AND(A5>10, B5<5)", v: 1 } },
      },
    };
    expect(recalculateDirty(sheet, "A1").cellData["0"]["2"].v).toBe(1);
    expect(recalculateDirty(sheet, "A2").cellData["1"]["2"].v).toBe(0);
    expect(recalculateDirty(sheet, "A3").cellData["2"]["1"].v).toBe(0);
    expect(recalculateDirty(sheet, "A4").cellData["3"]["4"].v).toBe(8);
    const text = recalculateDirty(sheet, "A5");
    expect(text.cellData["4"]["2"].v).toBe(1);
    expect(text.left).toContain("C5");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["4"]["0"].v).toBe("secret-value");
  });

  it("uses the written result from the first true test", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 12 }, "1": { f: '=IFS(A1>10, "High", TRUE, "Low")', v: "" } },
        "1": { "0": { v: 4 }, "1": { f: '=IFS(A2>10, "High", TRUE, "Low")', v: "" } },
        "2": { "0": { v: "secret-value" }, "1": { f: '=IFS(A3>10, "High", TRUE, "Low")', v: 1 } },
      },
    };
    expect(recalculateDirty(sheet, "A1").cellData["0"]["1"].v).toBe("High");
    expect(recalculateDirty(sheet, "A2").cellData["1"]["1"].v).toBe("Low");
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["1"].v).toBe(1);
    expect(text.left).toContain("B3");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["2"]["0"].v).toBe("secret-value");
  });
});
