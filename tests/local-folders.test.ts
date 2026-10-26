import { describe, expect, it } from "vitest";
import {
  childFolders,
  existingFolder,
  folderOfPath,
  folderTrail,
  moveTargets,
} from "../apps/web/src/local-folders";

describe("folders of the documents folder", () => {
  it("places a file by its path, and files elsewhere at the top", () => {
    const root = "/Users/sam/Documents/SuiteLeaf";
    expect(folderOfPath(`${root}/Plan.sldoc`, root)).toBe("");
    expect(folderOfPath(`${root}/Garden/Seeds/List.slsheet`, `${root}/`)).toBe("Garden/Seeds");
    expect(folderOfPath("C:\\Docs\\SuiteLeaf\\Garden\\Plan.sldoc", "C:\\Docs\\SuiteLeaf")).toBe("Garden");
    expect(folderOfPath("/Users/sam/Desktop/Plan.sldoc", root)).toBe("");
    expect(folderOfPath(`${root} copy/Plan.sldoc`, root)).toBe("");
    expect(folderOfPath(undefined, root)).toBe("");
  });

  it("lists a folder's own folders in name order, and the trail down to it", () => {
    const folders = ["Week 10", "Week 2", "Week 2/Notes", "Archive"];
    expect(childFolders(folders, "")).toEqual(["Archive", "Week 2", "Week 10"]);
    expect(childFolders(folders, "Week 2")).toEqual(["Week 2/Notes"]);
    expect(folderTrail("Week 2/Notes")).toEqual([
      { folder: "", name: "All files" },
      { folder: "Week 2", name: "Week 2" },
      { folder: "Week 2/Notes", name: "Notes" },
    ]);
  });

  it("falls back to the nearest folder still there", () => {
    expect(existingFolder("Garden/Seeds/Old", ["Garden"])).toBe("Garden");
    expect(existingFolder("Gone", ["Garden"])).toBe("");
  });

  it("offers every other place to move to, never a folder into itself", () => {
    const folders = ["Garden", "Garden/Seeds", "Recipes"];
    expect(moveTargets(folders, "Garden").map((t) => t.label)).toEqual([
      "All files",
      "Garden / Seeds",
      "Recipes",
    ]);
    expect(moveTargets(folders, "", "Garden").map((t) => t.folder)).toEqual(["Recipes"]);
  });
});
