import { describe, expect, it } from "vitest";
import { applyRandom, randomResult } from "../packages/core/src/sheet-rand";

describe("sheet random", () => {
  it("draws a number and a whole number from the supplied sequence", () => {
    expect(randomResult("=RAND()", () => 0.25, () => undefined)).toBe(0.25);
    expect(randomResult("=RAND(A1)", () => 0.25, () => undefined)).toBeNull();
    expect(randomResult("=RANDBETWEEN(1, 3)", () => 0, () => undefined)).toBe(1);
    expect(randomResult("=RANDBETWEEN(1, 3)", () => 0.999, () => undefined)).toBe(3);
    expect(randomResult("=RANDBETWEEN(3, 1)", () => 0.2, () => undefined)).toBe("#NUM!");
    expect(randomResult("=RANDBETWEEN(A1, B1)", () => 0.5, (address) => (address === "A1" ? 2 : 4))).toBe(3);
    expect(randomResult("=RANDBETWEEN(A1, B1)", () => 0.5, () => "secret-value")).toBeNull();
    expect(randomResult("=RAND()", () => 2, () => undefined)).toBeNull();
    expect(
      randomResult("=RANDBETWEEN('North beds'!A1, 'North beds'!B1)", () => 0, (address) =>
        address.endsWith("A1") ? 1 : 3,
      ),
    ).toBe(1);
    expect(randomResult("=RANDBETWEEN(Beds!A1, Beds!B1)", () => 0, () => "secret-value")).toBeNull();
    expect(randomResult("=RANDBETWEEN(A1)", () => 0.2, () => 1)).toBeNull();
    expect(applyRandom({ "1": undefined, "0": { "0": null, "1": { v: 1 } } }, () => 0.2)).toEqual([]);
    expect(applyRandom({ "-1": { "0": { f: "=RAND()", v: "" } } }, () => 0.2)).toEqual([]);
    const rows = {
      "0": {
        "0": { f: "=RAND()", v: "" },
        "1": { v: "secret-value" },
        "2": { f: "=RANDBETWEEN(1, 3)", v: "kept" },
      },
    };
    const calculated = applyRandom(rows, () => 0);
    expect(rows["0"]["0"].v).toBe(0);
    expect(rows["0"]["2"].v).toBe(1);
    expect(calculated).toEqual(["A1", "C1"]);
    expect(JSON.stringify(calculated)).not.toContain("secret-value");
    expect(rows["0"]["1"].v).toBe("secret-value");
    const local = { "0": { "0": { v: 1 }, "1": { v: 3 }, "2": { f: "=RANDBETWEEN(A1, B1)", v: "" } } };
    expect(applyRandom(local, () => 0)).toEqual(["C1"]);
    expect(local["0"]["2"].v).toBe(1);
    const other = { "0": { "0": { f: "=RANDBETWEEN(Beds!A1, B1)", v: "kept" } } };
    expect(applyRandom(other, () => 0)).toEqual([]);
    expect(other["0"]["0"].v).toBe("kept");
  });
});
