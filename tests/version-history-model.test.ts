import { describe, expect, it } from "vitest";
import {
  changeSentence,
  copyFilename,
  groupVersions,
  partialRestoreTitle,
  restoreHeading,
  restorePrompt,
  shouldSnapshot,
  versionStamp,
  versionWhen,
  type HistoryVersion,
} from "../apps/web/src/editors/version-history-model";

const now = new Date(2026, 9, 12, 15, 0);

function version(
  id: string,
  createdAt: Date,
  authorId: string,
  authorName: string,
  extra: Partial<HistoryVersion> = {},
): HistoryVersion {
  return {
    id,
    createdAt: createdAt.toISOString(),
    authorId,
    authorName,
    name: null,
    restoredFrom: null,
    ...extra,
  };
}

describe("version history list", () => {
  it("labels today and yesterday in local time and names a copy after the author", () => {
    const morning = new Date(2026, 9, 12, 9, 14);
    const evening = new Date(2026, 9, 11, 18, 2);
    expect(versionWhen(morning.toISOString(), now)).toBe("Today 09:14");
    expect(versionWhen(evening.toISOString(), now)).toBe("Yesterday 18:02");
    expect(versionStamp(morning.toISOString())).toBe("12 Oct 09:14");
    expect(copyFilename("Watering rota", "Sam Okafor", morning.toISOString(), "sldoc")).toBe(
      "Watering rota (Sam's draft, 12 Oct 09:14).sldoc",
    );
  });

  it("collapses one person's autosaves within 10 minutes and keeps names visible", () => {
    const sam = "sam";
    const groups = groupVersions([
      version("c", new Date(2026, 9, 12, 9, 14), sam, "Sam Okafor"),
      version("b", new Date(2026, 9, 12, 9, 10), sam, "Sam Okafor"),
      version("a", new Date(2026, 9, 12, 9, 6), sam, "Sam Okafor"),
      version("m", new Date(2026, 9, 11, 18, 2), "rosa", "Rosa Diaz", {
        name: "Agreed rota",
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].earlier.map((item) => item.id)).toEqual(["b", "a"]);
    expect(groups[1].version.name).toBe("Agreed rota");
    expect(groups[1].earlier).toEqual([]);
  });

  it("does not hide a restore or a save more than 10 minutes later", () => {
    const groups = groupVersions([
      version("r", new Date(2026, 9, 12, 10, 0), "rosa", "Rosa Diaz", {
        restoredFrom: "m",
      }),
      version("s", new Date(2026, 9, 12, 9, 14), "sam", "Sam Okafor"),
      version("old", new Date(2026, 9, 12, 8, 0), "sam", "Sam Okafor"),
    ]);
    expect(groups.map((group) => group.version.id)).toEqual(["r", "s", "old"]);
    const named = version("m", new Date(2026, 9, 11, 18, 2), "rosa", "Rosa Diaz", {
      name: "Agreed rota",
    });
    expect(restoreHeading(named, "Rosa Diaz")).toBe('Restored "Agreed rota" · Rosa Diaz');
    expect(restorePrompt(named, 4, now)).toBe(
      'Restore "Agreed rota"? 4 paragraphs change. The current version stays in history.',
    );
    expect(partialRestoreTitle("north-bed")).toBe("Restored the north-bed paragraph");
    expect(changeSentence(8, "cell")).toBe("8 cells change");
    expect(changeSentence(1, "slide")).toBe("1 slide changes");
    expect(changeSentence(2, "slide")).toBe("2 slides change");
    expect(restorePrompt(named, 8, now, "cell")).toBe(
      'Restore "Agreed rota"? 8 cells change. The current version stays in history.',
    );
  });

  it("snapshots an explicit save and otherwise waits a few minutes", () => {
    const native = "monday";
    expect(shouldSnapshot(undefined, native, false, 0)).toBe(true);
    const latest = { native, createdAt: new Date(0).toISOString() };
    expect(shouldSnapshot(latest, native, true, 1_000)).toBe(false);
    expect(shouldSnapshot(latest, "tuesday", false, 60_000)).toBe(false);
    expect(shouldSnapshot(latest, "tuesday", true, 60_000)).toBe(true);
    expect(shouldSnapshot(latest, "tuesday", false, 3 * 60 * 1000)).toBe(true);
  });
});
