/** Shared rules for the auth hooks. The node enforces the same rules on its
 * own admin routes; these cover calls that go straight to better-auth. */

export function isAdminRole(role: unknown): boolean {
  return String(role ?? "")
    .split(",")
    .some((part) => part.trim() === "admin");
}

export function firstAccountIsAdmin(existingUsers: number): boolean {
  return existingUsers === 0;
}

/** True when this change would leave the cluster with no admin who can sign in. */
export function removesLastAdmin(input: {
  targetIsActiveAdmin: boolean;
  otherActiveAdmins: number;
  nextRole?: unknown;
  banned?: unknown;
}): boolean {
  if (!input.targetIsActiveAdmin || input.otherActiveAdmins > 0) return false;
  const banning = input.banned === true || input.banned === 1;
  const demoting =
    input.nextRole !== undefined && !isAdminRole(input.nextRole);
  return banning || demoting;
}
