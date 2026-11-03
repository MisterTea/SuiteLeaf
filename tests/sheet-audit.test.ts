import { describe, expect, it } from "vitest";
import { auditFormula, nextFormulaError } from "../packages/core/src/sheet-audit";

describe("formula audit", () => {
  it("names a cycle and leaves cell values out", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { f: "=B1" },
          "1": { f: "=A1", v: "#CYCLE!" },
        },
        "1": {
          "0": { f: "=SUM(A1:A1)", v: "secret tomato" },
          "1": { f: '="secret tomato"' },
        },
      },
    };
    const before = JSON.stringify(sheet);
    const audit = auditFormula(sheet, "A1");
    expect(JSON.stringify(sheet)).toBe(before);
    expect(audit.precedents).toEqual(["B1"]);
    expect(audit.dependents).toEqual(["A2", "B1"]);
    expect(audit.trace).toContain("A1 reads B1");
    expect(audit.trace).toContain("B1 reads A1");
    expect(audit.cycle).toBe("A1 refers to B1, and B1 refers to A1.");
    expect(audit.error).toBeNull();
    expect(JSON.stringify(audit)).not.toContain("secret tomato");
    const other = auditFormula(sheet, "B1");
    expect(other.error).toBe("#CYCLE!");
    expect(JSON.stringify(other)).not.toContain("secret tomato");
    const wide = auditFormula(
      { cellData: { "0": { "0": { f: "=A1:A80" } } } },
      "A1",
    );
    expect(wide.trace).toContain("too large to list");
    expect(wide.precedents).toEqual([]);
    const otherSheet = auditFormula(
      { cellData: { "0": { "0": { f: "=Fees!B2", v: "secret-value" } } } },
      "A1",
    );
    expect(otherSheet.precedents).toEqual(["Fees!B2"]);
    expect(otherSheet.trace).toContain("A1 reads Fees!B2");
    expect(JSON.stringify(otherSheet)).not.toContain("secret-value");
    expect(JSON.stringify(otherSheet)).not.toContain("=");
    const linked = auditFormula(
      { cellData: { "0": { "0": { f: "=Fees!B2" } } } },
      "A1",
      {
        name: "Beds",
        others: [
          {
            name: "Fees",
            cellData: { "1": { "1": { f: "=Beds!A1", v: "secret-value" } } },
          },
        ],
      },
    );
    expect(linked.precedents).toEqual(["Fees!B2"]);
    expect(linked.dependents).toEqual(["Fees!B2"]);
    expect(linked.cycle).toBe("A1 refers to Fees!B2, and Fees!B2 refers to A1.");
    expect(JSON.stringify(linked)).not.toContain("secret-value");
  });

  it("explains a cycle through three cells and leaves the formula text out", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { f: "=B1" },
          "1": { f: "=C1" },
          "2": { f: "=A1" },
          "3": { f: '="secret-value"' },
        },
      },
    };
    const audit = auditFormula(sheet, "A1");
    expect(audit.cycle).toBe(
      "A1 refers to B1, and B1 refers to C1, and C1 refers to A1.",
    );
    expect(JSON.stringify(audit)).not.toContain("secret-value");
    expect(JSON.stringify(audit)).not.toContain("=");
    expect(sheet.cellData["0"]["3"].f).toBe('="secret-value"');
  });

  it("moves to the next formula error and skips a cell that is not an error", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "secret-value" },
          "1": { f: "=A1", v: "#DIV/0!" },
          "2": { v: "secret-value" },
          "3": { f: "=C1", v: "#VALUE!" },
        },
      },
    };
    const before = JSON.stringify(sheet);
    expect(nextFormulaError(sheet, "A1")).toEqual({
      address: "B1",
      error: "#DIV/0!",
      note: "Next error is B1, #DIV/0!.",
    });
    expect(nextFormulaError(sheet, "B1")).toEqual({
      address: "D1",
      error: "#VALUE!",
      note: "Next error is D1, #VALUE!.",
    });
    expect(nextFormulaError(sheet, "D1").address).toBe("B1");
    expect(nextFormulaError(sheet, "B1").note).not.toContain("secret-value");
    expect(JSON.stringify(nextFormulaError(sheet, "C1"))).not.toContain("secret-value");
    const only = nextFormulaError(
      { cellData: { "0": { "0": { f: "=B1", v: "#CYCLE!" } } } },
      "A1",
    );
    expect(only.note).toBe("There is no other formula error.");
    expect(JSON.stringify(sheet)).toBe(before);
  });

  it("moves to a formula error on the next sheet", () => {
    const sheet = { cellData: { "0": { "1": { f: "=A1", v: "#DIV/0!" } } } };
    const fees = { name: "Fees", cellData: { "1": { "0": { f: "=A2", v: "#REF!" } } } };
    const next = nextFormulaError(sheet, "B1", [fees]);
    expect(next).toEqual({
      address: "Fees!A2",
      error: "#REF!",
      note: "Next error is Fees!A2, #REF!.",
    });
    expect(nextFormulaError(sheet, "Fees!A2", [fees]).address).toBe("B1");
    const hidden = nextFormulaError(sheet, "B1", [
      { name: "secret-value", cellData: { "0": { "0": { v: "#N/A" } } } },
    ]);
    expect(hidden.address).toBe("another sheet!A1");
    expect(hidden.note).not.toContain("secret-value");
    expect(JSON.stringify(sheet)).toBe(JSON.stringify({ cellData: { "0": { "1": { f: "=A1", v: "#DIV/0!" } } } }));
  });
});
