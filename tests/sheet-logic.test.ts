import { describe, expect, it } from "vitest";
import { firstMatching, logicNote, logicValue, parseIfs, parseLogic, settleLogic } from "../packages/core/src/sheet-ifs";

describe("comparisons inside AND, OR, NOT, and IFS", () => {
  it("decides each comparison and leaves text undecided", () => {
    const rows: Record<string, unknown> = { A1: 12, B1: 3, C1: 4, D1: 8 };
    const both = parseLogic("=AND(A1>10, B1<5)");
    expect(both?.sheet).toBeNull();
    expect(logicValue(both!, (address) => rows[address])).toBe(1);
    expect(logicNote(both!, (address) => rows[address])).toBe("Both are true.");
    rows.B1 = 9;
    expect(logicValue(both!, (address) => rows[address])).toBe(0);
    expect(logicNote(both!, (address) => rows[address])).toBe("Both are not true.");
    const either = parseLogic("=OR(A1>10, B1<5)");
    rows.A1 = 4;
    rows.B1 = 3;
    expect(logicValue(either!, (address) => rows[address])).toBe(1);
    expect(logicNote(either!, (address) => rows[address])).toBe("Either is true.");
    rows.B1 = 9;
    expect(logicValue(either!, (address) => rows[address])).toBe(0);
    expect(logicNote(either!, (address) => rows[address])).toBe("Neither is true.");
    const opposite = parseLogic("=NOT(A1>10)");
    rows.A1 = 12;
    expect(logicValue(opposite!, (address) => rows[address])).toBe(0);
    expect(logicNote(opposite!, (address) => rows[address])).toBe("The opposite is 0.");
    rows.A1 = 4;
    expect(logicValue(opposite!, (address) => rows[address])).toBe(1);
    expect(logicNote(opposite!, (address) => rows[address])).toBe("The opposite is 1.");
    rows.A1 = "secret-value";
    expect(logicValue(both!, (address) => rows[address])).toBeNull();
    expect(logicNote(both!, (address) => rows[address])).toBe("The comparison was not decided.");
    const chosen = parseIfs("=IFS(A1>10, B1, C1<5, D1)");
    rows.A1 = 4;
    rows.C1 = 3;
    expect(firstMatching(chosen!, (address) => rows[address])).toBe(8);
    rows.A1 = 12;
    rows.B1 = 3;
    expect(firstMatching(chosen!, (address) => rows[address])).toBe(3);
    rows.A1 = "secret-value";
    expect(firstMatching(chosen!, (address) => rows[address])).toBeNull();
    expect(parseLogic("=AND(A1>10)")).toBeNull();
    expect(parseLogic("=NOT(A1>10, B1<5)")).toBeNull();
    expect(parseLogic("=AND(Beds!A1>10, B1<5)")).toBeNull();
    expect(parseLogic("=AND(Beds!A1>10, Beds!B1<5)")?.sheet).toBe("Beds");
    expect(parseIfs('=IFS(A1>"High", B1, C1, D1)')?.pairs[0]?.compare?.op).toBe(">");
    const written = parseIfs('=IFS(A1>10, "High", TRUE, "Low")');
    rows.A1 = 12;
    expect(firstMatching(written!, (address) => rows[address])).toBe("High");
    rows.A1 = 4;
    expect(firstMatching(written!, (address) => rows[address])).toBe("Low");
    expect(parseIfs('=IFS(A1>10, "High, beds", FALSE, "Low")')?.pairs[0]?.valueLiteral).toEqual({
      kind: "text",
      value: "High, beds",
    });
    const settled = settleLogic(
      ["E1"],
      () => "=AND(A1>10, B1<5)",
      (address) => ({ A1: 12, B1: 3 })[address],
      () => false,
    );
    expect(settled.calculated).toEqual(["E1"]);
    expect(settled.left).toEqual([]);
    expect(logicValue(parseLogic("=NOT(A1>10)")!, () => true)).toBeNull();
    expect(logicValue(parseLogic("=NOT(A1>10)")!, () => "")).toBe(1);
    expect(logicValue(parseLogic("=NOT(A1>10)")!, () => " 12 ")).toBe(0);
    expect(logicValue(parseLogic("=OR(A1>=10, B1<>4)")!, (address) => (address === "A1" ? 10 : 4))).toBe(1);
    expect(parseIfs("=IFS(Beds!A1>10, Beds!B1, C1<5, D1)")).toBeNull();
    expect(parseLogic('=NOT(">"=A1)')).toBeNull();
    const waiting = settleLogic(
      ["B1", "C1"],
      (address) => (address === "C1" ? "=AND(B1>1, A1>1)" : "=NOT(A1>1)"),
      () => 4,
      () => true,
    );
    expect(waiting.calculated).toContain("C1");
  });
});
