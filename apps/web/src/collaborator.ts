import type { Collaborator } from "@suiteleaf/core";
import { getSession } from "./node-client";

const KEY = "suiteleaf.collaborator";

/** The signed-in SuiteDrive user, or a stable name kept on this computer. */
export function editorCollaborator(): Collaborator {
  const user = getSession()?.user;
  if (user?.id) {
    return {
      id: user.id,
      name: user.name || user.username || user.email || "You",
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Collaborator | null;
    if (saved?.id && saved?.name) return saved;
  } catch {
    // A broken value is replaced below.
  }
  const created = { id: crypto.randomUUID(), name: "You" };
  localStorage.setItem(KEY, JSON.stringify(created));
  return created;
}
