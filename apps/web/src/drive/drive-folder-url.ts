import { drive, type DriveItem } from "../node-client";

export type DriveView = "mine" | "shared" | "trash";
export type DriveCrumb = { id: string | null; name: string };
export type DrivePlace = { view: DriveView; path: DriveCrumb[] };
export const driveRoot = (view: DriveView): DrivePlace => ({
  view,
  path: [
    {
      id: null,
      name:
        view === "mine"
          ? "My Drive"
          : view === "trash"
            ? "Trash"
            : "Shared with me",
    },
  ],
});

/** Names keep links readable; the ID disambiguates duplicates and survives renames. */
export function driveFolderUrl(place: DrivePlace): string {
  const names = place.path
    .slice(1)
    .map((crumb) => encodeURIComponent(crumb.name));
  const query = new URLSearchParams();
  const id = place.path.at(-1)?.id;
  if (id) query.set("folder", id);
  if (place.view !== "mine") query.set("view", place.view);
  return `/drive${names.length ? `/${names.join("/")}` : ""}${query.size ? `?${query}` : ""}`;
}

function checkedFolder(item: DriveItem | undefined): DriveItem {
  if (!item || item.kind !== "folder" || item.trashed)
    throw new Error(
      "This Drive folder is unavailable or you do not have access to it.",
    );
  return item;
}

export async function resolveDriveFolder(
  pathname: string,
  search: string,
): Promise<DrivePlace> {
  const query = new URLSearchParams(search);
  const view = query.get("view") ?? "mine";
  if (view !== "mine" && view !== "shared" && view !== "trash")
    throw new Error("This Drive view is invalid.");
  const root = driveRoot(view);
  if (view === "trash") return root;
  const id = query.get("folder");
  if (id) {
    const chain: DriveCrumb[] = [];
    const seen = new Set<string>();
    let folder = checkedFolder(await drive.get(id));
    while (true) {
      if (seen.has(folder.id) || seen.size >= 64)
        throw new Error("This Drive folder path is invalid.");
      seen.add(folder.id);
      chain.unshift({ id: folder.id, name: folder.name });
      if (!folder.parentId) break;
      try {
        folder = checkedFolder(await drive.get(folder.parentId));
      } catch (error) {
        // Shared folders can be accessible without access to their parents.
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          (error.status === 403 || error.status === 404)
        )
          break;
        throw error;
      }
    }
    return { view, path: [...root.path, ...chain] };
  }
  let names: string[];
  try {
    names = pathname
      .replace(/^\/drive\/?/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    throw new Error("This Drive folder URL is invalid.");
  }
  let parent: string | null = null;
  for (const name of names) {
    const items =
      view === "shared" && parent === null
        ? await drive.shared()
        : await drive.list(parent);
    const matches = items.filter(
      (item) => item.kind === "folder" && !item.trashed && item.name === name,
    );
    if (matches.length > 1)
      throw new Error(
        "More than one folder has this name. Open it from Drive to get its unique link.",
      );
    const folder = checkedFolder(matches[0]);
    root.path.push({ id: folder.id, name: folder.name });
    parent = folder.id;
  }
  return root;
}
