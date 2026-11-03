import { describe, expect, it } from "vitest";
import { pivotSortChoice, pivotSortFromForm } from "../packages/core/src";

describe("pivot sort form", () => {
  it("keeps a known order and drops an unknown choice", () => {
    expect(pivotSortFromForm("value-desc")).toEqual({ by: "value", direction: "desc" });
    expect(pivotSortFromForm("value-asc")).toEqual({ by: "value", direction: "asc" });
    expect(pivotSortFromForm("label-desc")).toEqual({ by: "label", direction: "desc" });
    expect(pivotSortFromForm("")).toBeUndefined();
    expect(pivotSortFromForm("secret-value")).toBeUndefined();
    expect(pivotSortChoice({ by: "value", direction: "desc" })).toBe("value-desc");
    expect(pivotSortChoice({ by: "label", direction: "asc" })).toBe("");
    expect(pivotSortChoice(undefined)).toBe("");
  });
});
