/** Where the latest local bytes live. SuiteDrive is a sync target, not a local save. */
export type SaveWhere = "browser" | "desktop-file" | "desktop-draft" | "suitedrive";

export type SavePhase =
  | "editing"
  | "saving-local"
  | "local"
  | "pending-sync"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "failed";

export type SaveRecord = {
  file: { updatedAt: string };
  drive?: { syncedAt?: string };
  path?: string;
  recovery?: boolean;
};

export type SaveFacts = {
  desktop: boolean;
  editing?: boolean;
  savingLocal?: boolean;
  syncing?: boolean;
  conflict?: boolean;
  /** Absent means the caller did not check. False means the user is signed out. */
  signedIn?: boolean;
  /** Absent means the caller did not check. False means the browser reports offline. */
  online?: boolean;
  /** A local save failed. An upload failure uses `detail` and stays pending. */
  failed?: string;
  /** Shown after a local save when SuiteDrive rejected the upload. */
  detail?: string;
  notice?: string;
  /** Replaces the synced label, for example after saving a conflict copy. */
  syncedLabel?: string;
};

export function saveWhere(record: SaveRecord, desktop: boolean): SaveWhere {
  if (record.drive) return "suitedrive";
  if (record.path) return "desktop-file";
  if (record.recovery || desktop) return "desktop-draft";
  return "browser";
}

/** Phase and label for the open file. `synced` requires the stored SuiteDrive revision. */
export function recordSaveStatus(record: SaveRecord, facts: SaveFacts): { phase: SavePhase; label: string } {
  const phase = savePhase(record, facts);
  const where = saveWhere(record, facts.desktop);
  let label = phaseLabel(phase, where, facts);
  if (facts.notice) label = `${facts.notice} · ${label}`;
  return { phase, label };
}

export function savePhase(record: SaveRecord, facts: SaveFacts): SavePhase {
  if (facts.conflict) return "conflict";
  if (facts.failed) return "failed";
  if (facts.savingLocal) return "saving-local";
  if (facts.editing) return "editing";
  if (!record.drive) return "local";
  const pending = record.drive.syncedAt !== record.file.updatedAt;
  if (pending && (facts.signedIn === false || facts.online === false)) return "offline";
  if (facts.syncing && pending) return "syncing";
  if (pending) return "pending-sync";
  if (!record.drive.syncedAt) return "pending-sync";
  return "synced";
}

function phaseLabel(phase: SavePhase, where: SaveWhere, facts: SaveFacts): string {
  switch (phase) {
    case "editing":
      return "Editing";
    case "saving-local":
      return "Saving…";
    case "syncing":
      return "Saving to SuiteDrive…";
    case "synced":
      return facts.syncedLabel ?? "Saved to SuiteDrive";
    case "conflict":
      return "SuiteDrive has a newer version";
    case "failed":
      return facts.failed ? `Save failed · ${facts.failed}` : "Save failed";
    case "offline":
      return facts.signedIn === false
        ? "Saved on this device · sign in to sync with SuiteDrive"
        : "Saved on this device · offline";
    case "local":
      if (where === "desktop-file") return "Saved to file";
      if (where === "desktop-draft") return "Draft saved · choose Save As";
      return "Saved on this device";
    case "pending-sync":
      return facts.detail
        ? `Saved on this device · ${facts.detail}`
        : "Saved on this device · not yet on SuiteDrive";
  }
}
