import { expect, it } from "vitest";
import { presenceLabel } from "../apps/web/src/drive/presence-label";

it("says a quiet person is idle and does not repeat a file name", () => {
  expect(presenceLabel({ name: "Jordan", editing: true, idle: true })).toBe("Jordan is idle");
  expect(presenceLabel({ name: "Jordan", editing: true })).toBe("Jordan is editing");
  expect(presenceLabel({ name: "Casey", editing: false })).toBe("Casey is viewing");
  expect(presenceLabel({ name: "Jordan", editing: true, idle: true })).not.toContain("secret-value");
  expect(presenceLabel({ name: "Ada\nLovelace", editing: true })).toBe("Ada Lovelace is editing");
  expect(presenceLabel({ name: " \n ", editing: false, idle: true })).toBe("Someone is idle");
  expect(presenceLabel({ name: " \n ", editing: false, idle: true })).not.toContain("secret-value");
});
