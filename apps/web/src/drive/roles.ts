import type { DriveRole } from "../node-client";

/** Roles a person can be given. Owner is the person who created the file. */
export const GRANT_ROLES = [
  { id: "viewer", name: "Viewer", description: "Can read" },
  { id: "commenter", name: "Commenter", description: "Can read and comment" },
  { id: "editor", name: "Editor", description: "Can change anything" },
] as const;

export type GrantRole = (typeof GRANT_ROLES)[number]["id"];

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
    case "commenter":
      return "Can comment";
    case "viewer":
      return "Can view";
    default:
      return "";
  }
}
