import { expect, it } from "vitest";
import { memberPlanText } from "../apps/web/src/admin/member-plan";

it("names the file and leaves out ids and the file body", () => {
  const text = memberPlanText(
    {
      groupId: "secret-value",
      groupName: "Garden club",
      changes: [
        {
          principalId: "secret-value",
          itemId: "secret-value",
          itemName: "Watering rota.sldoc",
          before: null,
          after: "editor",
        },
      ],
    },
    "Sam",
    true,
  );
  expect(text).toBe(
    "Adding Sam to Garden club would change Watering rota.sldoc from no role to editor. Nothing is changed.",
  );
  expect(text).not.toContain("secret-value");
});

it("does not repeat a role that is not a SuiteLeaf role", () => {
  const text = memberPlanText(
    {
      groupId: "g",
      groupName: "Garden club",
      changes: [
        {
          principalId: "sam",
          itemId: "file",
          itemName: "Beds",
          before: "secret-value",
          after: "viewer",
        },
      ],
    },
    "Sam",
    true,
  );
  expect(text).toBe(
    "Adding Sam to Garden club would change Beds from another role to viewer. Nothing is changed.",
  );
  expect(text).not.toContain("secret-value");
});

it("says an empty plan would not change access", () => {
  const text = memberPlanText(
    { groupId: "g", groupName: "Garden club", changes: [] },
    "Priya",
    false,
  );
  expect(text).toBe("Removing Priya from Garden club would not change access. Nothing is changed.");
});
