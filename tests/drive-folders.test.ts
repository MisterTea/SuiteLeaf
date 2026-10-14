import { expect, test } from "vitest";
import {
  folderCrumbs,
  folderPath,
  moveDestinations,
  movedToFolderText,
  MY_DRIVE,
  type FolderRef,
} from "../apps/web/src/drive/folder-paths";

const club: FolderRef = { id: "club", name: "Garden club", parentId: null };
const meetings: FolderRef = {
  id: "meetings",
  name: "Meetings",
  parentId: "club",
};
const folders = [club, meetings];

test("folder paths name each parent, and crumbs start at My Drive", () => {
  expect(folderPath(club, folders)).toBe("Garden club");
  expect(folderPath(meetings, folders)).toBe("Garden club / Meetings");
  expect(folderCrumbs(null, MY_DRIVE, folders)).toEqual([
    { id: null, name: "My Drive" },
  ]);
  expect(folderCrumbs("meetings", "Meetings", folders)).toEqual([
    { id: null, name: "My Drive" },
    { id: "club", name: "Garden club" },
    { id: "meetings", name: "Meetings" },
  ]);
  expect(folderCrumbs("club", "Garden club", [])).toEqual([
    { id: null, name: "My Drive" },
    { id: "club", name: "Garden club" },
  ]);
});

test("move destinations are a flat list, without the current folder", () => {
  expect(moveDestinations(folders, null).map((dest) => dest.path)).toEqual([
    "Garden club",
    "Garden club / Meetings",
  ]);
  expect(
    moveDestinations(folders, "club", { includeMyDrive: true }).map(
      (dest) => dest.path,
    ),
  ).toEqual(["My Drive", "Garden club / Meetings"]);
  expect(
    moveDestinations(folders, "meetings", { includeMyDrive: false }).map(
      (dest) => dest.name,
    ),
  ).toEqual(["Garden club"]);
  expect(moveDestinations(folders, null, { movingId: "club" })).toEqual([]);
});

test("the move banner names the file and the folder", () => {
  expect(movedToFolderText("Watering rota.sldoc", "Garden club")).toBe(
    "Moved Watering rota.sldoc to Garden club.",
  );
});
