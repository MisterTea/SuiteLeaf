import { expect, it } from "vitest";
import {
  firstAccountIsAdmin,
  isAdminRole,
  removesLastAdmin,
} from "../src/guards";

it("treats a comma-separated admin role as an admin", () => {
  expect(isAdminRole("admin")).toBe(true);
  expect(isAdminRole("user, admin")).toBe(true);
  expect(isAdminRole("user")).toBe(false);
  expect(isAdminRole(null)).toBe(false);
});

it("makes only the first account an admin", () => {
  expect(firstAccountIsAdmin(0)).toBe(true);
  expect(firstAccountIsAdmin(1)).toBe(false);
});

it("refuses to disable or demote the last admin who can sign in", () => {
  expect(
    removesLastAdmin({
      targetIsActiveAdmin: true,
      otherActiveAdmins: 0,
      banned: true,
    }),
  ).toBe(true);
  expect(
    removesLastAdmin({
      targetIsActiveAdmin: true,
      otherActiveAdmins: 0,
      nextRole: "user",
    }),
  ).toBe(true);
  expect(
    removesLastAdmin({
      targetIsActiveAdmin: true,
      otherActiveAdmins: 1,
      nextRole: "user",
    }),
  ).toBe(false);
  expect(
    removesLastAdmin({
      targetIsActiveAdmin: false,
      otherActiveAdmins: 0,
      banned: true,
    }),
  ).toBe(false);
});
