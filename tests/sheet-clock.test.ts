import { describe, expect, it } from "vitest";
import { applyClock, clockText } from "../packages/core/src/sheet-clock";

describe("sheet clock", () => {
  const now = new Date("2026-11-03T15:04:05.000Z");

  it("reads the UTC day and the UTC time", () => {
    expect(clockText("=TODAY()", now)).toBe("2026-11-03");
    expect(clockText("= NOW( )", now)).toBe("2026-11-03T15:04:05Z");
    expect(clockText("=TODAY(A1)", now)).toBeNull();
    expect(clockText("=TODAY()", new Date("secret"))).toBeNull();
    const rows = {
      "0": { "0": { f: "=TODAY()", v: "" }, "1": { v: "secret-value" }, "2": { f: "=NOW()", v: "kept" } },
    };
    const calculated = applyClock(rows, now);
    expect(rows["0"]["0"].v).toBe("2026-11-03");
    expect(rows["0"]["2"].v).toBe("2026-11-03T15:04:05Z");
    expect(calculated).toEqual(["A1", "C1"]);
    expect(JSON.stringify(calculated)).not.toContain("secret-value");
    expect(rows["0"]["1"].v).toBe("secret-value");
    const again = { "0": { "0": { f: "=TODAY()", v: "2026-11-03" }, "1": null, "2": { v: 1 }, "3": { f: "=A1", v: "" } } };
    expect(applyClock({ ...again, "1": undefined }, now)).toEqual(["A1"]);
    expect(applyClock({ "-1": { "0": { f: "=TODAY()", v: "" } } }, now)).toEqual([]);
  });
});
