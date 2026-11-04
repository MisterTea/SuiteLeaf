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
  drive?: { syncedAt?: string; nodeUrl?: string };
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
  /** Shared edits this device has not had stored yet. */
  unacked?: number;
};

let unackedEdits = 0;

/** Remember shared edits that the node has not stored. A count that is not a positive whole number is none. */
export function noteUnackedEdits(count: number): void {
  unackedEdits = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function unackedEditCount(): number {
  return unackedEdits;
}

function waitingEdits(facts: SaveFacts): number {
  const count = facts.unacked ?? unackedEdits;
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function saveWhere(record: SaveRecord, desktop: boolean): SaveWhere {
  if (record.drive) return "suitedrive";
  if (record.path) return "desktop-file";
  if (record.recovery || desktop) return "desktop-draft";
  return "browser";
}

/** A stored SuiteDrive time, or null when the value is not that time. */
export function persistedRevision(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return null;
  return value;
}

/** Phase and label for the open file. `synced` requires the stored SuiteDrive revision. */
export function recordSaveStatus(
  record: SaveRecord,
  facts: SaveFacts,
): { phase: SavePhase; label: string; revision: string | null } {
  const phase = savePhase(record, facts);
  const where = saveWhere(record, facts.desktop);
  let label = phaseLabel(phase, where, facts);
  if (facts.notice) label = `${facts.notice} · ${label}`;
  const stored = persistedRevision(record.drive?.syncedAt);
  const current = persistedRevision(record.file.updatedAt);
  const revision = phase === "synced" && stored && stored === current ? stored : null;
  return { phase, label, revision };
}

/** The SuiteDrive host, without a user name, password, path, or query. */
export function syncTargetHost(nodeUrl: string | undefined): string | null {
  if (!nodeUrl) return null;
  try {
    const url = new URL(nodeUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.host;
    if (!host || /secret|password|token|api[_-]?key/i.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** The open editor names the stored revision when the status says SuiteDrive saved it. */
export function editorSaveTitle(status: string, record: SaveRecord): string | undefined {
  if (!status.includes("Saved to SuiteDrive") || status.includes("not yet")) return undefined;
  const revision = recordSaveStatus(record, { desktop: false }).revision;
  const host = syncTargetHost(record.drive?.nodeUrl);
  if (revision && host) return `${revision} · ${host}`;
  return revision ?? host ?? undefined;
}

export function savePhase(record: SaveRecord, facts: SaveFacts): SavePhase {
  if (facts.conflict) return "conflict";
  if (facts.failed) return "failed";
  if (facts.savingLocal) return "saving-local";
  if (facts.editing) return "editing";
  if (!record.drive) return "local";
  const stored = persistedRevision(record.drive.syncedAt);
  const current = persistedRevision(record.file.updatedAt);
  if (stored && stored === current) return waitingEdits(facts) > 0 ? "pending-sync" : "synced";
  if (facts.signedIn === false || facts.online === false) return "offline";
  if (facts.syncing) return "syncing";
  return "pending-sync";
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
