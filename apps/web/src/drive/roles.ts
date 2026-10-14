import type { DriveRole } from "../node-client";

/** Roles a person can be given. Owner is the person who created the file. */
export const GRANT_ROLES = [
  {
    id: "responder",
    name: "Responder",
    description: "Can sign up, not change the questions",
  },
  { id: "viewer", name: "Viewer", description: "Can read" },
  { id: "commenter", name: "Commenter", description: "Can read and comment" },
  { id: "editor", name: "Editor", description: "Can change anything" },
] as const;

export type GrantRole = (typeof GRANT_ROLES)[number]["id"];
export type GrantRoleOption = (typeof GRANT_ROLES)[number];

/** Responder is first on a form, and absent for every other kind. */
export function grantRolesFor(kind: string): readonly GrantRoleOption[] {
  if (kind === "form") return GRANT_ROLES;
  return GRANT_ROLES.filter((role) => role.id !== "responder");
}

/** A new form share starts as Responder. Everything else starts as Editor. */
export function defaultGrantRole(kind: string): GrantRole {
  return kind === "form" ? "responder" : "editor";
}

export function asGrantRole(role: DriveRole): GrantRole {
  return role === "owner" ? "editor" : role;
}

export function roleVerb(role: GrantRole): string {
  switch (role) {
    case "responder":
      return "respond";
    case "viewer":
      return "view";
    case "commenter":
      return "comment";
    case "editor":
      return "edit";
  }
}

export function roleDescription(role: GrantRole): string {
  return GRANT_ROLES.find((r) => r.id === role)?.description ?? "";
}

/** How this file shows up for the person it was shared with. */
export function accessLabel(role: DriveRole | null): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "editor":
      return "Can edit";
    case "responder":
      return "Can respond";
    case "commenter":
      return "Can comment";
    case "viewer":
      return "Can view";
    default:
      return "";
  }
}
