import { getSession } from "../node-client";
import { folderCrumbs } from "./folder-paths";
import type { DrivePlace as Place } from "./drive-folder-url";

const PLACE_KEY = "suiteleaf:drive-place";

/** Remembers the home screen's folder for this account, so leaving a file
 * returns to the folder it was opened from. */
export const place = {
  owner() {
    const session = getSession();
    return session ? `${session.url}|${session.user.id}` : "";
  },
  load(): Place | null {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PLACE_KEY) ?? "null");
      return saved?.owner === place.owner() && saved.path?.length
        ? { view: saved.view, path: saved.path }
        : null;
    } catch {
      return null;
    }
  },
  save(value: Place) {
    sessionStorage.setItem(
      PLACE_KEY,
      JSON.stringify({ owner: place.owner(), ...value }),
    );
  },
};

/** Opens this folder the next time the home screen's SuiteDrive list mounts. */
export function rememberDriveFolder(
  parentId: string | null,
  parentName: string,
  folders: { id: string; name: string; parentId: string | null }[] = [],
) {
  if (!place.owner()) return;
  place.save({
    view: "mine",
    path: folderCrumbs(parentId, parentName, folders),
  });
}
