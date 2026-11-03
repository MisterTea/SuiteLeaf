import { describe, expect, it } from "vitest";
import { departureChecklist } from "../packages/core/src/capabilities/departure";

describe("employee departure", () => {
  it("names what is not done and does not repeat the device", () => {
    const blank = departureChecklist("  ");
    expect(blank.notice).toBe("Name the device to sign out.");
    const named = departureChecklist("secret-value");
    expect(named.notice).toBe(
      "The named device can be signed out. This note does not include the device name.",
    );
    expect(JSON.stringify(named)).not.toContain("secret-value");
    expect(named.steps.filter((step) => !step.done).map((step) => step.text)).toEqual([
      "This review does not remove the account or move any files.",
    ]);
    expect(named.steps.some((step) => step.text.startsWith("Removing the account"))).toBe(true);
  });
});
