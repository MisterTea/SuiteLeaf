/** Top of SuiteDrive, when a file has no parent folder. */
export const MY_DRIVE = "My Drive";

export interface FolderRef {
  id: string;
  name: string;
  parentId: string | null;
}

export interface MoveDestination {
  id: string | null;
  /** The folder's own name, or My Drive. */
  name: string;
  /** Readable path, such as "Garden club" or "Garden club / Meetings". */
  path: string;
}

/** "Garden club / Meetings" from parent links. A missing parent stops the walk. */
export function folderPath(folder: FolderRef, folders: FolderRef[]): string {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current: FolderRef | undefined = folder;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.push(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.reverse().join(" / ");
}

/** Crumbs for the home screen, ending at `parentId` (`null` is My Drive). */
export function folderCrumbs(
  parentId: string | null,
  parentName: string,
  folders: FolderRef[],
): { id: string | null; name: string }[] {
  const root = { id: null, name: MY_DRIVE };
  if (!parentId) return [root];
  const byId = new Map(folders.map((item) => [item.id, item]));
  const chain: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  let id: string | null = parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = byId.get(id);
    chain.push({
      id,
      name: folder?.name ?? (id === parentId ? parentName : "A folder"),
    });
    id = folder?.parentId ?? null;
  }
  chain.reverse();
  return [root, ...chain];
}

/**
 * Folders the file can move into, as a flat list of paths.
 * The current parent is left out. My Drive is included only when asked
 * (the file is in a folder, and the caller may put it at the top).
 * `movingId` hides that folder and anything inside it.
 */
export function moveDestinations(
  folders: FolderRef[],
  currentParentId: string | null,
  options?: { movingId?: string; includeMyDrive?: boolean },
): MoveDestination[] {
  const hidden = new Set<string>();
  if (options?.movingId) {
    hidden.add(options.movingId);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folders) {
        if (
          folder.parentId &&
          hidden.has(folder.parentId) &&
          !hidden.has(folder.id)
        ) {
          hidden.add(folder.id);
          grew = true;
        }
      }
    }
  }
  const destinations: MoveDestination[] = folders
    .filter((folder) => folder.id !== currentParentId && !hidden.has(folder.id))
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folderPath(folder, folders),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (options?.includeMyDrive && currentParentId !== null)
    destinations.unshift({ id: null, name: MY_DRIVE, path: MY_DRIVE });
  return destinations;
}

export function movedToFolderText(fileName: string, folderName: string) {
  return `Moved ${fileName} to ${folderName}.`;
}
