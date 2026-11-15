/**
 * Whether the assistant may call a tool on the file that is open now.
 * A role the person no longer has is whatever was set last. Callers update it
 * when access changes.
 */

export type AssistantFileRole =
  | "local"
  | "owner"
  | "editor"
  | "commenter"
  | "viewer"
  | "responder"
  | "none";

const READ_TOOLS = new Set([
  "read_sheet",
  "read_notes_and_comments",
  "check_spelling",
  "select_range",
  "switch_sheet",
]);

let fileRole: AssistantFileRole = "none";
let fileKey = "";
let accessCheck: (() => Promise<AssistantFileRole>) | undefined;

export function setAssistantFileRole(role: AssistantFileRole, key = fileKey) {
  fileRole = role;
  fileKey = key;
}

export const currentAssistantFileKey = () => fileKey;

/** Re-read access before a tool call. A missing check keeps the last role. */
export function setAssistantAccessCheck(check: (() => Promise<AssistantFileRole>) | undefined) {
  accessCheck = check;
}

export function currentAssistantFileRole(): AssistantFileRole {
  return fileRole;
}

/** The role for this tool call. A failed check removes access and does not keep the error. */
export async function assistantAccessNow(): Promise<AssistantFileRole> {
  if (!accessCheck) return fileRole;
  try {
    fileRole = await accessCheck();
  } catch {
    fileRole = "none";
  }
  return fileRole;
}

export function assistantToolAllowed(
  role: AssistantFileRole,
  toolName: string,
): { ok: true } | { ok: false; reason: string } {
  if (role === "local" || role === "owner" || role === "editor") return { ok: true };
  if (role === "none") {
    return {
      ok: false,
      reason: "You do not have access to this file, so the assistant cannot use it.",
    };
  }
  if (role === "commenter" && (READ_TOOLS.has(toolName) || toolName === "add_comment")) {
    return { ok: true };
  }
  if ((role === "viewer" || role === "responder") && READ_TOOLS.has(toolName)) {
    return { ok: true };
  }
  if (role === "commenter") {
    return {
      ok: false,
      reason: "You can comment on this file, but the assistant cannot change it.",
    };
  }
  if (role === "responder") {
    return {
      ok: false,
      reason: "You can fill this form, but the assistant cannot change the file.",
    };
  }
  return {
    ok: false,
    reason: "You can view this file, but the assistant cannot change it.",
  };
}

const TARGET_KEYS = ["fileId", "itemId", "targetId"] as const;

function namedTargets(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const row = args as Record<string, unknown>;
  const targets: string[] = [];
  for (const key of TARGET_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) targets.push(value.trim());
  }
  return [...new Set(targets)];
}

/**
 * A tool that names a file uses that file's access, not the open file's access.
 * The reason does not include the id or any other argument.
 */
export function assistantTargetAllowed(
  openRole: AssistantFileRole,
  toolName: string,
  args: unknown,
  roleOf?: (id: string) => AssistantFileRole | undefined,
  openFileId?: string,
): { ok: true } | { ok: false; reason: string } {
  const targets = namedTargets(args);
  if (!targets.length) {
    return assistantToolAllowed(openRole, toolName);
  }
  for (const target of targets) {
    const role = target === openFileId ? openRole : roleOf?.(target);
    if (!role) {
      return {
        ok: false,
        reason: "The assistant cannot use a file whose access is unknown.",
      };
    }
    const permission = assistantToolAllowed(role, toolName);
    if (!permission.ok) return permission;
  }
  return { ok: true };
}
