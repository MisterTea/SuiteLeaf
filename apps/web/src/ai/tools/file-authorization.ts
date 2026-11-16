import type { FileRecord } from "@suiteleaf/core";
import { drive, getSession } from "../../node-client";
import { ToolError } from "../host";
import { findRecord, namesFrom, type HomeAgentContext } from "./file-library";

const canEdit = (role: string | null | undefined) => role === "owner" || role === "editor";

export async function assertRecordAccess(record: FileRecord, edit: boolean) {
  if (!record.drive) return;
  await assertDriveAccess(record.drive.itemId, edit);
}

export async function assertDriveAccess(itemId: string, edit: boolean) {
  try {
    if (!getSession()) throw new Error();
    const item = await drive.get(itemId);
    if (edit ? canEdit(item.role) : !!item.role) return;
  } catch { /* Failed permission checks never grant access to cached files. */ }
  throw new ToolError(edit ? "You do not have permission to edit this file." : "You do not have access to this file.");
}

/** Verify the actual destination; never fall back to another folder on denial. */
export async function assertDriveCreation(parentId: string | null) {
  try {
    if (!getSession()) throw new Error();
    if (parentId === null) return; // An authenticated person's own Drive root.
    const folder = await drive.get(parentId);
    if (folder.kind === "folder" && !folder.trashed && canEdit(folder.role)) return;
  } catch { /* Missing, inaccessible, or stale folders are denied. */ }
  throw new ToolError("You do not have permission to create files in this folder.");
}

const READ_LIBRARY = new Set(["list_files", "search_files", "show_files", "list_templates"]);
const LOCAL_CREATE = new Set(["create_file", "create_from_template", "open_sample", "open_from_computer", "remove_template"]);
const EDIT_RECORD = new Set(["rename_file", "remove_file", "restore_file", "empty_trash"]);

export async function authorizeLibraryTool(ctx: HomeAgentContext, name: string, args: { name?: unknown; names?: unknown }) {
  if (READ_LIBRARY.has(name) || LOCAL_CREATE.has(name)) return;
  if (!EDIT_RECORD.has(name) && !["open_file", "duplicate_file", "star_file"].includes(name))
    throw new ToolError("This library action has no permission check.");
  // Resolve exactly as the executor does; a stale or differently sorted list
  // must not authorize a different file with the same title.
  const records = name === "empty_trash" ? await ctx.fresh() : ctx.records;
  const named = namesFrom(args);
  if (name === "open_file" && named.length) {
    // Missing library titles fall back to the user's file picker, not a cached file.
    try { findRecord(records, named[0]); } catch { return; }
  }
  const targets = name === "empty_trash" && !named.length
    ? records.filter(record => record.trashedAt)
    : named.map(title => findRecord(records, title));
  // Check the whole batch before the first edit, including targets named by title.
  for (const record of targets) await assertRecordAccess(record, EDIT_RECORD.has(name));
}
