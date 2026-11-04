import { describe, expect, it } from "vitest";
import { policyImpact } from "../apps/web/src/policy-impact";

describe("policy impact", () => {
  it("names the grant and the file that would change", () => {
    const changes = [
      { itemName: "Garden", principalId: "sam", before: "editor", after: "viewer" },
    ];
    const effects = [
      {
        itemName: "Watering rota.sldoc",
        principalId: "sam",
        before: "editor",
        after: "viewer",
      },
    ];
    const note = policyImpact({
      changes,
      effects,
      recovery: "Set each changed grant back to editor.",
    });
    expect(note).toContain("sam on Garden would change from editor to viewer.");
    expect(note).toContain(
      "sam on Watering rota.sldoc would change from editor to viewer.",
    );
    expect(note).toContain("Set each changed grant back to editor.");
    expect(note).not.toContain("secret-value");
    expect(changes[0].principalId).toBe("sam");
    expect(effects[0].itemName).toBe("Watering rota.sldoc");
  });

  it("does not repeat a credential in a name or a role", () => {
    const note = policyImpact({
      changes: [
        {
          itemName: "secret-value",
          principalId: "secret-value",
          before: "secret-value",
          after: "viewer",
        },
      ],
      effects: [],
      recovery: "",
    });
    expect(note).toContain("Someone on this item would change from another role to viewer.");
    expect(note).not.toContain("secret-value");
  });
});
