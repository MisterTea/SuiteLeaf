import { describe, expect, it } from "vitest";
import { formNumberAnswer } from "../apps/web/src/form-number";

describe("form number", () => {
  it("keeps a number inside the range and refuses the rest", () => {
    expect(formNumberAnswer(" 10 ")).toEqual({ text: "10" });
    expect(formNumberAnswer("-2.5", -3, 0)).toEqual({ text: "-2.5" });
    expect(formNumberAnswer("10 beds").message).toBe("Enter a number.");
    expect(formNumberAnswer("secret-value").message).toBe("Enter a number.");
    expect(formNumberAnswer("1e2").message).toBe("Enter a number.");
    expect(formNumberAnswer("11", 1, 10).message).toBe("That number is outside the range.");
    expect(formNumberAnswer("0", 1, 10).message).toBe("That number is outside the range.");
    expect(formNumberAnswer("5", 10, 1).message).toBe("That number range is not valid.");
    expect(formNumberAnswer("5", Number.NaN, 10)).toEqual({ text: "5" });
    expect(JSON.stringify(formNumberAnswer("secret-value"))).not.toContain("secret-value");
  });
});
