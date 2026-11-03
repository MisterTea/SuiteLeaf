import { describe, expect, it } from "vitest";
import { recordSaveStatus, savePhase } from "../apps/web/src/save-state";

const local = { file: { updatedAt: "2026-10-30T18:00:00.000Z" } };
const drive = {
  file: { updatedAt: "2026-10-30T18:00:00.000Z" },
  drive: { syncedAt: "2026-10-30T18:00:00.000Z" },
};
const stale = {
  file: { updatedAt: "2026-10-30T18:05:00.000Z" },
  drive: { syncedAt: "2026-10-30T18:00:00.000Z" },
};

describe("save status", () => {
  it("calls a file synced only when the SuiteDrive revision matches", () => {
    expect(recordSaveStatus(drive, { desktop: false }).label).toBe("Saved to SuiteDrive");
    expect(savePhase(drive, { desktop: false })).toBe("synced");
    const pending = recordSaveStatus(stale, { desktop: false });
    expect(pending.phase).toBe("pending-sync");
    expect(pending.label).toBe("Saved on this device · not yet on SuiteDrive");
    const missing = recordSaveStatus(
      { file: drive.file, drive: {} },
      { desktop: false },
    );
    expect(missing.phase).toBe("pending-sync");
    expect(missing.label).not.toBe("Saved to SuiteDrive");
  });

  it("keeps conflict, failure, and offline ahead of a synced label", () => {
    expect(recordSaveStatus(drive, { desktop: false, conflict: true }).phase).toBe("conflict");
    expect(recordSaveStatus(drive, { desktop: false, failed: "disk full" }).label).toBe(
      "Save failed · disk full",
    );
    expect(recordSaveStatus(stale, { desktop: false, signedIn: false }).label).toBe(
      "Saved on this device · sign in to sync with SuiteDrive",
    );
    expect(recordSaveStatus(stale, { desktop: false, online: false }).phase).toBe("offline");
    expect(recordSaveStatus(drive, { desktop: false, online: false }).phase).toBe("synced");
  });

  it("names a local save by where the bytes are", () => {
    expect(recordSaveStatus(local, { desktop: false }).phase).toBe("local");
    expect(recordSaveStatus(local, { desktop: false }).label).toBe("Saved on this device");
    expect(savePhase(local, { desktop: false })).not.toBe("pending-sync");
    expect(recordSaveStatus({ ...local, path: "/tmp/Notes.sldoc" }, { desktop: true }).label).toBe(
      "Saved to file",
    );
    expect(recordSaveStatus({ ...local, recovery: true }, { desktop: true }).label).toBe(
      "Draft saved · choose Save As",
    );
    expect(recordSaveStatus(stale, { desktop: false, syncing: true }).label).toBe(
      "Saving to SuiteDrive…",
    );
    expect(recordSaveStatus(stale, { desktop: false, detail: "quota" }).label).toBe(
      "Saved on this device · quota",
    );
  });

  it("lets editing and a local write hide an older synced revision", () => {
    expect(savePhase(drive, { desktop: false, editing: true })).toBe("editing");
    expect(savePhase(drive, { desktop: false, savingLocal: true })).toBe("saving-local");
    expect(recordSaveStatus(drive, { desktop: false, notice: "Imported" }).label).toBe(
      "Imported · Saved to SuiteDrive",
    );
    expect(
      recordSaveStatus(drive, { desktop: false, syncedLabel: "Saved a copy to SuiteDrive" }).label,
    ).toBe("Saved a copy to SuiteDrive");
    expect(
      recordSaveStatus(stale, { desktop: false, syncedLabel: "Saved a copy to SuiteDrive" }).label,
    ).toBe("Saved on this device · not yet on SuiteDrive");
  });
});